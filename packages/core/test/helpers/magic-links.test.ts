import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlutoDb } from "../../src/context";
import { consumeMagicLink, createMagicLink, createSavedNoteMagicLink, MAGIC_LINK_TTL_MS } from "../../src/magic-links";
import { SKIP_DB_TESTS } from "../db-env";
import { createThrowawayUser, deleteUsers, serviceClient, type TestUser } from "../db/helpers";

describe.skipIf(SKIP_DB_TESTS)("magic-links", () => {
  let admin: PlutoDb;
  const users: Array<TestUser | undefined> = [];

  beforeAll(() => {
    admin = serviceClient() as unknown as PlutoDb;
  });

  afterAll(async () => {
    await deleteUsers(admin, users);
  });

  async function makeFile(studentId: string): Promise<string> {
    const { data: course, error: courseError } = await admin
      .from("courses")
      .insert({ student_id: studentId, name: "Magic Link Course", term: "Fall 2026" })
      .select("id")
      .single();
    if (courseError || !course) throw new Error(`failed to create course: ${courseError?.message ?? "no data"}`);

    const { data: file, error: fileError } = await admin
      .from("files")
      .insert({ student_id: studentId, course_id: course.id, title: "Lecture Notes", source: "manual" })
      .select("id")
      .single();
    if (fileError || !file) throw new Error(`failed to create file: ${fileError?.message ?? "no data"}`);
    return file.id;
  }

  it("creates then consumes a link once", async () => {
    const student = await createThrowawayUser(admin, "Magic One");
    users.push(student);
    const fileId = await makeFile(student.id);

    const created = await createMagicLink(admin, {
      studentId: student.id,
      fileId,
      page: 3,
      appUrl: "https://pluto.test/",
      now: new Date("2026-11-14T00:00:00.000Z"),
    });

    expect(created.url).toMatch(/^https:\/\/pluto\.test\/open\/[-_A-Za-z0-9]+$/);
    expect(new Date(created.expiresAt).getTime()).toBe(Date.parse("2026-11-14T00:00:00.000Z") + MAGIC_LINK_TTL_MS);

    const consumed = await consumeMagicLink(admin, created.token, { now: new Date("2026-11-14T00:01:00.000Z") });
    expect(consumed).toEqual({
      kind: "file",
      studentId: student.id,
      fileId,
      page: 3,
      redirectPath: `/notes/${fileId}?page=3`,
    });

    const secondConsume = await consumeMagicLink(admin, created.token);
    expect(secondConsume).toBeNull();
  });

  it("returns null for expired and wrong tokens", async () => {
    const student = await createThrowawayUser(admin, "Magic Two");
    users.push(student);
    const fileId = await makeFile(student.id);

    const created = await createMagicLink(admin, {
      studentId: student.id,
      fileId,
      page: 1,
      appUrl: "https://pluto.test",
      now: new Date("2026-11-14T00:00:00.000Z"),
    });

    const expired = await consumeMagicLink(admin, created.token, { now: new Date("2026-11-14T00:16:00.000Z") });
    expect(expired).toBeNull();

    const wrong = await consumeMagicLink(admin, "wrong-token");
    expect(wrong).toBeNull();
  });

  it("rejects creating a link for another student's file", async () => {
    const owner = await createThrowawayUser(admin, "Owner");
    users.push(owner);
    const attacker = await createThrowawayUser(admin, "Attacker");
    users.push(attacker);
    const fileId = await makeFile(owner.id);

    await expect(
      createMagicLink(admin, {
        studentId: attacker.id,
        fileId,
        page: 1,
        appUrl: "https://pluto.test",
      }),
    ).rejects.toThrow("file not found for student");
  });

  it("allows exactly one success for concurrent consume", async () => {
    const student = await createThrowawayUser(admin, "Race");
    users.push(student);
    const fileId = await makeFile(student.id);
    const created = await createMagicLink(admin, { studentId: student.id, fileId, page: 2, appUrl: "https://pluto.test" });

    const [a, b] = await Promise.all([consumeMagicLink(admin, created.token), consumeMagicLink(admin, created.token)]);
    const successes = [a, b].filter((row): row is NonNullable<typeof row> => row !== null);
    expect(successes).toHaveLength(1);
    expect(successes[0]).toMatchObject({ studentId: student.id, fileId, page: 2 });
  });

  it("stores only a token hash, never the raw token", async () => {
    const student = await createThrowawayUser(admin, "Hash");
    users.push(student);
    const fileId = await makeFile(student.id);
    const created = await createMagicLink(admin, { studentId: student.id, fileId, page: 4, appUrl: "https://pluto.test" });

    const expectedHash = createHash("sha256").update(created.token).digest("hex");
    const { data, error } = await admin
      .from("magic_links")
      .select("token_hash")
      .eq("token_hash", expectedHash)
      .eq("student_id", student.id)
      .single();
    if (error || !data) throw new Error(`failed to load magic link row: ${error?.message ?? "no data"}`);

    expect(data.token_hash).toBe(expectedHash);
    expect(data.token_hash).not.toContain(created.token);
  });

  it("saved-note links: owner only, consumed once to /notes/saved/<id>, 15-minute expiry", async () => {
    const owner = await createThrowawayUser(admin, "Saved Owner");
    const other = await createThrowawayUser(admin, "Saved Other");
    users.push(owner, other);
    const { data: note, error } = await admin
      .from("saved_notes")
      .insert({ student_id: owner.id, title: "Guide", body: "body", source: "mcp" })
      .select("id")
      .single();
    if (error || !note) throw new Error(`failed to create note: ${error?.message ?? "no data"}`);

    await expect(
      createSavedNoteMagicLink(admin, { studentId: other.id, savedNoteId: note.id, appUrl: "https://pluto.test" }),
    ).rejects.toThrow("saved note not found for student");

    const now = new Date("2026-11-14T20:00:00Z");
    const created = await createSavedNoteMagicLink(admin, {
      studentId: owner.id,
      savedNoteId: note.id,
      appUrl: "https://pluto.test/",
      now,
    });
    expect(created.url).toBe(`https://pluto.test/open/${created.token}`);
    expect(created.expiresAt).toBe(new Date(now.getTime() + MAGIC_LINK_TTL_MS).toISOString());

    const { data: row } = await admin
      .from("magic_links")
      .select("token_hash, file_id, saved_note_id")
      .eq("student_id", owner.id)
      .single();
    expect(row).toEqual({
      token_hash: createHash("sha256").update(created.token).digest("hex"),
      file_id: null,
      saved_note_id: note.id,
    });

    // Expired relative to "now": consume with a time inside the window.
    const consumed = await consumeMagicLink(admin, created.token, { now: new Date(now.getTime() + 60_000) });
    expect(consumed).toEqual({
      kind: "saved_note",
      studentId: owner.id,
      savedNoteId: note.id,
      redirectPath: `/notes/saved/${note.id}`,
    });
    expect(await consumeMagicLink(admin, created.token, { now: new Date(now.getTime() + 60_000) })).toBeNull();
  });
});
