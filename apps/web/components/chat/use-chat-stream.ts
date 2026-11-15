"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChatRequest,
  CHAT_STREAM_CONTENT_TYPE,
  type ChatStreamEvent,
  type ClarifyingQuestion,
} from "@pluto/core/contract";
import { createChatFixtureStream } from "./fixture-stream";
import { parseNdjsonLine, splitNdjsonChunk } from "./ndjson-line-buffer";

export type ChatCitation = {
  fileId: string;
  page: number;
  deepLink: string;
  title?: string;
};

export type SavedNoteChip = { noteId: string; courseName: string | null };

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  /** What the bubble shows. */
  content: string;
  /** User messages only: what was sent, when it differs from `content` (answers to questions). */
  sent?: string;
  citations: ChatCitation[];
  error?: string;
  /** Waiting for the first text delta. */
  pending?: boolean;
  streaming?: boolean;
  /** The student pressed Stop before the reply finished. */
  stopped?: boolean;
  /** The agent asked these before answering. */
  questions?: ClarifyingQuestion[];
  /** The student already answered `questions`. */
  answered?: boolean;
  /** The reply was saved to the Notes page. */
  savedNote?: SavedNoteChip;
};

export type QuestionAnswer = { prompt: string; answer: string };

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function shouldUseChatFixture(): boolean {
  return (
    process.env.NEXT_PUBLIC_PLUTO_CHAT_FIXTURE === "1" && process.env.NODE_ENV !== "production"
  );
}

async function consumeNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let remainder = "";
  let invalidLineCount = 0;
  const reader = body.getReader();

  const handleLine = (line: string) => {
    const parsed = parseNdjsonLine(line);
    if (parsed.kind === "blank") return;
    if (parsed.kind === "invalid") {
      invalidLineCount += 1;
      console.warn("[chat] ignored invalid NDJSON line", { invalidLineCount, line });
      return;
    }
    onEvent(parsed.event);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const split = splitNdjsonChunk(remainder, chunk);
      remainder = split.remainder;
      for (const line of split.lines) {
        handleLine(line);
      }
    }
    remainder += decoder.decode();
    if (remainder.trim() !== "") {
      handleLine(remainder);
    }
  } finally {
    reader.releaseLock();
  }
}

export function useChatStream() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [isStreaming, setIsStreaming] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [pendingRetryMessage, setPendingRetryMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const applyStreamEvent = useCallback((assistantId: string, event: ChatStreamEvent) => {
    if (event.type === "text") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                content: m.content + event.delta,
              }
            : m,
        ),
      );
      return;
    }
    if (event.type === "citation") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                citations: [
                  ...m.citations,
                  {
                    fileId: event.fileId,
                    page: event.page,
                    deepLink: event.deepLink,
                    ...(event.title ? { title: event.title } : {}),
                  },
                ],
              }
            : m,
        ),
      );
      return;
    }
    if (event.type === "questions") {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, pending: false, questions: event.questions } : m)),
      );
      return;
    }
    if (event.type === "saved_note") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, savedNote: { noteId: event.noteId, courseName: event.courseName } }
            : m,
        ),
      );
      return;
    }
    if (event.type === "done") {
      setSessionId(event.sessionId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, pending: false, streaming: false } : m,
        ),
      );
      return;
    }
    if (event.type === "error") {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                pending: false,
                streaming: false,
                error: event.message,
              }
            : m,
        ),
      );
    }
  }, []);

  const failAssistant = useCallback(
    (assistantId: string, text: string, errorMessage: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, pending: false, streaming: false, error: errorMessage }
            : m,
        ),
      );
      setComposerText(text);
      setPendingRetryMessage(text);
    },
    [],
  );

  const runStream = useCallback(
    async (text: string, assistantId: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);

      try {
        let body: ReadableStream<Uint8Array> | null = null;

        if (shouldUseChatFixture()) {
          body = createChatFixtureStream(text, sessionId, controller.signal, window.location.origin);
        } else {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: CHAT_STREAM_CONTENT_TYPE },
            body: JSON.stringify(ChatRequest.parse({ sessionId, message: text })),
            signal: controller.signal,
          });

          if (response.status === 401) {
            failAssistant(assistantId, text, "Your session expired. Sign in again.");
            router.push("/login?next=%2Fchat");
            return;
          }

          if (!response.ok) {
            const errText =
              response.status === 404
                ? "Chat is not available yet. Try again later."
                : `Something went wrong (${response.status}). Try again.`;
            failAssistant(assistantId, text, errText);
            return;
          }

          if (!response.body) {
            failAssistant(assistantId, text, "The server returned an empty response.");
            return;
          }

          body = response.body;
        }

        let finished = false;
        let streamErrored = false;
        await consumeNdjsonStream(body, (event) => {
          if (event.type === "done") {
            finished = true;
          }
          if (event.type === "error") {
            finished = true;
            streamErrored = true;
          }
          applyStreamEvent(assistantId, event);
        });

        if (!finished) {
          failAssistant(assistantId, text, "The reply ended before it finished.");
        } else if (streamErrored) {
          setComposerText(text);
          setPendingRetryMessage(text);
        } else {
          setPendingRetryMessage(null);
        }
      } catch {
        if (controller.signal.aborted) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, pending: false, streaming: false, stopped: true } : m,
            ),
          );
          return;
        }
        failAssistant(
          assistantId,
          text,
          "Could not reach the server. Check your connection and try again.",
        );
      } finally {
        setIsStreaming(false);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, streaming: false, pending: false } : m)),
        );
      }
    },
    [applyStreamEvent, failAssistant, router, sessionId],
  );

  /** `display` is what the user bubble shows when it differs from the text sent. */
  const sendMessage = useCallback(
    async (raw?: string, display?: string) => {
      const text = (raw ?? composerText).trim();
      if (!text || isStreaming) return;

      setComposerText("");

      const userId = newId();
      const assistantId = newId();
      const shown = display?.trim() || text;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: shown, ...(shown !== text ? { sent: text } : {}), citations: [] },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          citations: [],
          pending: true,
          streaming: true,
        },
      ]);

      await runStream(text, assistantId);
    },
    [composerText, isStreaming, runStream],
  );

  /**
   * Sends answers to the questions on `assistantId`. The message repeats the student's
   * original request so the agent (and the saved note's title) keep the full context.
   */
  const answerQuestions = useCallback(
    (assistantId: string, answers: QuestionAnswer[]) => {
      if (isStreaming || answers.length === 0) return;
      const index = messages.findIndex((m) => m.id === assistantId);
      const asked = messages.findLast((m, i) => i < index && m.role === "user");
      const request = (asked?.sent ?? asked?.content ?? "").split("\n", 1)[0]?.trim() ?? "";
      const lines = answers.map(({ prompt, answer }) => `${prompt} ${answer}`);
      const text = [request, lines.join("\n")].filter(Boolean).join("\n\n");
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, answered: true } : m)));
      void sendMessage(text, answers.map(({ answer }) => answer).join(" · "));
    },
    [isStreaming, messages, sendMessage],
  );

  /** Stops the reply in flight. The server saves nothing for a stopped reply. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retryLast = useCallback(() => {
    if (!pendingRetryMessage || isStreaming) return;
    const text = pendingRetryMessage;
    setComposerText("");

    const assistantId = newId();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        citations: [],
        pending: true,
        streaming: true,
      },
    ]);
    void runStream(text, assistantId);
  }, [isStreaming, pendingRetryMessage, runStream]);

  /** Start a fresh conversation: stop any reply in flight and clear everything. */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setSessionId(undefined);
    setComposerText("");
    setPendingRetryMessage(null);
    setIsStreaming(false);
  }, []);

  return {
    messages,
    composerText,
    setComposerText,
    isStreaming,
    sendMessage,
    answerQuestions,
    stop,
    retryLast,
    canRetry: Boolean(pendingRetryMessage) && !isStreaming,
    reset,
    sessionId,
  };
}