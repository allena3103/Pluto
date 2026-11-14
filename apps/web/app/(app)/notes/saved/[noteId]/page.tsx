import Link from "next/link";
import { notFound } from "next/navigation";
import { BookmarkCheck, FileText, Trash2 } from "lucide-react";
import { notePath } from "@pluto/core/deep-links";
import { MarkdownText } from "@/components/markdown-text";
import { PageShell } from "@/components/page-shell";
import { parseSources } from "@/lib/saved-notes";
import { createClient } from "@/lib/supabase/server";
import { deleteSavedNote } from "./actions";

const BACK_TO_NOTES = { href: "/notes", label: "All notes" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatSavedAt(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

type Props = { params: Promise<{ noteId: string }> };

export default async function SavedNotePage({ params }: Props) {
  const { noteId } = await params;
  if (!UUID.test(noteId)) notFound();

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) notFound();
  const studentId = authData.user.id;

  const { data: note, error } = await supabase
    .from("saved_notes")
    .select("id, course_id, title, body, sources, created_at")
    .eq("id", noteId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  if (!note) notFound();

  const sources = parseSources(note.sources);
  const fileIds = [...new Set(sources.map((source) => source.fileId))];

  const [{ data: course }, { data: files }] = await Promise.all([
    note.course_id
      ? supabase.from("courses").select("name").eq("student_id", studentId).eq("id", note.course_id).maybeSingle()
      : Promise.resolve({ data: null }),
    fileIds.length > 0
      ? supabase.from("files").select("id, title").eq("student_id", studentId).in("id", fileIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const fileTitles = new Map((files ?? []).map((file) => [file.id, file.title]));
  // Pages whose file was deleted (or is not this student's) are not shown.
  const visibleSources = sources.filter((source) => fileTitles.has(source.fileId));

  return (
    <PageShell
      back={BACK_TO_NOTES}
      title={note.title}
      description={`${course?.name ?? "Across classes"} · Saved from chat ${formatSavedAt(note.created_at)}`}
      icon={BookmarkCheck}
      tint="mint"
    >
      <article className="rounded-3xl border border-border/80 bg-card p-5 text-[0.97rem] leading-relaxed text-foreground shadow-warm sm:p-6">
        <MarkdownText text={note.body} />
      </article>

      {visibleSources.length > 0 && (
        <section className="mt-6 space-y-2" aria-label="Sources">
          <h2 className="text-sm font-extrabold text-muted-foreground">Sources</h2>
          <ul className="flex flex-wrap gap-2">
            {visibleSources.map((source) => (
              <li key={`${source.fileId}-${source.page}`} className="max-w-full">
                <Link
                  href={notePath(source.fileId, source.page)}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-input bg-card px-3 py-1.5 text-xs font-bold text-foreground shadow-warm-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground"
                >
                  <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">
                    {fileTitles.get(source.fileId)} p.{source.page}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={deleteSavedNote} className="mt-8">
        <input type="hidden" name="noteId" value={note.id} />
        <button
          type="submit"
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-input bg-card px-4 py-2 text-sm font-bold text-red-700 shadow-warm-sm transition-all hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete this note
        </button>
      </form>
    </PageShell>
  );
}
