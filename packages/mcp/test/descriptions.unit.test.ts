import { describe, expect, test } from "vitest";
import { descriptionCorpus } from "../src/descriptions";

describe("tool descriptions", () => {
  test("mentions get_note_pages and deepLink", () => {
    const text = descriptionCorpus();
    expect(text).toContain("get_note_pages");
    expect(text).toContain("deepLink");
    expect(text).toContain("list_courses first");
    expect(text).toContain("pagesIncluded");
    expect(text).toContain("search_notes");
    expect(text).toContain("get_assignment");
    expect(text).toContain("1-based");
  });
});
