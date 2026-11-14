import { DeepLink } from "@pluto/core/contract";
import type { PlutoDb } from "@pluto/core/context";
import { describe, expect, it, vi } from "vitest";
import { handleAgentReply, secretMatches, withLink, type AgentReplyDeps, type RunAgentFn } from "./agent-reply";

const SECRET = "test-internal-secret";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const APP = "http://localhost:3403";
const NOTE_LINK = `${APP}/notes/${FILE}?page=3`;
const MAGIC = `${APP}/open/tok_abc123`;

const fakeAdmin = {} as PlutoDb;

function request(body: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-internal-secret"] = secret;
  return new Request("http://localhost/api/agent/reply", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function citingAgent(text = "Found it in \"Week 2 lecture\", page 3."): RunAgentFn {
  return vi.fn(async () => ({ text, citations: [{ fileId: FILE, page: 3, deepLink: NOTE_LINK }] }));
}

function deps(overrides: Partial<AgentReplyDeps> = {}): AgentReplyDeps {
  return {
    expectedSecret: SECRET,
    appUrl: APP,
    llm: "mock",
    createAdmin: () => fakeAdmin,
    runAgent: citingAgent(),
    createSmsMagicLink: vi.fn(async () => MAGIC),
    ...overrides,
  };
}

describe("secretMatches", () => {
  it("matches only the exact secret", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
  });
});

describe("withLink", () => {
  it("appends the url once", () => {
    expect(withLink("Answer.", MAGIC)).toBe(`Answer. ${MAGIC}`);
    expect(withLink(`Answer. ${MAGIC}`, MAGIC)).toBe(`Answer. ${MAGIC}`);
  });
});

describe("POST /api/agent/reply", () => {
  it("is 401 without the secret and never builds the admin client", async () => {
    const createAdmin = vi.fn(() => {
      throw new Error("must not be called");
    });
    const res = await handleAgentReply(request({ studentId: STUDENT, text: "hi", channel: "web" }, null), deps({ createAdmin }));
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("is 401 with a wrong secret, before reading the body", async () => {
    const createAdmin = vi.fn(() => fakeAdmin);
    const res = await handleAgentReply(request("not json", "wrong"), deps({ createAdmin }));
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("is 500 when INTERNAL_API_SECRET is not configured", async () => {
    const res = await handleAgentReply(request({}, ""), deps({ expectedSecret: undefined }));
    expect(res.status).toBe(500);
  });

  it("is 400 on a bad body", async () => {
    expect((await handleAgentReply(request("not json"), deps())).status).toBe(400);
    expect((await handleAgentReply(request({ studentId: "nope", text: "hi", channel: "web" }), deps())).status).toBe(400);
    expect((await handleAgentReply(request({ studentId: STUDENT, text: "", channel: "web" }), deps())).status).toBe(400);
    expect((await handleAgentReply(request({ studentId: STUDENT, text: "hi", channel: "fax" }), deps())).status).toBe(400);
  });

  it("web: deepLink is the first citation's notes URL and passes DeepLink", async () => {
    const runAgent = citingAgent();
    const res = await handleAgentReply(
      request({ studentId: STUDENT, text: "printing press", channel: "web", model: "evil-model" }),
      deps({ runAgent }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string; deepLink?: string };
    expect(body.deepLink).toBe(NOTE_LINK);
    expect(DeepLink.safeParse(body.deepLink).success).toBe(true);

    const input = vi.mocked(runAgent).mock.calls[0]![0];
    expect(input.model).toBeUndefined();
    expect(input.channel).toBe("web");
    expect(input.ctx?.studentId).toBe(STUDENT);
    expect(input.ctx?.db).toBe(fakeAdmin);
  });

  it("web: no citation means no deepLink", async () => {
    const runAgent: RunAgentFn = async () => ({ text: "No notes on that.", citations: [] });
    const res = await handleAgentReply(request({ studentId: STUDENT, text: "hi", channel: "web" }), deps({ runAgent }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ text: "No notes on that." });
  });

  it("sms: the reply ends with the magic URL and deepLink is that URL", async () => {
    const createSmsMagicLink = vi.fn(async () => MAGIC);
    const res = await handleAgentReply(
      request({ studentId: STUDENT, text: "printing press", channel: "sms" }),
      deps({ createSmsMagicLink }),
    );
    const body = (await res.json()) as { text: string; deepLink?: string };
    expect(body.text.endsWith(MAGIC)).toBe(true);
    expect(body.deepLink).toBe(MAGIC);
    expect(createSmsMagicLink).toHaveBeenCalledWith(
      { admin: fakeAdmin, studentId: STUDENT, appUrl: APP },
      { fileId: FILE, page: 3, deepLink: NOTE_LINK },
    );
  });

  it("sms: no link when the creator returns null", async () => {
    const res = await handleAgentReply(
      request({ studentId: STUDENT, text: "printing press", channel: "sms" }),
      deps({ createSmsMagicLink: async () => null }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.deepLink).toBeUndefined();
    expect(body.text).toBe("Found it in \"Week 2 lecture\", page 3.");
  });

  it("returns a fixed error when the agent throws", async () => {
    const runAgent: RunAgentFn = async () => {
      throw new Error("relation \"secret_table\" does not exist");
    };
    const res = await handleAgentReply(request({ studentId: STUDENT, text: "hi", channel: "web" }), deps({ runAgent }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Reply failed." });
  });
});
