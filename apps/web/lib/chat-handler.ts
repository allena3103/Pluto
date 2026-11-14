import {
  clarificationText,
  runAgent as defaultRunAgent,
  type AgentCitation,
  type AgentHistoryItem,
} from "@pluto/agent";
import { makeToolContext, type PlutoDb } from "@pluto/core/context";
import { CHAT_STREAM_CONTENT_TYPE, ChatRequest, ChatStreamEvent } from "@pluto/core/contract";
import { saveChatNote } from "./saved-notes";

export type RunAgentFn = typeof defaultRunAgent;

export type ChatDeps = {
  /** The signed-in user's client. Row-level security applies to every query. */
  db: PlutoDb;
  /** `auth.uid()` from `getUser()`, or null when there is no session. */
  userId: string | null;
  appUrl: string | undefined;
  llm?: "mock" | "gemini";
  runAgent?: RunAgentFn;
  /** Whole agent call budget. */
  timeoutMs?: number;
  /** Aborts the agent when the client goes away or the student presses Stop. Nothing is saved then. */
  signal?: AbortSignal;
};

export const CHAT_TIMEOUT_MS = 25_000;
const HISTORY_LIMIT = 20;
const TITLE_MAX = 80;

// Fixed strings only. Never stream Postgres or model error text.
export const CHAT_ERROR_TEXT = "Something went wrong. Try again in a moment.";
export const CHAT_TIMEOUT_TEXT = "That took too long. Try again in a moment.";
const EMPTY_TEXT = "I couldn't put an answer together just now. Try again in a moment.";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

const NOT_FOUND = () => json({ error: "Session not found." }, 404);

class ChatTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ChatTimeout());
      controller.abort();
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadHistory(db: PlutoDb, studentId: string, sessionId: string): Promise<AgentHistoryItem[]> {
  const { data, error } = await db
    .from("chat_messages")
    .select("role,text,created_at")
    .eq("student_id", studentId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error || !data) return [];
  return data
    .reverse()
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({ role: row.role as "user" | "assistant", text: row.text }));
}

/** Keeps only citations that pass the contract, in order. */
function validCitations(citations: AgentCitation[]): Extract<ChatStreamEvent, { type: "citation" }>[] {
  const out: Extract<ChatStreamEvent, { type: "citation" }>[] = [];
  for (const c of citations) {
    const parsed = ChatStreamEvent.safeParse({ type: "citation", fileId: c.fileId, page: c.page, deepLink: c.deepLink });
    if (parsed.success && parsed.data.type === "citation") out.push(parsed.data);
  }
  return out;
}

function encodeEvents(events: ChatStreamEvent[]): Uint8Array {
  const lines = events.map((event) => `${JSON.stringify(ChatStreamEvent.parse(event))}\n`).join("");
  return new TextEncoder().encode(lines);
}

const errorEvent = (message: string): ChatStreamEvent => ({ type: "error", message });

/**
 * POST /api/chat. Session auth, user's RLS client, explicit `student_id` filters.
 * Streams NDJSON: text delta(s), one `citation` per citation, then exactly one
 * `done` or exactly one `error`.
 */
export async function handleChat(request: Request, deps: ChatDeps): Promise<Response> {
  const studentId = deps.userId;
  if (!studentId) return json({ error: "Unauthorized." }, 401);
  if (!deps.appUrl) return json({ error: "Server is not configured." }, 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  // Only `sessionId` and `message` are read. `model` or anything else in the body is ignored.
  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) return json({ error: "Body must be { sessionId?, message }." }, 400);
  const { message } = parsed.data;
  const db = deps.db;

  let sessionId: string;
  let history: AgentHistoryItem[] = [];
  if (parsed.data.sessionId) {
    const { data, error } = await db
      .from("chat_sessions")
      .select("id")
      .eq("id", parsed.data.sessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (error) {
      // A malformed or foreign id looks the same as a missing one.
      return NOT_FOUND();
    }
    if (!data) return NOT_FOUND();
    sessionId = data.id;
    history = await loadHistory(db, studentId, sessionId);
  } else {
    const { data, error } = await db
      .from("chat_sessions")
      .insert({ student_id: studentId, channel: "web", title: message.slice(0, TITLE_MAX) })
      .select("id")
      .single();
    if (error || !data) {
      console.error("chat: session insert failed:", error?.message ?? "no row");
      return json({ error: CHAT_ERROR_TEXT }, 500);
    }
    sessionId = data.id;
  }

  const runAgent = deps.runAgent ?? defaultRunAgent;
  const timeoutMs = deps.timeoutMs ?? CHAT_TIMEOUT_MS;

  async function produce(): Promise<ChatStreamEvent[]> {
    const { error: userError } = await db
      .from("chat_messages")
      .insert({ student_id: studentId!, session_id: sessionId, role: "user", text: message, channel: "web" });
    if (userError) {
      console.error("chat: user message insert failed:", userError.message);
      return [errorEvent(CHAT_ERROR_TEXT)];
    }

    const controller = new AbortController();
    const signal = deps.signal ? AbortSignal.any([deps.signal, controller.signal]) : controller.signal;
    const ctx = makeToolContext({ db, studentId: studentId!, appUrl: deps.appUrl! });

    let result: Awaited<ReturnType<RunAgentFn>>;
    try {
      result = await withTimeout(
        runAgent({ message, channel: "web", history, ctx, llm: deps.llm, signal }),
        timeoutMs,
        controller,
      );
    } catch (err) {
      return [errorEvent(err instanceof ChatTimeout ? CHAT_TIMEOUT_TEXT : CHAT_ERROR_TEXT)];
    }

    // The student pressed Stop (or left). Keep their message, save no reply and no note.
    if (deps.signal?.aborted) return [];

    const text = result.text.trim() || EMPTY_TEXT;

    const questions = result.questions?.length
      ? ChatStreamEvent.safeParse({ type: "questions", questions: result.questions })
      : undefined;
    if (questions?.success) {
      const asked = questions.data.type === "questions" ? questions.data.questions : [];
      const { error: questionError } = await db.from("chat_messages").insert({
        student_id: studentId!,
        session_id: sessionId,
        role: "assistant",
        // History keeps the questions and options so the next turn knows what was asked.
        text: clarificationText({ intro: text, questions: asked }),
        channel: "web",
      });
      if (questionError) {
        console.error("chat: assistant message insert failed:", questionError.message);
        return [errorEvent(CHAT_ERROR_TEXT)];
      }
      return [{ type: "text", delta: text }, questions.data, { type: "done", sessionId }];
    }

    const citations = validCitations(result.citations);
    const first = citations[0];

    const { error: assistantError } = await db.from("chat_messages").insert({
      student_id: studentId!,
      session_id: sessionId,
      role: "assistant",
      text,
      channel: "web",
      cited_file_id: first?.fileId ?? null,
      cited_page: first?.page ?? null,
    });
    if (assistantError) {
      console.error("chat: assistant message insert failed:", assistantError.message);
      return [errorEvent(CHAT_ERROR_TEXT)];
    }

    // A reply built from notes pages stays on the Notes page under its class.
    const saved =
      citations.length > 0 && text !== EMPTY_TEXT
        ? await saveChatNote(db, {
            studentId: studentId!,
            sessionId,
            request: message,
            body: text,
            sources: citations.map((c) => ({ fileId: c.fileId, page: c.page })),
          })
        : null;
    const savedEvent: ChatStreamEvent[] = saved ? [{ type: "saved_note", ...saved }] : [];

    return [{ type: "text", delta: text }, ...citations, ...savedEvent, { type: "done", sessionId }];
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let events: ChatStreamEvent[];
      try {
        events = await produce();
      } catch (err) {
        console.error("chat failed:", err instanceof Error ? err.message : "unknown error");
        events = [errorEvent(CHAT_ERROR_TEXT)];
      }
      if (deps.signal?.aborted) {
        // The client is gone; writing to a cancelled stream throws.
        try {
          streamController.close();
        } catch {
          // Already cancelled by the client.
        }
        return;
      }
      try {
        streamController.enqueue(encodeEvents(events));
      } catch {
        streamController.enqueue(encodeEvents([errorEvent(CHAT_ERROR_TEXT)]));
      }
      streamController.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": CHAT_STREAM_CONTENT_TYPE,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
