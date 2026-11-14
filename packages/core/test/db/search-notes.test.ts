// search_notes: finds the right page, and never returns another student's pages.
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OTHER_STUDENT_ID } from "../../../../scripts/lib/seed-ids";
import { SKIP_DB_TESTS } from "../db-env";
import { anonClient, createThrowawayUser, deleteUsers, must, serviceClient, type TestUser } from "./helpers";

const RARE = "zanzibarquake"; // only on page 3 of the owner's first file (and on the bystander's page)
const COMMON = "plutonotes"; // on every page
const PAGES = 55;

interface Hit {
  file_id: string;
  file_title: string;
  course_id: string;
  course_name: string;
  week_label: string | null;
  page_number: number;
  snippet: string;
  rank: number;
}

describe.skipIf(SKIP_DB_TESTS)("search_notes", () => {
  let service: SupabaseClient;
  let owner: TestUser | undefined;
  let bystander: TestUser | undefined;
  let courseId: string;
  let secondCourseId: string;
  let fileId: string;
  let secondFileId: string;

  async function search(client: SupabaseClient, args: Record<string, unknown>): Promise<Hit[]> {
    return must(await client.rpc("search_notes", args), "search_notes") as Hit[];
  }

  async function makeFile(studentId: string, courseName: string, title: string, pages: string[]) {
    const course = must(
      await service.from("courses").insert({ student_id: studentId, name: courseName }).select("id").single(),
      "course",
    ) as { id: string };
    const file = must(
      await service
        .from("files")
        .insert({ student_id: studentId, course_id: course.id, title, week_label: "Week 4", ingest_status: "ready" })
        .select("id")
        .single(),
      "file",
    ) as { id: string };
    const rows = pages.map((text, i) => ({ student_id: studentId, file_id: file.id, page_number: i + 1, text }));
    must(await service.from("file_pages").insert(rows).select("id"), "file_pages");
    return { courseId: course.id, fileId: file.id };
  }

  beforeAll(async () => {
    service = serviceClient();
    owner = await createThrowawayUser(service, "Search Owner");
    bystander = await createThrowawayUser(service, "Search Bystander");

    const pages = Array.from({ length: PAGES }, (_, i) =>
      i + 1 === 3
        ? `Lecture ${COMMON} page 3. The ${RARE} treaty ended the dispute between the two port cities.`
        : `Lecture ${COMMON} page ${i + 1}. General background material about trade routes.`,
    );
    ({ courseId, fileId } = await makeFile(owner.id, "Search History", "Lecture 7", pages));
    ({ courseId: secondCourseId, fileId: secondFileId } = await makeFile(owner.id, "Search Biology", "Lab notes", [
      `Lab ${COMMON} notes about enzymes.`,
    ]));
    await makeFile(bystander.id, "Bystander Course", "Bystander file", [`Their ${RARE} ${COMMON} notes.`]);
  });

  afterAll(async () => {
    if (service) await deleteUsers(service, [owner, bystander]);
  });

  it("returns the right file and 1-based page for a distinctive word", async () => {
    const hits = await search(service, { p_student_id: owner!.id, p_query: RARE });
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.file_id).toBe(fileId);
    expect(hit.page_number).toBe(3);
    expect(hit.file_title).toBe("Lecture 7");
    expect(hit.course_id).toBe(courseId);
    expect(hit.course_name).toBe("Search History");
    expect(hit.week_label).toBe("Week 4");
    expect(hit.snippet.toLowerCase()).toContain(RARE);
    expect(hit.snippet.length).toBeLessThan(400);
    expect(hit.rank).toBeGreaterThan(0);
  });

  it("works for the owner's own session", async () => {
    const hits = await search(owner!.client, { p_student_id: owner!.id, p_query: RARE });
    expect(hits.map((h) => [h.file_id, h.page_number])).toEqual([[fileId, 3]]);
  });

  it("returns nothing for another student's id (explicit filter, service role)", async () => {
    expect(await search(service, { p_student_id: OTHER_STUDENT_ID, p_query: RARE })).toEqual([]);
    // The bystander has the same word; each student only ever gets their own page.
    const theirs = await search(service, { p_student_id: bystander!.id, p_query: RARE });
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.file_id).not.toBe(fileId);
  });

  it("a user session passing someone else's p_student_id gets nothing (RLS)", async () => {
    expect(await search(bystander!.client, { p_student_id: owner!.id, p_query: RARE })).toEqual([]);
    expect(await search(bystander!.client, { p_student_id: owner!.id, p_query: COMMON, p_limit: 50 })).toEqual([]);
  });

  it("filters by course and clamps the limit to 1..50", async () => {
    const inSecond = await search(service, { p_student_id: owner!.id, p_query: COMMON, p_course_id: secondCourseId });
    expect(inSecond.map((h) => h.file_id)).toEqual([secondFileId]);

    const byDefault = await search(service, { p_student_id: owner!.id, p_query: COMMON });
    expect(byDefault).toHaveLength(10);
    const big = await search(service, { p_student_id: owner!.id, p_query: COMMON, p_limit: 1000 });
    expect(big).toHaveLength(50);
    const zero = await search(service, { p_student_id: owner!.id, p_query: COMMON, p_limit: 0 });
    expect(zero).toHaveLength(1);
    expect(big.every((h) => h.course_id === courseId || h.course_id === secondCourseId)).toBe(true);
  });

  it("returns nothing for a query with no match or no terms", async () => {
    expect(await search(service, { p_student_id: owner!.id, p_query: "xylophonic nonexistentword" })).toEqual([]);
    expect(await search(service, { p_student_id: owner!.id, p_query: "" })).toEqual([]);
  });

  it("anonymous callers cannot execute it", async () => {
    const res = await anonClient().rpc("search_notes", { p_student_id: owner!.id, p_query: RARE });
    expect(res.error).not.toBeNull();
    expect(res.data ?? []).toEqual([]);
  });
});
