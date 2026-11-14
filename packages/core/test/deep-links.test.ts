import { describe, expect, test } from "vitest";
import { notePath, noteUrl, parseNotePath } from "../src/deep-links";

const FILE = "3f2b8c1e-6a4d-4f5b-9c7e-1a2b3c4d5e6f";

describe("notePath", () => {
  test("builds /notes/<fileId>?page=<n>", () => {
    expect(notePath(FILE, 1)).toBe(`/notes/${FILE}?page=1`);
    expect(notePath(FILE, 12)).toBe(`/notes/${FILE}?page=12`);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects page %s", (page) => {
    expect(() => notePath(FILE, page)).toThrow(RangeError);
  });
});

describe("noteUrl", () => {
  test("joins the app url and the path", () => {
    expect(noteUrl("https://pluto.example.com", FILE, 3)).toBe(`https://pluto.example.com/notes/${FILE}?page=3`);
  });

  test("tolerates trailing slashes", () => {
    expect(noteUrl("http://localhost:3000/", FILE, 3)).toBe(`http://localhost:3000/notes/${FILE}?page=3`);
    expect(noteUrl("http://localhost:3000//", FILE, 3)).toBe(`http://localhost:3000/notes/${FILE}?page=3`);
  });

  test("rejects page 0 and 1.5", () => {
    expect(() => noteUrl("http://localhost:3000", FILE, 0)).toThrow(RangeError);
    expect(() => noteUrl("http://localhost:3000", FILE, 1.5)).toThrow(RangeError);
  });
});

describe("parseNotePath", () => {
  test("round trips a path and a url", () => {
    expect(parseNotePath(notePath(FILE, 7))).toEqual({ fileId: FILE, page: 7 });
    expect(parseNotePath(noteUrl("https://pluto.example.com/", FILE, 1))).toEqual({ fileId: FILE, page: 1 });
  });

  test("page defaults to 1 when missing", () => {
    expect(parseNotePath(`/notes/${FILE}`)).toEqual({ fileId: FILE, page: 1 });
    expect(parseNotePath(`/notes/${FILE}/`)).toEqual({ fileId: FILE, page: 1 });
  });

  test.each(["0", "1.5", "-2", "abc", "", "2e3"])("rejects page=%s", (page) => {
    expect(parseNotePath(`/notes/${FILE}?page=${page}`)).toBeNull();
  });

  test("rejects other paths", () => {
    expect(parseNotePath("/grades")).toBeNull();
    expect(parseNotePath("/notes")).toBeNull();
    expect(parseNotePath(`/notes/${FILE}/extra?page=2`)).toBeNull();
    expect(parseNotePath(`https://pluto.example.com/open/${FILE}`)).toBeNull();
  });
});
