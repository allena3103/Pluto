import { describe, expect, it } from "vitest";
import { stripLinks } from "../src/links";

const URL = "http://localhost:3401/notes/11111111-1111-4111-8111-111111111111?page=2";

describe("stripLinks", () => {
  it.each([
    [`Lecture 4 (${URL}) covers it.`, "Lecture 4 covers it."],
    [`Lecture 4 (page 2: ${URL}) covers it.`, "Lecture 4 (page 2) covers it."],
    [`Lecture 4 (p. 2, ${URL}), and more.`, "Lecture 4 (p. 2), and more."],
    [`Lecture 4 (${URL}, ${URL}) covers it.`, "Lecture 4 covers it."],
  ])("leaves no empty or dangling parentheses: %s", (input, expected) => {
    expect(stripLinks(input)).toBe(expected);
  });

  it("removes URLs that contain parentheses in full", () => {
    const wiki = "https://en.wikipedia.org/wiki/Printing_(press)";
    expect(stripLinks(`Wiki (${wiki}) says so.`)).toBe("Wiki says so.");
    expect(stripLinks(`[Wiki](${wiki}) says so.`)).toBe("Wiki says so.");
  });

  it("keeps sentence punctuation after a bare URL", () => {
    expect(stripLinks(`Open ${URL}. Next line.`)).toBe("Open. Next line.");
  });

  it("keeps parentheses that never held a URL", () => {
    const text = "Call print() on (a + b), see page (2).";
    expect(stripLinks(text)).toBe(text);
  });
});
