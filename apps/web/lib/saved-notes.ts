import type { PlutoDb } from "@pluto/core/context";
import { z } from "zod";

export const SAVED_NOTE_TITLE_MAX = 120;

export type SavedNoteSource = { fileId: string; page: number };

/** `sources` as stored in `saved_notes.sources`; anything malformed is dropped on read. */
const SourcesSchema = z.array(z.object({ fileId: z.guid(), page: z.number().int().min(1) }));

export function parseSources(value: unknown): SavedNoteSource[] {
  const parsed = SourcesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SAVED_NOTE_TITLE_MAX ? `${flat.slice(0, SAVED_NOTE_TITLE_MAX - 1).trimEnd()}…` : flat;
}

/**
 * The reply's own heading when it opens with one ("# History 105 study guide"),
 * otherwise the first line of the student's request.
 */
export function savedNoteTitle(request: string, reply: string): string {
  const firstLine = reply.trimStart().split("\n", 1)[0] ?? "";
  const heading = /^#{1,3}\s+(.+)$/.exec(firstLine)?.[1] ?? /^\*\*(.+)\*\*:?$/.exec(firstLine)?.[1];
  const fromHeading = heading ? clip(heading.replace(/[*_`]/g, "")) : "";
  if (fromHeading) return fromHeading;
  return clip(request.split("\n", 1)[0] ?? "") || "Saved from chat";
}

export type SavedNoteRef = { noteId: string; courseId: string | null; courseName: string | null };

/**
 * Saves a notes-based chat reply to the Notes page. The class is the one every cited
 * file belongs to; replies citing several classes are saved with no class.
 * Uses the student's RLS client and filters by `student_id` explicitly.
 * Returns null (and logs) on failure: the chat reply still goes out.
 */
export async function saveChatNote(
  db: PlutoDb,
  input: {
    studentId: string;
    sessionId: string;
    request: string;
    body: string;
    sources: SavedNoteSource[];
  },
): Promise<SavedNoteRef | null> {
  const fileIds = [...new Set(input.sources.map((source) => source.fileId))];
  if (fileIds.length === 0) return null;

  const { data: files, error: filesError } = await db
    .from("files")
    .select("id, course_id")
    .eq("student_id", input.studentId)
    .in("id", fileIds);
  if (filesError || !files) {
    console.error("chat: saved note file lookup failed:", filesError?.message ?? "no rows");
    return null;
  }
  const owned = new Set(files.map((file) => file.id));
  const sources = input.sources.filter((source) => owned.has(source.fileId));
  if (sources.length === 0) return null;

  const courseIds = [...new Set(files.map((file) => file.course_id))];
  const courseId = courseIds.length === 1 ? (courseIds[0] ?? null) : null;

  let courseName: string | null = null;
  if (courseId) {
    const { data: course, error: courseError } = await db
      .from("courses")
      .select("name")
      .eq("student_id", input.studentId)
      .eq("id", courseId)
      .maybeSingle();
    if (courseError) console.error("chat: saved note course lookup failed:", courseError.message);
    courseName = course?.name ?? null;
  }

  const { data: saved, error: saveError } = await db
    .from("saved_notes")
    .insert({
      student_id: input.studentId,
      course_id: courseId,
      session_id: input.sessionId,
      title: savedNoteTitle(input.request, input.body),
      body: input.body,
      sources,
    })
    .select("id")
    .single();
  if (saveError || !saved) {
    console.error("chat: saved note insert failed:", saveError?.message ?? "no row");
    return null;
  }
  return { noteId: saved.id, courseId, courseName };
}
