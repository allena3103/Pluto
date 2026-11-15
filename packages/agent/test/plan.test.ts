import { describe, expect, it, vi } from "vitest";
import { runAgent } from "../src/index";
import { parsePlanRequest } from "../src/plan";

const FILE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST =
  "Make a short day-by-day study plan for the week 2026-11-16 to 2026-11-22. Call get_deadlines with daysAhead 10 and keep only what is due.";

const deadlines = {
  deadlines: [
    { title: "Essay 2", courseName: "History 105", dueAt: "2026-11-19T04:59:00Z" }, // Wed 11:59 PM Eastern
    { title: "Too early", courseName: "History 105", dueAt: "2026-11-15T17:00:00Z" },
    { title: "Quiz 4", courseName: "Bio 101", dueAt: "2026-11-17T15:00:00Z" }, // Tue 10:00 AM
    { title: "Too late", courseName: "Bio 101", dueAt: "2026-11-24T15:00:00Z" },
    { title: "Lab 3", courseName: "Bio 101", dueAt: "2026-11-17T22:00:00Z" }, // Tue 5:00 PM
  ],
};

function runner() {
  return vi.fn(async (name: string, _args?: Record<string, unknown>) => {
    if (name === "get_deadlines") return deadlines;
    return {
      results: [{ fileId: FILE_ID, title: "Lecture 4", page: 2, deepLink: `http://x/notes/${FILE_ID}?page=2`, snippet: "s" }],
    };
  });
}

describe("mock study plan", () => {
  it("parses the request", () => {
    expect(parsePlanRequest(REQUEST)).toEqual({ weekStart: "2026-11-16", weekEnd: "2026-11-22", daysAhead: 10 });
    expect(parsePlanRequest("what is due this week")).toBeNull();
  });

  it("returns one line per day in due order, with a citation", async () => {
    const runTool = runner();
    const result = await runAgent({ message: REQUEST, channel: "sms", llm: "mock", runTool } as never);
    expect(runTool).toHaveBeenCalledWith("get_deadlines", { daysAhead: 10 });
    expect(runTool).toHaveBeenCalledWith("search_notes", expect.objectContaining({ query: "Quiz 4", course: "Bio 101" }));
    expect(result.text.split("\n")).toEqual([
      "Your plan:",
      "Tue, Nov 17: Quiz 4 (Bio 101) due 10:00 AM; Lab 3 (Bio 101) due 5:00 PM",
      "Wed, Nov 18: Essay 2 (History 105) due 11:59 PM",
    ]);
    expect(result.text.length).toBeLessThan(600);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ fileId: FILE_ID, page: 2 });
  });

  it("says so when nothing is due, and survives a search failure", async () => {
    const empty = await runAgent({
      message: REQUEST,
      channel: "sms",
      llm: "mock",
      runTool: vi.fn(async () => ({ deadlines: [] })),
    } as never);
    expect(empty.text).toContain("Nothing is due");
    const noNotes = await runAgent({
      message: REQUEST,
      channel: "sms",
      llm: "mock",
      runTool: vi.fn(async (name: string) => {
        if (name === "get_deadlines") return deadlines;
        throw new Error("boom");
      }),
    } as never);
    expect(noNotes.text).toContain("Your plan:");
    expect(noNotes.citations).toEqual([]);
  });

  it("keeps long plans under 600 characters", async () => {
    const many = {
      deadlines: Array.from({ length: 7 }, (_, i) => ({
        title: `A fairly long assignment title number ${i}`,
        courseName: "Introduction to Comparative Politics",
        dueAt: `2026-11-${17 + i}T15:00:00Z`,
      })),
    };
    const result = await runAgent({ message: REQUEST, channel: "sms", llm: "mock", runTool: async () => many } as never);
    expect(result.text.length).toBeLessThanOrEqual(600);
  });
});
