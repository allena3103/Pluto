import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/components/chat/use-chat-stream";
import { mascotMoodFor } from "./use-mascot-mood";

const IDLE = { slow: false, celebrating: false, asleep: false };

function user(content: string): ChatMessage {
  return { id: `u-${content}`, role: "user", content, citations: [] };
}

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: "a", role: "assistant", content: "", citations: [], ...overrides };
}

describe("mascotMoodFor", () => {
  it("is happy on an empty chat and sleeping once idle", () => {
    expect(mascotMoodFor([], IDLE)).toBe("happy");
    expect(mascotMoodFor([], { ...IDLE, asleep: true })).toBe("sleeping");
  });

  it("thinks right after the student sends a message", () => {
    expect(mascotMoodFor([user("hi")], IDLE)).toBe("thinking");
    expect(mascotMoodFor([user("hi"), assistant({ pending: true, streaming: true })], IDLE)).toBe("thinking");
  });

  it("switches to working when the first token is slow", () => {
    const messages = [user("hi"), assistant({ pending: true, streaming: true })];
    expect(mascotMoodFor(messages, { ...IDLE, slow: true })).toBe("working");
  });

  it("keeps working while the reply streams in", () => {
    expect(mascotMoodFor([user("hi"), assistant({ content: "Your", streaming: true })], IDLE)).toBe("working");
  });

  it("is worried when the reply failed, even if it was slow", () => {
    const failed = assistant({ error: "Could not reach the server." });
    expect(mascotMoodFor([user("hi"), failed], { ...IDLE, slow: true, celebrating: true })).toBe("worried");
  });

  it("asks when the finished reply ends with a question", () => {
    const question = assistant({ content: "Which class do you mean?  " });
    expect(mascotMoodFor([user("hi"), question], { ...IDLE, celebrating: true })).toBe("asking");
  });

  it("celebrates a finished reply, then settles back to happy and eventually sleeps", () => {
    const done = [user("hi"), assistant({ content: "Quiz 4 is due Tuesday." })];
    expect(mascotMoodFor(done, { ...IDLE, celebrating: true })).toBe("excited");
    expect(mascotMoodFor(done, IDLE)).toBe("happy");
    expect(mascotMoodFor(done, { ...IDLE, asleep: true })).toBe("sleeping");
  });
});
