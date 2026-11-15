import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAgent } from "@pluto/agent";
import type { PlutoDb } from "@pluto/core/context";
import { ChatStreamEvent, DeepLink } from "@pluto/core/contract";
import type { Database } from "@pluto/core/database.types";
import { noteUrl } from "@pluto/core/deep-links";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CHAT_ERROR_TEXT, CHAT_TIMEOUT_TEXT, handleChat, type ChatDeps, type RunAgentFn } from "./chat-handler";
import { createSmsMagicLink } from "./sms-magic-link";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  if (existsSync(envFile)) config({ path: envFile, quiet: true });
}

const SKIP_DB_TESTS = process.env.PLUTO_SKIP_DB_TESTS === "1";
const APP = "http://localhost:3403";
const HTTP_TIMEOUT_MS = 20_000;

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readEvents(res: Response): Promise<ChatStreamEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => ChatStreamEvent.parse(JSON.parse(line)));
}

function terminalCount(events: ChatStreamEvent[]): number {
  return events.filter((e) => e.type === "done" || e.type === "error").length;
}

describe("handleChat without a database", () => {
  const db = {
    from() {
      throw new Error("must not query");
    },
  } as unknown as PlutoDb;

  it("is 401 with no user", async () => {
    const res = await handleChat(chatRequest({ message: "hi" }), { db, userId: null, appUrl: APP });
    expect(res.status).toBe(401);
  });

  it("is 400 on a bad body", async () => {
    const deps: ChatDeps = { db, userId: "11111111-1111-4111-8111-111111111111", appUrl: APP };
    expect((await handleChat(chatRequest("nope"), deps)).status).toBe(400);
    expect((await handleChat(chatRequest({ message: "" }), deps)).status).toBe(400);
    expect((await handleChat(chatRequest({ message: "hi", sessionId: "not-a-uuid" }), deps)).status).toBe(400);
  });
});

describe.skipIf(SKIP_DB_TESTS)("handleChat with the local database", () => {
  let service: SupabaseClient<Database>;
  const userIds: string[] = [];
  let a: { id: string; client: SupabaseClient<Database> };
  let b: { id: string; client: SupabaseClient<Database> };
  let fileId = "";
  let courseId = "";

  function client(url: string, key: string): SupabaseClient<Database> {
    return createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
      },
    });
  }

  async function throwaway(url: string, anonKey: string) {
    const email = `chat-${randomBytes(8).toString("hex")}@pluto.test`;
    const password = `pw-${randomBytes(12).toString("hex")}`;
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "no user"}`);
    userIds.push(data.user.id);
    const signedIn = client(url, anonKey);
    const session = await signedIn.auth.signInWithPassword({ email, password });
    if (session.error) throw new Error(`sign-in failed: ${session.error.message}`);
    return { id: data.user.id, client: signedIn };
  }

  /** Real `runAgent` (mock LLM) with a fake `search_notes` that cites A's file. */
  function citingAgent(): RunAgentFn {
    return (input) =>
      runAgent({
        ...input,
        llm: "mock",
        runTool: async () => ({
          results: [
            {
              fileId,
              title: "Week 2: The printing press",
              courseId: "00000000-0000-4000-8000-000000000000",
              courseName: "History 105",
              weekLabel: "Week 2",
              page: 3,
              snippet: "Gutenberg...",
              deepLink: noteUrl(APP, fileId, 3),
            },
          ],
        }),
      });
  }

  beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey) {
      throw new Error("DB tests need local Supabase env. Run `npm run env:local` (or PLUTO_SKIP_DB_TESTS=1).");
    }
    service = client(url, serviceKey);
    a = await throwaway(url, anonKey);
    b = await throwaway(url, anonKey);

    const course = await service
      .from("courses")
      .insert({ student_id: a.id, name: "History 105" })
      .select("id")
      .single();
    if (course.error) throw new Error(course.error.message);
    courseId = course.data.id;
    const file = await service
      .from("files")
      .insert({ student_id: a.id, course_id: course.data.id, title: "Week 2: The printing press", page_count: 5 })
      .select("id")
      .single();
    if (file.error) throw new Error(file.error.message);
    fileId = file.data.id;
  });

  afterAll(async () => {
    if (!service) return;
    for (const id of userIds) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) console.warn(`cleanup: could not delete ${id}: ${error.message}`);
    }
  });

  it("streams a citation and done, and stores the cited file and page", async () => {
    const runSpy = vi.fn(citingAgent());
    const res = await handleChat(
      chatRequest({ message: "what's in my History 105 notes about the printing press", model: "evil-model" }),
      { db: a.client, userId: a.id, appUrl: APP, runAgent: runSpy },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const events = await readEvents(res);

    expect(events[0]?.type).toBe("text");
    const citation = events.find((e) => e.type === "citation");
    expect(citation).toMatchObject({ type: "citation", fileId, page: 3, title: "Week 2: The printing press" });
    if (citation?.type !== "citation") throw new Error("no citation");
    expect(citation.page).toBeGreaterThanOrEqual(1);
    expect(DeepLink.safeParse(citation.deepLink).success).toBe(true);
    expect(terminalCount(events)).toBe(1);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("last event is not done");

    // A notes-based reply is saved to the Notes page under its class.
    const saved = events.find((e) => e.type === "saved_note");
    if (saved?.type !== "saved_note") throw new Error("no saved_note event");
    expect(saved.courseName).toBe("History 105");
    const { data: note } = await service
      .from("saved_notes")
      .select("student_id,course_id,session_id,title,body,sources")
      .eq("id", saved.noteId)
      .single();
    expect(note).toMatchObject({
      student_id: a.id,
      course_id: courseId,
      session_id: done.sessionId,
      title: "what's in my History 105 notes about the printing press",
      sources: [{ fileId, page: 3 }],
    });
    expect(note?.body).not.toMatch(/https?:\/\//);
    const { data: seenByB } = await b.client.from("saved_notes").select("id").eq("id", saved.noteId);
    expect(seenByB).toEqual([]);

    // The model is never taken from the body.
    expect(runSpy.mock.calls[0]![0].model).toBeUndefined();
    expect(runSpy.mock.calls[0]![0].ctx?.studentId).toBe(a.id);

    const { data: rows, error } = await service
      .from("chat_messages")
      .select("role,text,cited_file_id,cited_page,student_id,channel")
      .eq("session_id", done.sessionId)
      .order("created_at");
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({ role: "user", student_id: a.id, channel: "web", cited_file_id: null });
    expect(rows![1]).toMatchObject({ role: "assistant", student_id: a.id, cited_file_id: fileId, cited_page: 3 });

    // Continuing the same session passes history and reuses the id.
    const again = await handleChat(chatRequest({ sessionId: done.sessionId, message: "and page 4?" }), {
      db: a.client,
      userId: a.id,
      appUrl: APP,
      runAgent: runSpy,
    });
    const againEvents = await readEvents(again);
    expect(againEvents.at(-1)).toEqual({ type: "done", sessionId: done.sessionId });
    expect(runSpy.mock.calls[1]![0].history).toHaveLength(2);
  });

  it("another student's sessionId is 404, same as a missing one", async () => {
    const first = await readEvents(
      await handleChat(chatRequest({ message: "printing press" }), {
        db: a.client,
        userId: a.id,
        appUrl: APP,
        runAgent: citingAgent(),
      }),
    );
    const done = first.at(-1);
    if (done?.type !== "done") throw new Error("no session");

    const runAgentB = vi.fn(citingAgent());
    const foreign = await handleChat(chatRequest({ sessionId: done.sessionId, message: "show me" }), {
      db: b.client,
      userId: b.id,
      appUrl: APP,
      runAgent: runAgentB,
    });
    const missing = await handleChat(
      chatRequest({ sessionId: "99999999-9999-4999-8999-999999999999", message: "show me" }),
      { db: b.client, userId: b.id, appUrl: APP, runAgent: runAgentB },
    );
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(runAgentB).not.toHaveBeenCalled();

    // Even if the explicit filter were dropped, B's RLS client cannot see A's session or messages.
    const { data } = await b.client.from("chat_messages").select("id").eq("session_id", done.sessionId);
    expect(data).toEqual([]);
  });

  it("streams questions, keeps them in history, and saves no note", async () => {
    const asking: RunAgentFn = async () => ({
      text: "A quick question first:",
      citations: [],
      questions: [
        { id: "class", prompt: "Which class?", options: ["History 105", "Biology 110"], multiple: false, allowText: false },
      ],
    });
    const events = await readEvents(
      await handleChat(chatRequest({ message: "make me a study guide" }), { db: a.client, userId: a.id, appUrl: APP, runAgent: asking }),
    );
    expect(events.map((e) => e.type)).toEqual(["text", "questions", "done"]);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no session");

    const { data: rows } = await service
      .from("chat_messages")
      .select("role,text")
      .eq("session_id", done.sessionId)
      .order("created_at");
    expect(rows?.[1]?.text).toBe("A quick question first:\n- Which class? (History 105, Biology 110)");
    const { data: notes } = await service.from("saved_notes").select("id").eq("session_id", done.sessionId);
    expect(notes).toEqual([]);
  });

  it("a stopped reply streams nothing and saves no reply or note", async () => {
    const stopper = new AbortController();
    const stopped: RunAgentFn = async (input) => {
      stopper.abort();
      return citingAgent()(input);
    };
    const res = await handleChat(chatRequest({ message: "printing press stop test" }), {
      db: a.client,
      userId: a.id,
      appUrl: APP,
      runAgent: stopped,
      signal: stopper.signal,
    });
    expect(await res.text()).toBe("");

    const { data: sessions } = await service
      .from("chat_sessions")
      .select("id")
      .eq("student_id", a.id)
      .eq("title", "printing press stop test");
    const sessionId = sessions?.[0]?.id;
    if (!sessionId) throw new Error("no session");
    const { data: rows } = await service.from("chat_messages").select("role").eq("session_id", sessionId);
    expect(rows).toEqual([{ role: "user" }]);
    const { data: notes } = await service.from("saved_notes").select("id").eq("session_id", sessionId);
    expect(notes).toEqual([]);
  });

  it("streams exactly one fixed error on timeout and nothing after it", async () => {
    const slow: RunAgentFn = (input) =>
      new Promise((resolve) => {
        input.signal?.addEventListener("abort", () => resolve({ text: "late", citations: [] }));
      });
    const events = await readEvents(
      await handleChat(chatRequest({ message: "hi" }), { db: a.client, userId: a.id, appUrl: APP, runAgent: slow, timeoutMs: 50 }),
    );
    expect(events).toEqual([{ type: "error", message: CHAT_TIMEOUT_TEXT }]);
  });

  it("never streams raw error text from the agent", async () => {
    const broken: RunAgentFn = async () => {
      throw new Error("permission denied for table profiles");
    };
    const events = await readEvents(
      await handleChat(chatRequest({ message: "hi" }), { db: a.client, userId: a.id, appUrl: APP, runAgent: broken }),
    );
    expect(events).toEqual([{ type: "error", message: CHAT_ERROR_TEXT }]);
  });

  it("sms magic link mints for the owner's file and refuses another student's", async () => {
    const own = await createSmsMagicLink({ admin: service, studentId: a.id, appUrl: APP }, { fileId, page: 3 });
    expect(own).toMatch(new RegExp(`^${APP}/open/[A-Za-z0-9_-]+$`));
    const foreign = await createSmsMagicLink({ admin: service, studentId: b.id, appUrl: APP }, { fileId, page: 3 });
    expect(foreign).toBeNull();
  });
});
