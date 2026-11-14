// Seeds the synthetic lecture PDFs: upload to the private `notes` bucket, upsert `files` rows
// with the service role, and ingest them. Safe to re-run (fixed ids, upserts).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ingestFile, NOTES_BUCKET, notesStoragePath } from "@pluto/core/ingest";
import type { PlutoDb } from "@pluto/core/context";
import { repoRoot } from "./env";
import { COURSE_IDS, DEMO_STUDENT_ID, OTHER_COURSE_ID, OTHER_STUDENT_ID } from "./seed-ids";

export interface ManifestEntry {
  file: string;
  courseKey: keyof typeof COURSE_IDS;
  title: string;
  weekLabel: string;
  addedDaysAgo: number;
  pages: { page: number; fact: string; query: string }[];
}

export const SEED_PDF_DIR = join(repoRoot, "seed", "pdfs");

export function readManifest(): ManifestEntry[] {
  return JSON.parse(readFileSync(join(SEED_PDF_DIR, "manifest.json"), "utf8")) as ManifestEntry[];
}

/** Stable uuid-shaped id for a seeded file, derived from the owner and the file name. */
export function seedFileId(studentId: string, file: string): string {
  const hex = createHash("sha256").update(`${studentId}:${file}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The other student's single file (isolation checks need something to hide). */
export const OTHER_STUDENT_SEED_FILE = "stat240-week6-sampling-distributions.pdf";

interface SeedFile {
  studentId: string;
  courseId: string;
  entry: ManifestEntry;
  title: string;
}

async function seedOne(admin: PlutoDb, item: SeedFile): Promise<number> {
  const fileId = seedFileId(item.studentId, item.entry.file);
  const path = notesStoragePath(item.studentId, fileId);
  const addedAt = new Date(Date.now() - item.entry.addedDaysAgo * 24 * 60 * 60 * 1000).toISOString();

  const { error: rowError } = await admin.from("files").upsert(
    {
      id: fileId,
      student_id: item.studentId,
      course_id: item.courseId,
      title: item.title,
      week_label: item.entry.weekLabel,
      added_at: addedAt,
      source: "manual",
      storage_path: path,
    },
    { onConflict: "id" },
  );
  if (rowError) throw new Error(`seed: files row for ${item.entry.file} failed: ${rowError.message}`);

  const bytes = readFileSync(join(SEED_PDF_DIR, item.entry.file));
  const { error: uploadError } = await admin.storage
    .from(NOTES_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw new Error(`seed: upload of ${item.entry.file} failed: ${uploadError.message}`);

  const result = await ingestFile(admin, fileId);
  if (!result || result.status !== "ready") {
    throw new Error(`seed: ingest of ${item.entry.file} failed: ${result?.error ?? "file not found"}`);
  }
  return result.pageCount ?? 0;
}

export async function seedLectureFiles(admin: PlutoDb): Promise<void> {
  const manifest = readManifest();
  const items: SeedFile[] = manifest.map((entry) => ({
    studentId: DEMO_STUDENT_ID,
    courseId: COURSE_IDS[entry.courseKey],
    entry,
    title: entry.title,
  }));
  const otherEntry = manifest.find((entry) => entry.file === OTHER_STUDENT_SEED_FILE);
  if (!otherEntry) throw new Error(`seed: ${OTHER_STUDENT_SEED_FILE} missing from manifest`);
  items.push({
    studentId: OTHER_STUDENT_ID,
    courseId: OTHER_COURSE_ID,
    entry: otherEntry,
    title: "Other student's private notes",
  });

  let pages = 0;
  for (const item of items) pages += await seedOne(admin, item);
  console.log(`seed: ${items.length} lecture PDFs uploaded and ingested (${pages} pages)`);
}
