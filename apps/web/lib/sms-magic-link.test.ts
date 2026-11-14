import type { PlutoDb } from "@pluto/core/context";
import { describe, expect, it, vi } from "vitest";
import { createSmsMagicLink, type MagicLinkCreator } from "./sms-magic-link";

const admin = {} as PlutoDb;
const STUDENT = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";

describe("createSmsMagicLink", () => {
  it("returns null without a citation and does not call the creator", async () => {
    const create = vi.fn<MagicLinkCreator>();
    expect(await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create }, undefined)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("mints for the verified student and the first cited page", async () => {
    const create = vi.fn<MagicLinkCreator>(async () => ({
      url: "http://x/open/tok",
      token: "tok",
      expiresAt: new Date().toISOString(),
    }));
    const url = await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create }, { fileId: FILE, page: 4 });
    expect(url).toBe("http://x/open/tok");
    expect(create).toHaveBeenCalledWith(admin, { studentId: STUDENT, fileId: FILE, page: 4, appUrl: "http://x" });
  });

  it("returns null when the creator throws (e.g. file not owned)", async () => {
    const create = vi.fn<MagicLinkCreator>(async () => {
      throw new Error("file not found for student");
    });
    const url = await createSmsMagicLink({ admin, studentId: STUDENT, appUrl: "http://x", create }, { fileId: FILE, page: 1 });
    expect(url).toBeNull();
  });
});
