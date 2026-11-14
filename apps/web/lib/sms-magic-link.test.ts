import type { PlutoDb } from "@pluto/core/context";
import { describe, expect, it, vi } from "vitest";
import { createSmsMagicLink, studentOwnsFilePage, type FilePageCheck, type MagicLinkCreator } from "./sms-magic-link";

const admin = {} as PlutoDb;
const STUDENT = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";
const owned: FilePageCheck = async () => true;

describe("createSmsMagicLink", () => {
  it("returns null without a citation and does not call the creator", async () => {
    const create = vi.fn<MagicLinkCreator>();
    expect(await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create, check: owned }, undefined)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("mints for the verified student and the first cited page", async () => {
    const create = vi.fn<MagicLinkCreator>(async () => ({
      url: "http://x/open/tok",
      token: "tok",
      expiresAt: new Date().toISOString(),
    }));
    const url = await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create, check: owned }, { fileId: FILE, page: 4 });
    expect(url).toBe("http://x/open/tok");
    expect(create).toHaveBeenCalledWith(admin, { studentId: STUDENT, fileId: FILE, page: 4, appUrl: "http://x" });
  });

  it("returns null when the creator throws (e.g. file not owned)", async () => {
    const create = vi.fn<MagicLinkCreator>(async () => {
      throw new Error("file not found for student");
    });
    const url = await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create, check: owned }, { fileId: FILE, page: 1 });
    expect(url).toBeNull();
  });

  it("does not mint when the file is not this student's or the page is out of range", async () => {
    const create = vi.fn<MagicLinkCreator>();
    const check = vi.fn<FilePageCheck>(async () => false);
    const url = await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create, check }, { fileId: FILE, page: 9 });
    expect(url).toBeNull();
    expect(check).toHaveBeenCalledWith(admin, { studentId: STUDENT, fileId: FILE, page: 9 });
    expect(create).not.toHaveBeenCalled();
  });
});

/** Minimal stand-in for `admin.from("files").select().eq().eq().maybeSingle()`. */
function fakeFilesDb(row: { id: string; student_id: string; page_count: number | null } | null) {
  const filters: Record<string, string> = {};
  const query = {
    select: () => query,
    eq: (col: string, val: string) => {
      filters[col] = val;
      return query;
    },
    maybeSingle: async () => {
      const match = row && row.id === filters.id && row.student_id === filters.student_id;
      return { data: match ? { id: row.id, page_count: row.page_count } : null, error: null };
    },
  };
  return { db: { from: () => query } as unknown as PlutoDb, filters };
}

describe("studentOwnsFilePage", () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";

  it("filters by student_id and file id", async () => {
    const { db, filters } = fakeFilesDb({ id: FILE, student_id: STUDENT, page_count: 5 });
    expect(await studentOwnsFilePage(db, { studentId: STUDENT, fileId: FILE, page: 5 })).toBe(true);
    expect(filters).toEqual({ student_id: STUDENT, id: FILE });
  });

  it("is false for another student's file", async () => {
    const { db } = fakeFilesDb({ id: FILE, student_id: OTHER, page_count: 5 });
    expect(await studentOwnsFilePage(db, { studentId: STUDENT, fileId: FILE, page: 1 })).toBe(false);
  });

  it("is false past page_count and true when page_count is unknown", async () => {
    expect(await studentOwnsFilePage(fakeFilesDb({ id: FILE, student_id: STUDENT, page_count: 5 }).db, { studentId: STUDENT, fileId: FILE, page: 6 })).toBe(false);
    expect(await studentOwnsFilePage(fakeFilesDb({ id: FILE, student_id: STUDENT, page_count: null }).db, { studentId: STUDENT, fileId: FILE, page: 60 })).toBe(true);
  });
});
