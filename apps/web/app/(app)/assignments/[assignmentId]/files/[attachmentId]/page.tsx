import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { assignmentFilePath, assignmentPath } from "@pluto/core/deep-links";
import {
  UUID,
  fileTypeLabel,
  parsePageParam,
  type AttachmentFileType,
  type AttachmentStatus,
} from "@/components/assignments/shared";
import { MarkdownText } from "@/components/markdown-text";
import { PdfViewer } from "@/components/notes/pdf-viewer";
import { PageShell } from "@/components/page-shell";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type FileRow = {
  id: string;
  title: string;
  file_type: AttachmentFileType;
  ingest_status: AttachmentStatus;
  page_count: number | null;
  storage_path: string | null;
  assignments: { title: string };
};

type Props = {
  params: Promise<{ assignmentId: string; attachmentId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

const PAGER_LINK =
  "inline-flex items-center gap-1 rounded-full border border-input bg-card px-3 py-1.5 text-sm font-bold text-foreground shadow-warm-sm transition-colors hover:bg-accent hover:text-accent-foreground";
const PAGER_DISABLED =
  "inline-flex items-center gap-1 rounded-full border border-input/60 px-3 py-1.5 text-sm font-bold text-muted-foreground/60";

function DocPager({ assignmentId, attachmentId, page, pageCount }: {
  assignmentId: string;
  attachmentId: string;
  page: number;
  pageCount: number;
}) {
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2">
      {page > 1 ? (
        <Link href={assignmentFilePath(assignmentId, attachmentId, page - 1)} className={PAGER_LINK} rel="prev">
          <ChevronLeft className="size-4" aria-hidden />
          Previous
        </Link>
      ) : (
        <span className={PAGER_DISABLED} aria-disabled="true">
          <ChevronLeft className="size-4" aria-hidden />
          Previous
        </span>
      )}
      <span className="text-sm font-bold text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={assignmentFilePath(assignmentId, attachmentId, page + 1)} className={PAGER_LINK} rel="next">
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span className={PAGER_DISABLED} aria-disabled="true">
          Next
          <ChevronRight className="size-4" aria-hidden />
        </span>
      )}
    </nav>
  );
}

export default async function AssignmentFilePage({ params, searchParams }: Props) {
  const [{ assignmentId, attachmentId }, { page: rawPage }] = await Promise.all([params, searchParams]);
  if (!UUID.test(assignmentId) || !UUID.test(attachmentId)) notFound();

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) notFound();
  const studentId = authData.user.id;

  const { data, error } = await supabase
    .from("assignment_files")
    .select("id, title, file_type, ingest_status, page_count, storage_path, assignments!inner(title)")
    .eq("id", attachmentId)
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  const file = data as FileRow | null;
  if (!file) notFound();

  const back = { href: assignmentPath(assignmentId), label: "Back to assignment" };
  const typeLabel = fileTypeLabel(file.file_type);
  const notice = (title: string, description: string) => (
    <PageShell back={back} title={file.title} description={file.assignments.title} icon={FileText} tint="sky">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </PageShell>
  );

  if (file.file_type === "other") {
    return notice("Pluto reads PDF and Word files only", "Open this file from the assignment in Canvas.");
  }
  if (file.ingest_status === "pending") {
    return notice("Not downloaded yet", "Sync Canvas, then open this file again.");
  }
  if (file.ingest_status !== "ready") {
    return notice("Could not read this file", "Open it from the assignment in Canvas instead.");
  }

  const page = parsePageParam(rawPage, file.page_count);
  if (page === null) redirect(assignmentFilePath(assignmentId, attachmentId, 1));

  const pagesLabel = file.page_count ? ` · ${file.page_count} ${file.page_count === 1 ? "page" : "pages"}` : "";
  const description = `${file.assignments.title} · ${typeLabel}${pagesLabel}`;

  if (file.file_type === "pdf") {
    if (!file.storage_path || !file.storage_path.startsWith(`${studentId}/`)) {
      return notice("Not downloaded yet", "Sync Canvas, then open this file again.");
    }
    const [{ data: signed, error: signedError }, { data: pageRows, error: pagesError }] = await Promise.all([
      supabase.storage.from("assignment-files").createSignedUrl(file.storage_path, 60),
      supabase
        .from("assignment_file_pages")
        .select("page_number, text")
        .eq("student_id", studentId)
        .eq("assignment_file_id", file.id)
        .order("page_number", { ascending: true }),
    ]);
    if (pagesError) throw pagesError;
    if (signedError || !signed?.signedUrl) {
      return notice("Could not load this PDF", "Please refresh the page and try again.");
    }
    const pageTextByNumber: Record<number, string> = {};
    for (const row of pageRows ?? []) {
      if (row.text) pageTextByNumber[row.page_number] = row.text;
    }
    return (
      <PageShell back={back} title={file.title} description={description} icon={FileText} tint="sky" className="max-w-4xl">
        <PdfViewer
          signedUrl={signed.signedUrl}
          initialPage={page}
          pageCountHint={file.page_count}
          pageTextByNumber={pageTextByNumber}
        />
      </PageShell>
    );
  }

  const { data: pageRow, error: pageError } = await supabase
    .from("assignment_file_pages")
    .select("page_number, text")
    .eq("student_id", studentId)
    .eq("assignment_file_id", file.id)
    .eq("page_number", page)
    .maybeSingle();
  if (pageError) throw pageError;
  const pageCount = Math.max(file.page_count ?? page, page);
  const text = pageRow?.text?.trim();

  return (
    <PageShell back={back} title={file.title} description={description} icon={FileText} tint="sky">
      <div className="flex flex-col gap-4">
        {pageCount > 1 ? (
          <DocPager assignmentId={assignmentId} attachmentId={attachmentId} page={page} pageCount={pageCount} />
        ) : null}
        <article
          id={`page-${page}`}
          aria-label={`Page ${page}`}
          className="rounded-3xl border border-border/80 bg-card p-5 text-[0.97rem] leading-relaxed break-words text-foreground shadow-warm sm:p-6"
        >
          {text ? <MarkdownText text={text} /> : <p className="text-muted-foreground">This page has no text.</p>}
        </article>
        {pageCount > 1 ? (
          <DocPager assignmentId={assignmentId} attachmentId={attachmentId} page={page} pageCount={pageCount} />
        ) : null}
      </div>
    </PageShell>
  );
}
