import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { INTERNAL_SECRET_HEADER, IngestRequest, IngestResponse } from "@pluto/core/contract";
import { ingestFile } from "@pluto/core/ingest";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/ingest  { fileId }  ->  { fileId, status, pageCount?, error? }
// Server-to-server only: the caller must send INTERNAL_API_SECRET in `x-internal-secret`.
// The secret is checked before any database work and before the service-role client exists.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    // Never run open when the secret is not configured.
    return NextResponse.json({ error: "Server is not configured." }, { status: 500 });
  }
  if (!secretMatches(request.headers.get(INTERNAL_SECRET_HEADER), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = IngestRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Body must be { fileId: <uuid> }." }, { status: 400 });
  }

  try {
    const result = await ingestFile(createAdminClient(), parsed.data.fileId);
    if (!result) return NextResponse.json({ error: "File not found." }, { status: 404 });
    return NextResponse.json(IngestResponse.parse(result));
  } catch (err) {
    console.error("ingest route failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Ingest failed." }, { status: 500 });
  }
}
