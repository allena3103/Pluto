import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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

  const [{ data: fileRows, error: filesError }, { data: courseRows, error: coursesError }] = await Promise.all([
    supabase
      .from("files")
      .select("id, course_id, title, week_label, added_at, ingest_status, ingest_error, page_count")
      .eq("student_id", user.id)
      .order("added_at", { ascending: false }),
    supabase.from("courses").select("id, name, term").eq("student_id", user.id).order("name", { ascending: true }),
  ]);

  if (filesError || coursesError) {
    throw filesError ?? coursesError;
  }

  const files = (fileRows ?? []) as NoteFileRow[];
  const courses = (courseRows ?? []) as CourseRow[];

  if (files.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Notes</h2>
        <Card>
          <CardHeader>
            <CardTitle>{EMPTY_STATE_TEXT}</CardTitle>
            <CardDescription>Upload or ingest lecture PDFs to see them here.</CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  const filesByCourse = new Map<string, NoteFileRow[]>();
  for (const file of files) {
    const existing = filesByCourse.get(file.course_id);
    if (existing) {
      existing.push(file);
    } else {
      filesByCourse.set(file.course_id, [file]);
    }
  }

  const orderedCourses = Array.from(filesByCourse.entries())
    .map(([courseId, courseFiles]) => {
      const course = courses.find((row) => row.id === courseId);
      return {
        courseId,
        courseName: course?.name ?? "Unknown course",
        term: course?.term ?? null,
        files: courseFiles,
      };
    })
    .sort((a, b) => a.courseName.localeCompare(b.courseName));

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Notes</h2>
      <div className="space-y-5">
        {orderedCourses.map((course) => {
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
            <div key={course.courseId} className="space-y-3">
              <div>
                <h3 className="text-base font-medium text-foreground">{course.courseName}</h3>
                {course.term ? <p className="text-xs text-muted-foreground">{course.term}</p> : null}
              </div>

              <div className="space-y-3">
                {orderedWeekGroups.map((group) => (
                  <div key={group.label ?? "no-week"} className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">{group.label ?? "No week label"}</p>

                    <div className="space-y-2">
                      {group.files.map((file) => (
                        <Link
                          key={file.id}
                          href={`/notes/${encodeURIComponent(file.id)}?page=1`}
                          className="block rounded-xl border bg-card text-card-foreground shadow-sm transition-colors hover:border-primary/40"
                        >
                          <CardContent className="space-y-2 px-4 py-3">
                            <p className="text-sm font-medium text-foreground">{file.title}</p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatAddedAt(file.added_at)}</span>
                              {file.page_count ? <span>{file.page_count} pages</span> : null}
                              {file.ingest_status !== "ready" ? (
                                <Badge variant={file.ingest_status === "failed" ? "destructive" : "secondary"}>
                                  {INGEST_LABEL[file.ingest_status]}
                                </Badge>
                              ) : null}
                              {file.ingest_status === "failed" && file.ingest_error ? (
                                <span className="w-full text-destructive">{file.ingest_error}</span>
                              ) : null}
                            </div>
                          </CardContent>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
