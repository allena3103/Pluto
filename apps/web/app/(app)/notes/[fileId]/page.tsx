import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PdfViewer } from "@/components/notes/pdf-viewer";

type FileRow = {
  id: string;
  student_id: string;
  title: string;
  ingest_status: "pending" | "processing" | "ready" | "failed";
  ingest_error: string | null;
  page_count: number | null;
  storage_path: string | null;
};

function parsePage(rawPage: string | string[] | undefined, pageCount: number | null): number {
  if (Array.isArray(rawPage)) {
    return 1;
  }

  if (!rawPage || !/^[1-9]\d*$/.test(rawPage)) {
    return 1;
  }

  const parsed = Number(rawPage);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return 1;
  }

  if (pageCount !== null && parsed > pageCount) {
    return 1;
  }

  return parsed;
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

  const initialPage = parsePage(page, typedFile.page_count);

  if (typedFile.ingest_status !== "ready" || !typedFile.storage_path) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{typedFile.title}</CardTitle>
          <CardDescription>
            {typedFile.ingest_status === "failed"
              ? "Ingest failed"
              : typedFile.ingest_status === "processing"
                ? "Still processing"
                : "Waiting to ingest"}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {typedFile.ingest_status === "failed" && typedFile.ingest_error
            ? typedFile.ingest_error
            : "Try again in a minute once the file is ready."}
        </CardContent>
      </Card>
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
      <Card>
        <CardHeader>
          <CardTitle>{typedFile.title}</CardTitle>
          <CardDescription>Could not load this PDF</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Please refresh the page and try again.
        </CardContent>
      </Card>
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
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{typedFile.title}</h2>
        {typedFile.page_count ? (
          <p className="text-xs text-muted-foreground">{typedFile.page_count} pages</p>
        ) : null}
      </div>
      <PdfViewer
        signedUrl={signedUrlData.signedUrl}
        initialPage={initialPage}
        pageCountHint={typedFile.page_count}
        pageTextByNumber={Object.fromEntries(pageText.entries())}
      />
    </section>
  );
}
