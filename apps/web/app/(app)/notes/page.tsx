import Link from "next/link";
import { BookmarkCheck, ChevronRight, FileText } from "lucide-react";
import { DeleteSavedNoteButton } from "@/components/notes/delete-saved-note-button";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageShell, TINT_CLASSES, type PageTint } from "@/components/page-shell";

const COURSE_TINTS: readonly PageTint[] = ["peach", "sky", "mint", "butter", "lilac"];

type NoteFileRow = {
  id: string;
  course_id: string;
  title: string;
  week_label: string | null;
  added_at: string;
  ingest_status: "pending" | "processing" | "ready" | "failed";
  ingest_error: string | null;
  page_count: number | null;
};

type CourseRow = {
  id: string;
  name: string;
  term: string | null;
};

type SavedNoteRow = {
  id: string;
  course_id: string | null;
  title: string;
  created_at: string;
  source: string;
};

/** Section key for chat answers that cite more than one class. Not a uuid, so it never collides. */
const ACROSS_CLASSES = "__across__";
const SAVED_NOTES_LIMIT = 200;
const PAGE_DESCRIPTION = "Your lecture notes and the study guides you made in chat, by class.";

const INGEST_LABEL: Record<NoteFileRow["ingest_status"], string> = {
  pending: "Pending",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

const EMPTY_STATE_TEXT = "No lecture notes yet";

function formatAddedAt(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function NotesPage() {
  const supabase = await createClient();
  const [{ data: authData, error: authError }] = await Promise.all([supabase.auth.getUser()]);

  if (authError || !authData.user) {
    return null;
  }

  const user = authData.user;

  const [
    { data: fileRows, error: filesError },
    { data: courseRows, error: coursesError },
    { data: savedRows, error: savedError },
  ] = await Promise.all([
    supabase
      .from("files")
      .select("id, course_id, title, week_label, added_at, ingest_status, ingest_error, page_count")
      .eq("student_id", user.id)
      .order("added_at", { ascending: false }),
    supabase.from("courses").select("id, name, term").eq("student_id", user.id).order("name", { ascending: true }),
    supabase
      .from("saved_notes")
      .select("id, course_id, title, created_at, source")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(SAVED_NOTES_LIMIT),
  ]);

  if (filesError || coursesError || savedError) {
    throw filesError ?? coursesError ?? savedError;
  }

  const files = (fileRows ?? []) as NoteFileRow[];
  const courses = (courseRows ?? []) as CourseRow[];
  const savedNotes = (savedRows ?? []) as SavedNoteRow[];

  if (files.length === 0 && savedNotes.length === 0) {
    return (
      <PageShell title="Notes" description={PAGE_DESCRIPTION} icon={FileText} tint="sky">
        <EmptyState title={EMPTY_STATE_TEXT}>Upload or ingest lecture PDFs to see them here.</EmptyState>
      </PageShell>
    );
  }

  // One section per class. Chat answers that cite several classes go in a last section.
  const sections = new Map<string, { files: NoteFileRow[]; saved: SavedNoteRow[] }>();
  const sectionFor = (key: string) => {
    let section = sections.get(key);
    if (!section) {
      section = { files: [], saved: [] };
      sections.set(key, section);
    }
    return section;
  };
  for (const file of files) sectionFor(file.course_id).files.push(file);
  for (const note of savedNotes) sectionFor(note.course_id ?? ACROSS_CLASSES).saved.push(note);

  const orderedCourses = Array.from(sections.entries())
    .map(([courseId, section]) => {
      const course = courses.find((row) => row.id === courseId);
      return {
        courseId,
        courseName: courseId === ACROSS_CLASSES ? "Across classes" : (course?.name ?? "Unknown course"),
        term: course?.term ?? null,
        files: section.files,
        saved: section.saved,
      };
    })
    .sort((a, b) => {
      if (a.courseId === ACROSS_CLASSES) return 1;
      if (b.courseId === ACROSS_CLASSES) return -1;
      return a.courseName.localeCompare(b.courseName);
    });

  return (
    <PageShell title="Notes" description={PAGE_DESCRIPTION} icon={FileText} tint="sky">
      <div className="space-y-6">
        {orderedCourses.map((course, courseIndex) => {
          const tint = TINT_CLASSES[COURSE_TINTS[courseIndex % COURSE_TINTS.length] ?? "peach"];
          const weekGroups = new Map<string, { label: string | null; files: NoteFileRow[] }>();
          for (const file of course.files) {
            const key = file.week_label ?? "__none__";
            const existing = weekGroups.get(key);
            if (existing) {
              existing.files.push(file);
            } else {
              weekGroups.set(key, { label: file.week_label, files: [file] });
            }
          }

          const orderedWeekGroups = Array.from(weekGroups.values()).sort((a, b) => {
            if (a.label === null && b.label === null) return 0;
            if (a.label === null) return 1;
            if (b.label === null) return -1;
            return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
          });

          return (
            <section
              key={course.courseId}
              className="rounded-3xl border border-border/80 bg-card/80 p-4 shadow-warm sm:p-5"
            >
              <div className="flex items-center gap-3">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${tint}`}>
                  <FileText className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg leading-tight font-extrabold break-words text-foreground">{course.courseName}</h2>
                  {course.term ? <p className="text-xs font-semibold text-muted-foreground">{course.term}</p> : null}
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {course.saved.length > 0 ? (
                  <div className="space-y-2">
                    <p className="inline-flex rounded-full bg-mint/70 px-3 py-1 text-xs font-extrabold text-emerald-900">
                      Saved by chat or AI
                    </p>
                    <div className="space-y-2">
                      {course.saved.map((note) => (
                        <div
                          key={note.id}
                          className="flex items-center gap-1 rounded-2xl border border-border/80 bg-card pr-2 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-warm"
                        >
                          <Link
                            href={`/notes/saved/${encodeURIComponent(note.id)}`}
                            className="group flex min-w-0 flex-1 items-center gap-3 py-3 pl-4"
                          >
                            <BookmarkCheck className="size-5 shrink-0 text-emerald-600" aria-hidden />
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="text-[0.95rem] font-bold break-words text-foreground">{note.title}</p>
                              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
                                <span>Saved {formatAddedAt(note.created_at)}</span>
                                {note.source === "mcp" ? <Badge variant="secondary">From Claude</Badge> : null}
                              </p>
                            </div>
                            <ChevronRight
                              className="size-5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                              aria-hidden
                            />
                          </Link>
                          <DeleteSavedNoteButton noteId={note.id} title={note.title} variant="icon" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {orderedWeekGroups.map((group) => (
                  <div key={group.label ?? "no-week"} className="space-y-2">
                    <p className="inline-flex rounded-full bg-muted px-3 py-1 text-xs font-extrabold text-muted-foreground">
                      {group.label ?? "No week label"}
                    </p>

                    <div className="space-y-2">
                      {group.files.map((file) => (
                        <Link
                          key={file.id}
                          href={`/notes/${encodeURIComponent(file.id)}?page=1`}
                          className="group flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-warm"
                        >
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <p className="text-[0.95rem] font-bold break-words text-foreground">{file.title}</p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
                              <span>{formatAddedAt(file.added_at)}</span>
                              {file.page_count ? <span>· {file.page_count} pages</span> : null}
                              {file.ingest_status !== "ready" ? (
                                <Badge variant={file.ingest_status === "failed" ? "destructive" : "secondary"}>
                                  {INGEST_LABEL[file.ingest_status]}
                                </Badge>
                              ) : null}
                              {file.ingest_status === "failed" && file.ingest_error ? (
                                <span className="w-full text-red-600">{file.ingest_error}</span>
                              ) : null}
                            </div>
                          </div>
                          <ChevronRight
                            className="size-5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                            aria-hidden
                          />
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}
