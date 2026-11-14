import type { PlutoDb } from "@pluto/core/context";
import { AlertDeadlineChangeRequest, AlertResponse, INTERNAL_SECRET_HEADER } from "@pluto/core/contract";
import { calendarFeedUrl, newFeedToken } from "@pluto/core/ics";
import { secretMatches } from "./agent-reply";
import { formatDayTime, json, sendAlertText, studyBlockEndingAt, type AlertSmsDeps } from "./alerts-demo";

export type DeadlineChangeDeps = AlertSmsDeps & {
  /** `INTERNAL_API_SECRET`. Missing means the route refuses to run. */
  expectedSecret: string | undefined;
  appUrl: string | undefined;
  /** Called only after the secret matches. */
  createAdmin: () => PlutoDb;
};

export function deadlineMessage(
  input: { title: string; courseName: string | null; oldDueAt: string; newDueAt: string },
  calendarUrl: string,
): string {
  const course = input.courseName ? ` (${input.courseName})` : "";
  return (
    `Pluto: "${input.title}"${course} moved from ${formatDayTime(input.oldDueAt)} to ${formatDayTime(input.newDueAt)}. ` +
    `Updated study block: ${calendarUrl}`
  );
}

/**
 * POST /api/alerts/deadline-change  AlertDeadlineChangeRequest  ->  AlertResponse.
 * Server-to-server (Canvas sync). The secret is checked before the body is read and
 * before the service-role client exists. Every query is scoped to the body's `studentId`.
 */
export async function handleDeadlineChange(request: Request, deps: DeadlineChangeDeps): Promise<Response> {
  if (!deps.expectedSecret || !deps.appUrl) return json({ error: "Server is not configured." }, 500);
  if (!secretMatches(request.headers.get(INTERNAL_SECRET_HEADER), deps.expectedSecret)) {
    return json({ error: "Unauthorized." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  const parsed = AlertDeadlineChangeRequest.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Body must be { studentId, assignmentId, oldDueAt, newDueAt }." }, 400);
  }
  const { studentId, assignmentId, oldDueAt, newDueAt } = parsed.data;
  const slot = studyBlockEndingAt(newDueAt);
  if (!slot) return json({ error: "newDueAt is not a valid date." }, 400);

  try {
    const admin = deps.createAdmin();

    // Scoped to this student: another student's assignment id is simply not found.
    const { data: assignment, error: assignmentError } = await admin
      .from("assignments")
      .select("id,title,course_id,courses(name)")
      .eq("student_id", studentId)
      .eq("id", assignmentId)
      .maybeSingle();
    if (assignmentError) throw new Error(`failed to load assignment: ${assignmentError.message}`);
    if (!assignment) return json({ error: "Assignment not found." }, 404);

    const token = newFeedToken();
    const calendarUrl = calendarFeedUrl(deps.appUrl, token);
    const message = deadlineMessage(
      { title: assignment.title, courseName: assignment.courses?.name ?? null, oldDueAt, newDueAt },
      calendarUrl,
    );

    const { data: alert, error: alertError } = await admin
      .from("alerts")
      .insert({
        student_id: studentId,
        kind: "date_change",
        assignment_id: assignment.id,
        message,
        calendar_feed_token: token,
      })
      .select("id")
      .single();
    if (alertError || !alert) throw new Error(`failed to insert alert: ${alertError?.message ?? "no row"}`);

    // study_blocks has no assignment column: the block belongs to this new alert, and
    // the alert's feed holds exactly this one block for the moved assignment.
    const { error: blockError } = await admin.from("study_blocks").insert({
      student_id: studentId,
      alert_id: alert.id,
      course_id: assignment.course_id,
      title: `Study: ${assignment.title}${assignment.courses?.name ? ` (${assignment.courses.name})` : ""}`,
      starts_at: slot.startsAt,
      ends_at: slot.endsAt,
    });
    if (blockError) throw new Error(`failed to insert study block: ${blockError.message}`);

    const sent = await sendAlertText(admin, deps, { studentId, alertId: alert.id, body: message });
    return json(AlertResponse.parse({ alertId: alert.id, sent, calendarUrl }));
  } catch (err) {
    console.error("deadline-change alert failed:", err instanceof Error ? err.message : "unknown error");
    return json({ error: "Alert failed." }, 500);
  }
}
