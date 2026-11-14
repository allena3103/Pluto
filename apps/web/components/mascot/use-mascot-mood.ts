"use client";

import { useEffect, useState } from "react";
import type { ChatMessage } from "@/components/chat/use-chat-stream";
import type { MascotMood } from "./pluto-mascot";

/** Waiting longer than this means the agent is running tools, not just thinking. */
export const WORKING_AFTER_MS = 1800;
/** How long the "reply finished" celebration lasts. */
export const CELEBRATE_MS = 2600;
/** Idle time on an empty chat before Pluto dozes off. */
export const SLEEP_AFTER_MS = 45_000;

/**
 * Pure part of the mood logic, exported for tests.
 * The chat stream has no tool-call events, so "working" is inferred from how
 * long the first text delta takes (tools run before the reply text starts).
 */
export function mascotMoodFor(
  messages: ChatMessage[],
  flags: { slow: boolean; celebrating: boolean; asleep: boolean },
): MascotMood {
  const last = messages.at(-1);
  if (!last) return flags.asleep ? "sleeping" : "happy";
  if (last.role === "user") return "thinking";
  if (last.error) return "worried";
  if (last.pending) return flags.slow ? "working" : "thinking";
  if (last.streaming) return "working";
  if (last.content.trim().endsWith("?")) return "asking";
  if (flags.celebrating) return "excited";
  return flags.asleep ? "sleeping" : "happy";
}

/** Live mascot mood for the chat: thinking → working → excited/asking/worried → happy → sleeping. */
export function useMascotMood(messages: ChatMessage[], composerText: string): MascotMood {
  const last = messages.at(-1);
  const lastId = last?.id ?? null;
  const pending = Boolean(last?.pending);
  const finished = Boolean(last && last.role === "assistant" && !last.pending && !last.streaming && !last.error);

  // Each flag stores the key it was set for, so a new message resets it without a synchronous setState.
  const [slowFor, setSlowFor] = useState<string | null>(null);
  const [celebratedFor, setCelebratedFor] = useState<string | null>(null);
  const [asleepFor, setAsleepFor] = useState<string | null>(null);

  useEffect(() => {
    if (!pending || !lastId) return;
    const t = setTimeout(() => setSlowFor(lastId), WORKING_AFTER_MS);
    return () => clearTimeout(t);
  }, [pending, lastId]);

  useEffect(() => {
    if (!finished || !lastId) return;
    const t = setTimeout(() => setCelebratedFor(lastId), CELEBRATE_MS);
    return () => clearTimeout(t);
  }, [finished, lastId]);

  const activityKey = `${messages.length}:${lastId ?? ""}:${composerText}`;
  useEffect(() => {
    const t = setTimeout(() => setAsleepFor(activityKey), SLEEP_AFTER_MS);
    return () => clearTimeout(t);
  }, [activityKey]);

  return mascotMoodFor(messages, {
    slow: lastId !== null && slowFor === lastId,
    celebrating: finished && celebratedFor !== lastId,
    asleep: asleepFor === activityKey,
  });
}
