import { DeepLink, TOOL_NAMES } from "@pluto/core/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildToolDeclarations } from "../src/declarations";
import { runAgent, type AgentModelClient } from "../src/index";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const DEEP_LINK = `http://localhost:3401/notes/${FILE_ID}?page=2`;
const MAGIC_URL = "http://localhost:3401/open/test-token";

const searchHit = {
  results: [
    {
      fileId: FILE_ID,
      title: "Treaty of Paris",
      page: 2,
      deepLink: DEEP_LINK,
      snippet: "TREATY-SNIPPET",
    },
  ],
};

function searchRunner() {
  return vi.fn(async (name: string) => {
    expect(name).toBe("search_notes");
    return searchHit;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("tool declarations", () => {
  it("matches the seven tool names and adds create_magic_link only with a creator", () => {
    const plain = buildToolDeclarations(false);
    expect(plain.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    expect(plain.some((tool) => tool.name === "create_magic_link")).toBe(false);

    const withLink = buildToolDeclarations(true);
    expect(withLink.map((tool) => tool.name)).toEqual([...TOOL_NAMES, "create_magic_link"]);
    const magic = withLink.find((tool) => tool.name === "create_magic_link");
    const properties = (magic?.parameters.properties ?? {}) as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["fileId", "page"]);
    expect(JSON.stringify(magic)).not.toMatch(/student/i);
  });
});

describe("mock agent", () => {
  it("cites a search hit on the web channel", async () => {
    const runTool = searchRunner();
    const result = await runAgent({
      llm: "mock",
      channel: "web",
      message: "where are my notes about the treaty",
      runTool,
    });

    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.citations).toEqual([{ fileId: FILE_ID, page: 2, deepLink: DEEP_LINK }]);
    expect(result.citations[0]?.page).toBeGreaterThanOrEqual(1);
    expect(DeepLink.safeParse(result.citations[0]?.deepLink).success).toBe(true);
    expect(result.text).toContain("Treaty of Paris");
    expect(result.text).toContain("page 2");
  });

  it("sets a magic link for SMS without putting that URL in the text", async () => {
    const runTool = searchRunner();
    const createMagicLink = vi.fn(async () => ({ url: MAGIC_URL }));
    const result = await runAgent({
      llm: "mock",
      channel: "sms",
      message: "where are my notes about the treaty",
      runTool,
      createMagicLink,
    });

    expect(createMagicLink).toHaveBeenCalledWith({ fileId: FILE_ID, page: 2 });
    expect(result.magicLinkUrl).toBe(MAGIC_URL);
    expect(result.text).not.toContain("open/test-token");
    expect(result.text.length).toBeLessThan(300);
    expect(result.citations[0]).toMatchObject({ fileId: FILE_ID, page: 2 });
  });

  it("routes the four keyword classes to the expected tool", async () => {
    const cases = [
      ["what is my grade", "get_grades"],
      ["when is the assignment due", "get_deadlines"],
      ["which week is the heaviest", "get_crunch_weeks"],
      ["list my courses", "list_courses"],
    ] as const;

    for (const [message, tool] of cases) {
      const runTool = vi.fn(async () => ({ courses: [{ name: "History 105", courseName: "History 105" }], deadlines: [], weeks: [] }));
      await runAgent({ llm: "mock", channel: "web", message, runTool });
      expect(runTool).toHaveBeenCalledTimes(1);
      expect(runTool).toHaveBeenCalledWith(tool, {});
    }
  });

  it("scopes a History 105 search", async () => {
    const runTool = vi.fn(async () => ({ results: [] }));
    await runAgent({
      llm: "mock",
      channel: "web",
      message: "What does History 105 say about the treaty",
      runTool,
    });
    expect(runTool).toHaveBeenCalledWith("search_notes", {
      query: "What does History 105 say about the treaty",
      limit: 3,
      course: "History 105",
    });
  });

  it("does not reject when a tool throws", async () => {
    const result = await runAgent({
      llm: "mock",
      channel: "web",
      message: "where are my notes about the treaty",
      runTool: async () => {
        throw new Error("database down GEMINI_API_KEY=secret");
      },
    });
    expect(result.text).toBe("Something went wrong while looking that up. Try again in a moment.");
    expect(result.text).not.toContain("secret");
    expect(result.citations).toEqual([]);
  });

  it("cites note pages that inherit fileId from the parent file", async () => {
    const runTool = vi.fn(async () => ({
      fileId: FILE_ID,
      title: "Lecture 4",
      deepLink: `http://localhost:3401/notes/${FILE_ID}?page=1`,
      pages: [{ page: 2, text: "the treaty", deepLink: DEEP_LINK }],
    }));
    const result = await runAgent({
      llm: "mock",
      channel: "web",
      message: "where are my notes about the treaty",
      runTool,
    });
    expect(result.citations).toEqual([{ fileId: FILE_ID, page: 2, deepLink: DEEP_LINK }]);
  });
});

describe("gemini agent", () => {
  it("runs one tool call from a fake client and sends the result back", async () => {
    const fetchCalls: unknown[] = [];
    vi.stubGlobal("fetch", (...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error("network");
    });

    const callStep = {
      type: "function_call",
      name: "search_notes",
      id: "call-1",
      arguments: { query: "treaty", limit: 3 },
      signature: "sig-keep-me",
    };
    const requests: unknown[] = [];
    const client: AgentModelClient = {
      interactions: {
        create: async (params) => {
          requests.push(params);
          if (requests.length === 1) return { steps: [callStep] };
          return { steps: [], output_text: "The treaty is on page 2." };
        },
      },
    };

    const runTool = vi.fn(async () => searchHit);
    const result = await runAgent({
      llm: "gemini",
      channel: "web",
      message: "where are my notes about the treaty",
      runTool,
      client,
    });

    expect(fetchCalls).toEqual([]);
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("search_notes", { query: "treaty", limit: 3 });
    expect(requests).toHaveLength(2);
    const second = requests[1] as { store: boolean; input: unknown[] };
    expect(second.store).toBe(false);
    expect(second.input).toContain(callStep);
    expect(JSON.stringify(second.input)).toContain("TREATY-SNIPPET");
    expect(result.text).toBe("The treaty is on page 2.");
    expect(result.citations).toEqual([{ fileId: FILE_ID, page: 2, deepLink: DEEP_LINK }]);
    expect(DeepLink.safeParse(result.citations[0]?.deepLink).success).toBe(true);
  });

  it("sets magicLinkUrl from create_magic_link and ignores a student id", async () => {
    const createMagicLink = vi.fn(async () => ({ url: MAGIC_URL }));
    let turns = 0;
    const client: AgentModelClient = {
      interactions: {
        create: async () => {
          turns += 1;
          if (turns === 1) {
            return {
              steps: [
                {
                  type: "function_call",
                  name: "create_magic_link",
                  id: "call-link",
                  arguments: { fileId: FILE_ID, page: 2, studentId: "someone-else" },
                },
              ],
            };
          }
          return { output_text: "Here is the page." };
        },
      },
    };

    const result = await runAgent({
      llm: "gemini",
      channel: "sms",
      message: "send me the page",
      runTool: vi.fn(async () => ({})),
      createMagicLink,
      client,
    });

    expect(createMagicLink).toHaveBeenCalledWith({ fileId: FILE_ID, page: 2 });
    expect(result.magicLinkUrl).toBe(MAGIC_URL);
    expect(result.text).toBe("Here is the page.");
  });

  it("returns an error result for an unknown tool and does not throw", async () => {
    const requests: unknown[] = [];
    const client: AgentModelClient = {
      interactions: {
        create: async (params) => {
          requests.push(params);
          if (requests.length === 1) {
            return {
              steps: [{ type: "function_call", name: "drop_table", id: "call-x", arguments: {} }],
            };
          }
          return { output_text: "I could not do that." };
        },
      },
    };
    const runTool = vi.fn(async () => ({ ok: true }));
    const result = await runAgent({
      llm: "gemini",
      channel: "web",
      message: "delete everything",
      runTool,
      client,
    });
    expect(runTool).not.toHaveBeenCalled();
    expect(JSON.stringify((requests[1] as { input: unknown }).input)).toContain("Unknown tool.");
    expect(result.text).toBe("I could not do that.");
  });
});
