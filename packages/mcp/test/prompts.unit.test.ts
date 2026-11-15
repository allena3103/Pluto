import { describe, expect, test } from "vitest";
import { PROMPTS, PromptArgumentError, renderPrompt } from "../src/prompts";

function text(name: string, args?: Record<string, unknown>): string {
  return renderPrompt(name, args).messages[0]!.content.text;
}

describe("prompt definitions", () => {
  test("three prompts with titles, descriptions and required flags", () => {
    expect(PROMPTS.map((p) => p.name)).toEqual(["study_guide", "cram_plan", "quiz_me"]);
    for (const p of PROMPTS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
    const flags = Object.fromEntries(PROMPTS.map((p) => [p.name, p.arguments.map((a) => `${a.name}:${a.required}`)]));
    expect(flags).toEqual({
      study_guide: ["course:true", "days:false"],
      cram_plan: ["weeks:false"],
      quiz_me: ["course:true", "topic:false", "count:false"],
    });
  });
});

describe("renderPrompt", () => {
  test("study_guide renders course and days, with defaults", () => {
    const given = text("study_guide", { course: "  History 105 ", days: "30" });
    expect(given).toContain('"History 105"');
    expect(given).toContain("days 30");
    expect(given).toContain("get_recent_notes");
    expect(given).toContain("get_note_pages");
    expect(given).toContain("save_study_guide");
    expect(given).toContain("[p. 3](deepLink)");
    expect(text("study_guide", { course: "History 105" })).toContain("days 14");
  });

  test("cram_plan renders weeks, with default", () => {
    expect(text("cram_plan", { weeks: "12" })).toContain("weeksAhead 12");
    const fallback = text("cram_plan");
    expect(fallback).toContain("weeksAhead 8");
    for (const tool of ["get_crunch_weeks", "get_deadlines", "search_notes"]) expect(fallback).toContain(tool);
  });

  test("quiz_me renders course, topic and count, with defaults", () => {
    const given = text("quiz_me", { course: "History 105", topic: "Reconstruction", count: "5" });
    expect(given).toContain('"Reconstruction"');
    expect(given).toContain("search_notes");
    expect(given).toContain("Write 5 numbered questions");
    expect(given).toContain("Answers");
    const plain = text("quiz_me", { course: "History 105" });
    expect(plain).toContain("get_recent_notes");
    expect(plain).toContain("Write 8 numbered questions");
  });

  test("returns one user message", () => {
    const rendered = renderPrompt("quiz_me", { course: "History 105" });
    expect(rendered.messages).toHaveLength(1);
    expect(rendered.messages[0]!.role).toBe("user");
  });

  test.each([
    ["unknown prompt", "nope", {}],
    ["missing course", "study_guide", {}],
    ["blank course", "quiz_me", { course: "   " }],
    ["long course", "study_guide", { course: "x".repeat(201) }],
    ["long topic", "quiz_me", { course: "A", topic: "x".repeat(201) }],
    ["days zero", "study_guide", { course: "A", days: "0" }],
    ["days too big", "study_guide", { course: "A", days: "121" }],
    ["days not a number", "study_guide", { course: "A", days: "soon" }],
    ["days decimal", "study_guide", { course: "A", days: "2.5" }],
    ["weeks too big", "cram_plan", { weeks: "27" }],
    ["count zero", "quiz_me", { course: "A", count: "0" }],
    ["count too big", "quiz_me", { course: "A", count: "21" }],
  ])("%s is rejected", (_label, name, args) => {
    expect(() => renderPrompt(name, args)).toThrow(PromptArgumentError);
  });
});
