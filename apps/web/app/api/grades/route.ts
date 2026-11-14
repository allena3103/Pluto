import { GradesRequest, GradesResponse } from "@pluto/core/contract";
import { getGrades } from "@pluto/core/tools/get-grades";
import { ToolError } from "@pluto/core/tools/tool-error";
import { createClient } from "@/lib/supabase/server";
import { getServerEnv } from "@/lib/env";
import { makeToolContext } from "@pluto/core/context";
import { httpStatusForToolError } from "@/components/grades/tool-error-status";

export const dynamic = "force-dynamic";

const ERROR_TEXT: Record<ToolError["code"], string> = {
  invalid_input: "Invalid request.",
  course_not_found: "Course not found.",
  course_ambiguous: "More than one course matches. Be more specific.",
  file_not_found: "Not found.",
  db_error: "Something went wrong.",
};

function parseCourseParam(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = GradesRequest.safeParse({ course: parseCourseParam(searchParams.get("course")) });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const ctx = makeToolContext({
    db: supabase,
    studentId: user.id,
    appUrl: getServerEnv().appUrl,
  });

  try {
    const out = await getGrades(ctx, parsed.data);
    const body = GradesResponse.parse(out);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ToolError) {
      if (error.code === "db_error") {
        console.error("grades route db_error", error.message);
      }
      return Response.json(
        { error: ERROR_TEXT[error.code] ?? "Something went wrong." },
        { status: httpStatusForToolError(error), headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "Something went wrong." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}