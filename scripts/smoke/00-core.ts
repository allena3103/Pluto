// Core smoke test (foundation): as the seeded demo student, call every core tool function
// against local Supabase, check a known query returns the expected file and page, check the
// text cap sets `truncated`, and check `other@pluto.test` sees nothing of the demo student.
// Needs `npm run env:local` and `npm run seed` first.
import { createClient } from "@supabase/supabase-js";
import { makeToolContext, type PlutoDb, type ToolContext } from "@pluto/core/context";
import { parseNotePath } from "@pluto/core/deep-links";
import { getRecentNotes, TOOL_HANDLERS, ToolError } from "@pluto/core/tools/index";
import { requireEnv } from "../lib/env";
import { readManifest, seedFileId } from "../lib/seed-files";
import {
  COURSE_IDS,
  COURSE_NAMES,
  ATTACHMENT_ASSIGNMENT_ID,
  DATE_CHANGED_ASSIGNMENT_ID,
  DEMO_STUDENT_EMAIL,
  DEMO_STUDENT_ID,
  OTHER_COURSE_NAME,
  OTHER_STUDENT_EMAIL,
  OTHER_STUDENT_ID,
} from "../lib/seed-ids";

const TIMEOUT_MS = 15_000;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function signedInContext(email: string, passwordEnv: string, studentId: string): Promise<ToolContext> {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(TIMEOUT_MS) }),
    },
  });
  const { data, error } = await db.auth.signInWithPassword({ email, password: requireEnv(passwordEnv) });
  if (error || !data.user) throw new Error(`sign in as ${email} failed: ${error?.message ?? "no user"}`);
  check(data.user.id === studentId, `${email} has an unexpected id; run npm run seed`);
  return makeToolContext({ db: db as unknown as PlutoDb, studentId, appUrl: requireEnv("APP_URL") });
}

export default async function coreSmoke(): Promise<void> {
  const manifest = readManifest();
  const demo = await signedInContext(DEMO_STUDENT_EMAIL, "DEMO_STUDENT_PASSWORD", DEMO_STUDENT_ID);
  const other = await signedInContext(OTHER_STUDENT_EMAIL, "OTHER_STUDENT_PASSWORD", OTHER_STUDENT_ID);

  // --- every tool runs for the demo student -------------------------------------------
  const { courses } = await TOOL_HANDLERS.list_courses(demo, {});
  check(courses.length === 3, `list_courses: expected 3 courses, got ${courses.length}`);
  check(
    courses.some((c) => c.courseId === COURSE_IDS.history105 && c.name === COURSE_NAMES.history105),
    "list_courses: History 105 missing",
  );

  // The demo prompt: "my History 105 notes from the past 2 weeks".
  const recent = await TOOL_HANDLERS.get_recent_notes(demo, { course: "History 105" });
  const expectedRecent = manifest.filter((m) => m.courseKey === "history105" && m.addedDaysAgo < 14);
  check(expectedRecent.length >= 3, "manifest should have at least 3 History 105 files in the last 14 days");
  check(
    recent.files.length === expectedRecent.length,
    `get_recent_notes: expected ${expectedRecent.length} files, got ${recent.files.length}`,
  );
  check(!recent.truncated, "get_recent_notes: seed notes should fit under the cap");
  for (const file of recent.files) {
    check(file.pagesIncluded === file.pageCount && file.pages.length === file.pageCount, `${file.title}: pages missing`);
    check(file.pages[0]?.page === 1, `${file.title}: pages must start at 1`);
    for (const page of file.pages) {
      const link = parseNotePath(page.deepLink);
      check(link?.fileId === file.fileId && link.page === page.page, `${file.title}: bad deep link ${page.deepLink}`);
    }
  }

  // Text cap: a small cap must set `truncated` and never cut a page in half.
  const capped = await getRecentNotes(demo, { course: "History 105", days: 14 }, { textCapChars: 1_000 });
  check(capped.truncated, "get_recent_notes: truncated must be true when over the cap");
  check(capped.files.length === recent.files.length, "get_recent_notes: every file must still be listed when truncated");
  const cappedChars = capped.files.flatMap((f) => f.pages).reduce((n, p) => n + p.text.length, 0);
  check(cappedChars <= 1_000, "get_recent_notes: returned more text than the cap");

  // A known query returns the expected file and page.
  const target = manifest.find((m) => m.file === "hist105-week5-french-revolution.pdf");
  check(target, "manifest: French Revolution lecture missing");
  const targetPage = target.pages[2]!;
  const targetFileId = seedFileId(DEMO_STUDENT_ID, target.file);
  const search = await TOOL_HANDLERS.search_notes(demo, { query: targetPage.query });
  const top = search.results[0];
  check(top, `search_notes: no results for "${targetPage.query}"`);
  check(
    top.fileId === targetFileId && top.page === targetPage.page,
    `search_notes: expected ${target.file} page ${targetPage.page}, got ${top.title} page ${top.page}`,
  );
  check(top.deepLink.endsWith(`/notes/${targetFileId}?page=${targetPage.page}`), `search_notes: bad deep link ${top.deepLink}`);

  // Every manifest query finds its own page first.
  for (const entry of manifest) {
    for (const page of entry.pages) {
      const res = await TOOL_HANDLERS.search_notes(demo, { query: page.query, limit: 3 });
      const hit = res.results[0];
      check(
        hit?.fileId === seedFileId(DEMO_STUDENT_ID, entry.file) && hit.page === page.page,
        `search_notes: "${page.query}" should hit ${entry.file} page ${page.page}`,
      );
    }
  }

  const notePages = await TOOL_HANDLERS.get_note_pages(demo, { fileId: targetFileId, firstPage: 2, lastPage: 3 });
  check(notePages.pages.map((p) => p.page).join(",") === "2,3", "get_note_pages: expected pages 2 and 3");
  check(notePages.pages[1]!.text.includes(targetPage.fact), "get_note_pages: page 3 text does not match the manifest");

  const { deadlines } = await TOOL_HANDLERS.get_deadlines(demo, {});
  check(deadlines.length > 0, "get_deadlines: expected upcoming assignments");
  const moved = deadlines.find((d) => d.assignmentId === DATE_CHANGED_ASSIGNMENT_ID);
  check(moved?.previousDueAt, "get_deadlines: the seeded date change should show previousDueAt");

  // The seeded assignment with a Word handout (read) and a spreadsheet (listed only).
  const lab = deadlines.find((d) => d.assignmentId === ATTACHMENT_ASSIGNMENT_ID);
  check(lab?.attachmentCount === 2, "get_deadlines: the seeded lab report should list 2 attachments");
  const assignment = await TOOL_HANDLERS.get_assignment(demo, { assignmentId: ATTACHMENT_ASSIGNMENT_ID });
  check(assignment.instructions, "get_assignment: instructions missing");
  const handout = assignment.attachments.find((a) => a.fileType === "docx");
  check(handout?.status === "ready" && handout.pages.length > 0, "get_assignment: the Word handout text is missing");
  check(assignment.attachments.some((a) => a.fileType === "other" && a.pages.length === 0), "get_assignment: spreadsheet should be listed without text");

  const grades = await TOOL_HANDLERS.get_grades(demo, { course: "History 105" });
  check(grades.courses.length === 1, "get_grades: expected one course");
  check(typeof grades.courses[0]!.weightedGradePercent === "number", "get_grades: weighted grade missing");

  const { weeks } = await TOOL_HANDLERS.get_crunch_weeks(demo, {});
  check(weeks.length > 0 && weeks[0]!.rank === 1, "get_crunch_weeks: expected a ranked list");
  check(weeks[0]!.deliverableCount >= 4, "get_crunch_weeks: the seeded crunch week should rank first");

  // --- isolation: the other student sees nothing of the demo student --------------------
  const otherCourses = await TOOL_HANDLERS.list_courses(other, {});
  check(
    otherCourses.courses.length === 1 && otherCourses.courses[0]!.name === OTHER_COURSE_NAME,
    "isolation: other student should see only their own course",
  );
  const otherSearch = await TOOL_HANDLERS.search_notes(other, { query: targetPage.query });
  check(otherSearch.results.length === 0, "isolation: other student found the demo student's notes by search");

  const mustFail = async (label: string, run: () => Promise<unknown>, code: string) => {
    try {
      await run();
    } catch (err) {
      check(err instanceof ToolError && err.code === code, `isolation: ${label} failed with the wrong error`);
      return;
    }
    throw new Error(`isolation: ${label} should not succeed for the other student`);
  };
  await mustFail("get_note_pages on a demo file", () => TOOL_HANDLERS.get_note_pages(other, { fileId: targetFileId }), "file_not_found");
  await mustFail("get_recent_notes by demo course id", () => TOOL_HANDLERS.get_recent_notes(other, { course: COURSE_IDS.history105 }), "course_not_found");
  await mustFail("get_recent_notes by demo course name", () => TOOL_HANDLERS.get_recent_notes(other, { course: "History 105" }), "course_not_found");
  await mustFail("get_assignment on a demo assignment", () => TOOL_HANDLERS.get_assignment(other, { assignmentId: ATTACHMENT_ASSIGNMENT_ID }), "assignment_not_found");

  const demoDeadlineIds = new Set(deadlines.map((d) => d.assignmentId));
  const otherDeadlines = await TOOL_HANDLERS.get_deadlines(other, { daysAhead: 365 });
  check(
    otherDeadlines.deadlines.every((d) => !demoDeadlineIds.has(d.assignmentId)),
    "isolation: other student sees a demo deadline",
  );
  const otherGrades = await TOOL_HANDLERS.get_grades(other, {});
  check(
    otherGrades.courses.every((c) => c.courseName === OTHER_COURSE_NAME),
    "isolation: other student sees demo grades",
  );

  // A wrong studentId on someone else's session must not widen access (RLS still applies).
  const spoofed = makeToolContext({ db: other.db, studentId: DEMO_STUDENT_ID, appUrl: other.appUrl });
  const spoofedCourses = await TOOL_HANDLERS.list_courses(spoofed, {});
  check(spoofedCourses.courses.length === 0, "isolation: spoofed studentId returned the demo student's courses");
}
