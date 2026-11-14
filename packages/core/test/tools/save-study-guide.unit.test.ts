import { describe, expect, it } from "vitest";
import { SaveStudyGuideInput, TOOL_NAMES, WRITE_TOOL_NAMES } from "../../src/contract";
import { extractCandidatePages } from "../../src/save-study-guide";

const APP = "https://pluto.example.com";
const F1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("save_study_guide contract", () => {
  it("is not one of the 7 read tools", () => {
    expect(TOOL_NAMES).toHaveLength(7);
    expect(TOOL_NAMES).not.toContain("save_study_guide");
    expect(WRITE_TOOL_NAMES).toEqual(["save_study_guide"]);
  });

  it("validates title and markdown lengths", () => {
    expect(SaveStudyGuideInput.safeParse({ title: "  ", markdown: "x" }).success).toBe(false);
    expect(SaveStudyGuideInput.safeParse({ title: "t".repeat(201), markdown: "x" }).success).toBe(false);
    expect(SaveStudyGuideInput.safeParse({ title: "t", markdown: "x".repeat(60_001) }).success).toBe(false);
    expect(SaveStudyGuideInput.parse({ title: " Guide ", markdown: "x" })).toEqual({ title: "Guide", markdown: "x" });
  });
});

describe("extractCandidatePages", () => {
  it("keeps app-origin note links in order, deduped, and drops everything else", () => {
    const md = [
      `[a](${APP}/notes/${F1}?page=2)`,
      `again ${APP}/notes/${F1}?page=2.`,
      `bare ${APP}/notes/${F2}?page=7, then`,
      `[evil](https://evil.example/notes/${F1}?page=3)`,
      `[sub](https://x.pluto.example.com/notes/${F1}?page=3)`,
      `[relative](/notes/${F1}?page=4)`,
      `[not uuid](${APP}/notes/not-a-uuid?page=1)`,
      `[page 0](${APP}/notes/${F1}?page=0)`,
      `[other path](${APP}/notes/saved/${F1})`,
      `[no page](${APP}/notes/${F2})`,
    ].join("\n");
    expect(extractCandidatePages(md, APP)).toEqual([
      { fileId: F1, page: 2 },
      { fileId: F2, page: 7 },
      { fileId: F2, page: 1 },
    ]);
  });

  it("returns nothing for a bad app URL", () => {
    expect(extractCandidatePages(`${APP}/notes/${F1}?page=1`, "not a url")).toEqual([]);
  });
});
