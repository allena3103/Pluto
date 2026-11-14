import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeToolContext, type PlutoDb, type ToolContext } from "../../src/context";
import { must } from "../db/helpers";

export function makeCtx(db: SupabaseClient, studentId: string): ToolContext {
  return makeToolContext({
    db: db as PlutoDb,
    studentId,
    appUrl: "http://localhost:3005",
  });
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`;
}

export async function createCourse(
  service: SupabaseClient,
  studentId: string,
  name: string,
  term: string | null = "Fall 2026",
): Promise<{ id: string; name: string; term: string | null }> {
  return must(
    await service
      .from("courses")
      .insert({ student_id: studentId, name, term })
      .select("id, name, term")
      .single(),
    "create course",
  ) as { id: string; name: string; term: string | null };
}

export async function createFile(
  service: SupabaseClient,
  input: {
    studentId: string;
    courseId: string;
    title: string;
    addedAt?: string;
    weekLabel?: string | null;
    pageCount?: number | null;
    ingestStatus?: string;
  },
): Promise<{ id: string }> {
  return must(
    await service
      .from("files")
      .insert({
        student_id: input.studentId,
        course_id: input.courseId,
        title: input.title,
        week_label: input.weekLabel ?? null,
        added_at: input.addedAt ?? new Date().toISOString(),
        page_count: input.pageCount ?? null,
        ingest_status: input.ingestStatus ?? "ready",
      })
      .select("id")
      .single(),
    "create file",
  ) as { id: string };
}

export async function insertPages(
  service: SupabaseClient,
  studentId: string,
  fileId: string,
  texts: string[],
): Promise<void> {
  const rows = texts.map((text, index) => ({
    student_id: studentId,
    file_id: fileId,
    page_number: index + 1,
    text,
  }));
  must(await service.from("file_pages").insert(rows).select("id"), "insert pages");
}
