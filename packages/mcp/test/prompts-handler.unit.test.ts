import { describe, expect, test } from "vitest";
import { UNIT_TOKEN, mcpResult, postMcp, rpcBody, unitConfig } from "./request";

const TOKEN = `Bearer ${UNIT_TOKEN}`;

type Prompt = { name: string; title?: string; arguments?: Array<{ name: string; required?: boolean }> };

describe("mcp prompts over the real handler", () => {
  test("initialize advertises prompts", async () => {
    const res = await mcpResult(
      await postMcp(
        unitConfig(),
        rpcBody("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pluto-test", version: "0.0.0" },
        }),
        TOKEN,
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body.result?.capabilities).toMatchObject({ prompts: {}, tools: {} });
  });

  test("prompts/list returns the three prompts with required flags", async () => {
    const res = await mcpResult(await postMcp(unitConfig(), rpcBody("prompts/list", {}), TOKEN));
    expect(res.status).toBe(200);
    const prompts = res.body.result?.prompts as Prompt[];
    expect(prompts.map((p) => p.name)).toEqual(["study_guide", "cram_plan", "quiz_me"]);
    const quiz = prompts.find((p) => p.name === "quiz_me")!;
    expect(quiz.title).toBe("Quiz me");
    expect(quiz.arguments?.map((a) => [a.name, a.required])).toEqual([
      ["course", true],
      ["topic", false],
      ["count", false],
    ]);
  });

  test("prompts/get renders the arguments", async () => {
    const res = await mcpResult(
      await postMcp(unitConfig(), rpcBody("prompts/get", { name: "quiz_me", arguments: { course: "History 105", count: "5" } }), TOKEN),
    );
    expect(res.status).toBe(200);
    const messages = res.body.result?.messages as Array<{ role: string; content: { text: string } }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content.text).toContain("History 105");
    expect(messages[0]!.content.text).toContain("Write 5 numbered questions");
  });

  test("bad arguments and unknown names are InvalidParams (-32602)", async () => {
    for (const params of [
      { name: "quiz_me", arguments: {} },
      { name: "cram_plan", arguments: { weeks: "99" } },
      { name: "no_such_prompt" },
    ]) {
      const res = await mcpResult(await postMcp(unitConfig(), rpcBody("prompts/get", params), TOKEN));
      expect((res.body as { error?: { code?: number } }).error?.code).toBe(-32602);
    }
  });

  test("auth still runs first: no token is 401", async () => {
    for (const method of ["prompts/list", "prompts/get"]) {
      const response = await postMcp(unitConfig(), rpcBody(method, { name: "quiz_me", arguments: { course: "A" } }));
      expect(response.status).toBe(401);
    }
  });
});
