import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FileText } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PdfViewer } from "@/components/notes/pdf-viewer";
import { PageShell } from "@/components/page-shell";

const BACK_TO_NOTES = { href: "/notes", label: "All notes" };

type FileRow = {
  id: string;
  student_id: string;
  title: string;
  ingest_status: "pending" | "processing" | "ready" | "failed";
  ingest_error: string | null;
  page_count: number | null;
  storage_path: string | null;
};

function parsePage(
  rawPage: string | string[] | undefined,
  pageCount: number | null,
): { page: number; wasSanitized: boolean } {
  if (Array.isArray(rawPage)) {
    return { page: 1, wasSanitized: true };
  }

  if (!rawPage) {
    return { page: 1, wasSanitized: false };
  }

  if (!/^[1-9]\d*$/.test(rawPage)) {
    return { page: 1, wasSanitized: true };
  }

  const parsed = Number(rawPage);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return { page: 1, wasSanitized: true };
  }

  if (pageCount !== null && parsed > pageCount) {
    return { page: 1, wasSanitized: true };
  }

  return { page: parsed, wasSanitized: false };
}

type Props = {
  params: Promise<{ fileId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export default async function NoteFilePage({ params, searchParams }: Props) {
  const [{ fileId }, { page }] = await Promise.all([params, searchParams]);

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) {
    notFound();
  }

  const user = authData.user;
  const { data: file, error: fileError } = await supabase
    .from("files")
    .select("id, student_id, title, ingest_status, ingest_error, page_count, storage_path")
    .eq("id", fileId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (fileError) {
    throw fileError;
  }

  const typedFile = file as FileRow | null;
  if (!typedFile) {
    notFound();
  }

  const { page: initialPage, wasSanitized } = parsePage(page, typedFile.page_count);
  if (wasSanitized) {
    redirect(`/notes/${encodeURIComponent(typedFile.id)}?page=1`);
  }

  if (typedFile.ingest_status !== "ready" || !typedFile.storage_path) {
    return (
      <PageShell back={BACK_TO_NOTES} title={typedFile.title} icon={FileText} tint="sky">
        <Card>
          <CardHeader>
            <CardTitle>
              {typedFile.ingest_status === "failed"
                ? "Ingest failed"
                : typedFile.ingest_status === "processing"
                  ? "Still processing"
                  : "Waiting to ingest"}
            </CardTitle>
            <CardDescription>
              {typedFile.ingest_status === "failed" && typedFile.ingest_error
                ? typedFile.ingest_error
                : "Try again in a minute once the file is ready."}
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  if (!typedFile.storage_path.startsWith(`${user.id}/`)) {
    notFound();
  }

  const { data: signedUrlData, error: signedUrlError } = await supabase
    .storage
    .from("notes")
    .createSignedUrl(typedFile.storage_path, 60);
  if (signedUrlError || !signedUrlData?.signedUrl) {
    return (
      <PageShell back={BACK_TO_NOTES} title={typedFile.title} icon={FileText} tint="sky">
        <Card>
          <CardHeader>
            <CardTitle>Could not load this PDF</CardTitle>
            <CardDescription>Please refresh the page and try again.</CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  const { data: pageRows, error: pageError } = await supabase
    .from("file_pages")
    .select("page_number, text")
    .eq("student_id", user.id)
    .eq("file_id", typedFile.id)
    .order("page_number", { ascending: true });
  if (pageError) {
    throw pageError;
  }

  const pageText = new Map<number, string>();
  for (const row of pageRows ?? []) {
    if (row.text && typeof row.page_number === "number") {
      pageText.set(row.page_number, row.text);
    }
  }

  return (
    <PageShell
      back={BACK_TO_NOTES}
      title={typedFile.title}
      description={typedFile.page_count ? `${typedFile.page_count} pages` : undefined}
      icon={FileText}
      tint="sky"
      className="max-w-4xl"
    >
      <PdfViewer
        signedUrl={signedUrlData.signedUrl}
        initialPage={initialPage}
        pageCountHint={typedFile.page_count}
        pageTextByNumber={Object.fromEntries(pageText.entries())}
      />
    </PageShell>
  );
}
