import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Clock, ClipboardList, ExternalLink, File, FileText, Paperclip } from "lucide-react";
import { assignmentFilePath } from "@pluto/core/deep-links";
import {
  UUID,
  assignmentStatus,
  fileTypeLabel,
  safeCanvasUrl,
  type AttachmentFileType,
  type AttachmentStatus,
} from "@/components/assignments/shared";
import { formatDueDate, formatDueTime } from "@/components/deadlines/format";
import { StatusBadge } from "@/components/deadlines/status-badge";
import { MarkdownText } from "@/components/markdown-text";
import { PageShell } from "@/components/page-shell";
import { createClient } from "@/lib/supabase/server";

const BACK_TO_DEADLINES = { href: "/deadlines", label: "Deadlines" };

type AttachmentRow = {
  id: string;
  title: string;
  file_type: AttachmentFileType;
  ingest_status: AttachmentStatus;
  page_count: number | null;
};

function attachmentNote(file: AttachmentRow): string {
  if (file.file_type === "other") return "Listed by name only";
  if (file.ingest_status === "ready") {
    return file.page_count ? `${file.page_count} ${file.page_count === 1 ? "page" : "pages"}` : "Ready";
  }
  if (file.ingest_status === "pending") return "Not downloaded yet, sync Canvas";
  return "Could not read this file";
}

type Props = { params: Promise<{ assignmentId: string }> };

export default async function AssignmentPage({ params }: Props) {
  const { assignmentId } = await params;
  if (!UUID.test(assignmentId)) notFound();

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) notFound();
  const studentId = authData.user.id;

  const [{ data: assignment, error }, { data: files, error: filesError }] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, title, due_at, points_possible, graded, submitted, description, canvas_url, courses!inner(name)")
      .eq("id", assignmentId)
      .eq("student_id", studentId)
      .maybeSingle(),
    supabase
      .from("assignment_files")
      .select("id, title, file_type, ingest_status, page_count")
      .eq("assignment_id", assignmentId)
      .eq("student_id", studentId)
      .order("title", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (error) throw error;
  if (filesError) throw filesError;
  if (!assignment) notFound();

  const attachments = (files ?? []) as AttachmentRow[];
  const canvasUrl = safeCanvasUrl(assignment.canvas_url);
  const status = assignmentStatus(assignment, new Date().toISOString());
  const instructions = assignment.description?.trim();
  const hasUnreadable = attachments.some((file) => file.file_type === "other");

  return (
    <PageShell
      back={BACK_TO_DEADLINES}
      title={assignment.title}
      description={assignment.courses.name}
      icon={ClipboardList}
      tint="butter"
    >
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
        <StatusBadge status={status} />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 font-bold text-accent-foreground">
          <Clock className="size-3.5" aria-hidden />
          {assignment.due_at
            ? `${formatDueDate(assignment.due_at)} · ${formatDueTime(assignment.due_at)}`
            : "No due date"}
        </span>
        <span>{assignment.points_possible !== null ? `${assignment.points_possible} pts` : "No points listed"}</span>
      </div>

      <section aria-labelledby="instructions-heading" className="mb-8">
        <h2 id="instructions-heading" className="mb-3 text-sm font-extrabold text-muted-foreground">
          Instructions
        </h2>
        <article className="rounded-3xl border border-border/80 bg-card p-5 text-[0.97rem] leading-relaxed break-words text-foreground shadow-warm sm:p-6">
          {instructions ? (
            <MarkdownText text={instructions} />
          ) : (
            <p className="text-muted-foreground">No instructions in Canvas.</p>
          )}
        </article>
      </section>

      <section aria-labelledby="attachments-heading">
        <h2 id="attachments-heading" className="mb-3 inline-flex items-center gap-1.5 text-sm font-extrabold text-muted-foreground">
          <Paperclip className="size-4" aria-hidden />
          Attachments
        </h2>
        {attachments.length === 0 ? (
          <p className="rounded-3xl border-2 border-dashed border-input bg-card/60 px-5 py-6 text-sm text-muted-foreground">
            No files attached to this assignment.
          </p>
        ) : (
          <ul aria-label="Attachments" className="flex flex-col gap-3">
            {attachments.map((file) => {
              const Icon = file.file_type === "other" ? File : FileText;
              const readable = file.file_type !== "other" && file.ingest_status === "ready";
              const body = (
                <>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sky-tint text-sky-700">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-extrabold break-words text-foreground">{file.title}</span>
                    <span className="block text-sm font-semibold text-muted-foreground">
                      {fileTypeLabel(file.file_type)} · {attachmentNote(file)}
                    </span>
                  </span>
                </>
              );
              const rowClass =
                "flex items-center gap-3 rounded-3xl border border-border/80 bg-card p-4 shadow-warm";

              if (readable) {
                return (
                  <li key={file.id}>
                    <Link
                      href={assignmentFilePath(assignment.id, file.id)}
                      className={`${rowClass} transition-transform hover:-translate-y-0.5 hover:border-primary/40`}
                    >
                      {body}
                      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                );
              }

              return (
                <li key={file.id} className={rowClass}>
                  {body}
                  {file.file_type === "other" && canvasUrl ? (
                    <a
                      href={canvasUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-input px-3 py-1.5 text-xs font-bold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      Open in Canvas
                      <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {hasUnreadable ? (
          <p className="mt-3 text-sm text-muted-foreground">Pluto reads PDF and Word files only.</p>
        ) : null}
      </section>
    </PageShell>
  );
}
