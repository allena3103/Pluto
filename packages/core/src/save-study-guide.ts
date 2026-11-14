/**
 * `save_study_guide`, the one MCP write tool (docs/plan.md, "Write tool rules").
 * Server-only: it imports `sms` and `magic-links` (service role, node:crypto).
 *
 * 1. Rate limit: at most `SAVE_STUDY_GUIDE_HOURLY_LIMIT` MCP saves per student per hour.
 * 2. Cited pages: deep links in the body on the app origin that point at the student's
 *    own files and existing pages. Anything else is dropped; a dropped id is never
 *    echoed back and only ever looked up with `student_id = ctx.studentId`.
 * 3. Insert one `saved_notes` row with `ctx.db` (OAuth: the student's RLS client; demo
 *    methods: service role) and an explicit `student_id`.
 * 4. Text step, only after the row exists: the injected service-role factory runs here
 *    and nowhere earlier. A failed or skipped text never undoes the save.
 */
import { ZodError } from "zod";
import {
  Id,
  MAX_PAGE,
  SAVE_STUDY_GUIDE_HOURLY_LIMIT,
  SAVE_STUDY_GUIDE_MAX_SOURCES,
  WRITE_TOOLS,
  type TextStatus,
  type WriteToolOutput,
} from "./contract";
import type { PlutoDb, ToolContext } from "./context";
import { parseNotePath } from "./deep-links";
import { createSavedNoteMagicLink, savedNotePath } from "./magic-links";
import { sendSms, type SmsProvider } from "./sms";
import { resolveCourse } from "./tools/resolve-course";
import { toDbToolError } from "./tools/shared";
import { ToolError, WriteToolError } from "./tools/tool-error";

const HOUR_MS = 60 * 60 * 1000;
/** Distinct file ids looked up per query. Keeps the PostgREST URL short. */
const FILE_LOOKUP_CHUNK = 100;
/** Distinct candidate file ids read from one body. More than this is never needed for 100 pages in practice. */
const MAX_CANDIDATE_FILES = 300;
const SMS_TITLE_MAX = 80;

export type SaveStudyGuideOutput = WriteToolOutput<"save_study_guide">;

export interface SaveStudyGuideDeps {
  /**
   * Service-role client factory. Called only in the text step, after auth succeeded
   * and the note row exists. Never called when the save fails or is rate limited.
   */
  createAdmin: () => PlutoDb;
  /** SMS settings from the route config (`SMS_PROVIDER`, env for Sendblue keys, fetch). */
  sms?: { provider?: SmsProvider; env?: NodeJS.ProcessEnv; fetch?: typeof fetch };
  now?: () => Date;
}

type CitedPage = { fileId: string; page: number };

function zodMessage(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ") || "Invalid input.";
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Candidate cited pages, in order of first appearance: absolute links on the app origin
 * whose path is `/notes/<uuid>?page=<n>`. Ownership is not checked here.
 */
export function extractCandidatePages(markdown: string, appUrl: string): CitedPage[] {
  const appOrigin = originOf(appUrl);
  if (!appOrigin) return [];
  const seen = new Set<string>();
  const out: CitedPage[] = [];
  for (const match of markdown.matchAll(/https?:\/\/[^\s<>()[\]"'`]+/g)) {
    // Sentence punctuation right after a bare URL is not part of it.
    const raw = match[0].replace(/[.,;:!?*_]+$/, "");
    if (originOf(raw) !== appOrigin) continue;
    const parsed = parseNotePath(raw);
    if (!parsed) continue;
    const fileId = parsed.fileId.toLowerCase();
    if (!Id.safeParse(fileId).success || parsed.page > MAX_PAGE) continue;
    const key = `${fileId}:${parsed.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fileId, page: parsed.page });
  }
  return out;
}

type OwnedFile = { id: string; course_id: string; page_count: number | null };

async function loadOwnedFiles(ctx: ToolContext, fileIds: string[]): Promise<Map<string, OwnedFile>> {
  const owned = new Map<string, OwnedFile>();
  for (let i = 0; i < fileIds.length; i += FILE_LOOKUP_CHUNK) {
    const chunk = fileIds.slice(i, i + FILE_LOOKUP_CHUNK);
    const { data, error } = await ctx.db
      .from("files")
      .select("id, course_id, page_count")
      .eq("student_id", ctx.studentId)
      .in("id", chunk);
    if (error) throw toDbToolError(error);
    for (const row of data ?? []) owned.set(row.id.toLowerCase(), row);
  }
  return owned;
}

/** Keeps pages of the student's own files, within 1..page_count when known, at most 100. */
async function keepOwnedPages(ctx: ToolContext, candidates: CitedPage[]): Promise<{ pages: CitedPage[]; files: OwnedFile[] }> {
  const fileIds = [...new Set(candidates.map((c) => c.fileId))].slice(0, MAX_CANDIDATE_FILES);
  if (fileIds.length === 0) return { pages: [], files: [] };
  const owned = await loadOwnedFiles(ctx, fileIds);

  const pages: CitedPage[] = [];
  const usedFiles = new Map<string, OwnedFile>();
  for (const candidate of candidates) {
    if (pages.length >= SAVE_STUDY_GUIDE_MAX_SOURCES) break;
    const file = owned.get(candidate.fileId);
    if (!file) continue;
    if (file.page_count !== null && candidate.page > file.page_count) continue;
    pages.push({ fileId: file.id, page: candidate.page });
    usedFiles.set(file.id, file);
  }
  return { pages, files: [...usedFiles.values()] };
}

async function countRecentMcpSaves(ctx: ToolContext, now: Date): Promise<number> {
  const since = new Date(now.getTime() - HOUR_MS).toISOString();
  const { count, error } = await ctx.db
    .from("saved_notes")
    .select("id", { count: "exact", head: true })
    .eq("student_id", ctx.studentId)
    .eq("source", "mcp")
    .gte("created_at", since);
  if (error) throw toDbToolError(error);
  return count ?? 0;
}

async function courseName(ctx: ToolContext, courseId: string): Promise<string | null> {
  const { data, error } = await ctx.db
    .from("courses")
    .select("name")
    .eq("student_id", ctx.studentId)
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw toDbToolError(error);
  return data?.name ?? null;
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "Error";
}

function smsTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length > SMS_TITLE_MAX ? `${flat.slice(0, SMS_TITLE_MAX - 1).trimEnd()}…` : flat;
}

/**
 * Texts the student a one-time link to the saved note. Never throws. Logs only
 * error names and statuses: no token, phone number, or provider/database text.
 */
async function textSavedNote(
  ctx: ToolContext,
  deps: SaveStudyGuideDeps,
  note: { id: string; title: string },
): Promise<TextStatus> {
  try {
    const admin = deps.createAdmin();
    const { data: profile, error } = await admin
      .from("profiles")
      .select("phone")
      .eq("id", ctx.studentId)
      .maybeSingle();
    if (error) {
      console.error("save_study_guide text: profile lookup failed", { code: error.code });
      return "failed";
    }
    const phone = profile?.phone?.trim();
    if (!phone) return "no_phone";

    const link = await createSavedNoteMagicLink(admin, {
      studentId: ctx.studentId,
      savedNoteId: note.id,
      appUrl: ctx.appUrl,
      ...(deps.now ? { now: deps.now() } : {}),
    });
    const body = `Pluto: your study guide "${smsTitle(note.title)}" is saved. Open it: ${link.url}`;
    const sent = await sendSms(
      { admin, ...(deps.sms ?? {}) },
      { studentId: ctx.studentId, to: phone, body },
    );
    if (!sent.ok) {
      console.error("save_study_guide text: send failed", { provider: sent.provider });
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("save_study_guide text failed", errorName(error));
    return "failed";
  }
}

export async function saveStudyGuide(
  ctx: ToolContext,
  rawInput: unknown,
  deps: SaveStudyGuideDeps,
): Promise<SaveStudyGuideOutput> {
  const spec = WRITE_TOOLS.save_study_guide;
  let input;
  try {
    input = spec.input.parse(rawInput);
  } catch (error) {
    if (error instanceof ZodError) throw new ToolError("invalid_input", zodMessage(error));
    throw new ToolError("invalid_input", "Invalid input.");
  }

  const now = deps.now?.() ?? new Date();
  const recent = await countRecentMcpSaves(ctx, now);
  if (recent >= SAVE_STUDY_GUIDE_HOURLY_LIMIT) {
    throw new WriteToolError(
      "rate_limited",
      `At most ${SAVE_STUDY_GUIDE_HOURLY_LIMIT} study guides can be saved per hour. Try again later.`,
    );
  }

  const resolved = input.course ? await resolveCourse(ctx, input.course) : null;
  const { pages, files } = await keepOwnedPages(ctx, extractCandidatePages(input.markdown, ctx.appUrl));

  let courseId: string | null = resolved?.courseId ?? null;
  let className: string | null = resolved?.name ?? null;
  if (!resolved) {
    const courseIds = new Set(files.map((file) => file.course_id));
    if (courseIds.size === 1) {
      courseId = [...courseIds][0]!;
      className = await courseName(ctx, courseId);
      if (className === null) courseId = null;
    }
  }

  const { data: row, error } = await ctx.db
    .from("saved_notes")
    .insert({
      student_id: ctx.studentId,
      course_id: courseId,
      session_id: null,
      source: "mcp",
      title: input.title,
      body: input.markdown,
      sources: pages,
    })
    .select("id, title")
    .single();
  if (error || !row) throw toDbToolError(error ?? new Error("no row returned"));

  const textStatus = await textSavedNote(ctx, deps, { id: row.id, title: row.title });

  return spec.output.parse({
    noteId: row.id,
    title: row.title,
    courseName: className,
    url: `${ctx.appUrl}${savedNotePath(row.id)}`,
    citedPages: pages.length,
    textStatus,
  });
}
