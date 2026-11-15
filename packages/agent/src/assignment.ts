import { GetAssignmentOutput, GetDeadlinesOutput, ListCoursesOutput, type ToolOutput } from "@pluto/core/contract";
import { withDeadline } from "./timeout";
import { TOOL_FAILURE_TEXT, TOOL_TIMEOUT_MS, type AgentResult, type AgentToolRunner, type RunAgentInput } from "./types";

/** "show me the handout", "what are the instructions for ...", "what does Lab Report 3 require". */
const ASSIGNMENT_WORDS = /\b(attach(?:ment|ments|ed)|handouts?|instructions?|requirements?|requires?)\b/i;

const ZONE = "America/New_York";
const SMS_MAX_CHARS = 299;

export function isAssignmentRequest(message: string): boolean {
  return ASSIGNMENT_WORDS.test(message);
}

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "has no due date";
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dueAt));
  return `is due ${when}`;
}

function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Assignment-requirement requests: `get_deadlines` (for the named class, if any), then
 * `get_assignment` on the soonest deadline whose title the message names (or the soonest
 * one). The reply has the title, due date, an instructions excerpt and attachment names;
 * attachments are never note citations and the reply carries no URLs.
 */
export async function runMockAssignment(input: RunAgentInput, runTool: AgentToolRunner): Promise<AgentResult> {
  const call = async (name: string, args: Record<string, unknown>) =>
    withDeadline(runTool(name, args), TOOL_TIMEOUT_MS, input.signal);
  const text = input.message.toLowerCase();

  let assignment: ToolOutput<"get_assignment">;
  try {
    const { courses } = ListCoursesOutput.parse(await call("list_courses", {}));
    const course = courses.find((candidate) => text.includes(candidate.name.toLowerCase()))?.name;
    const { deadlines } = GetDeadlinesOutput.parse(await call("get_deadlines", course ? { course } : {}));
    const named = deadlines.find((deadline) => {
      const title = deadline.title.toLowerCase();
      const head = title.split(":", 1)[0]!.trim();
      return text.includes(title) || (head.length >= 4 && text.includes(head));
    });
    const target = named ?? deadlines[0];
    if (!target) {
      return { text: `I couldn't find an upcoming assignment${course ? ` for ${course}` : ""}.`, citations: [] };
    }
    assignment = GetAssignmentOutput.parse(await call("get_assignment", { assignmentId: target.assignmentId }));
  } catch {
    return { text: TOOL_FAILURE_TEXT, citations: [] };
  }

  const sms = input.channel === "sms";
  const due = `(${assignment.courseName}) ${dueLabel(assignment.dueAt)}.`;
  const instructions = assignment.instructions
    ? `Instructions: ${excerpt(assignment.instructions, sms ? 100 : 280)}`
    : "Canvas has no instructions for it.";
  const files = assignment.attachments.map((attachment) => attachment.title);
  const attachments = files.length > 0 ? `Attachments: ${files.join(", ")}.` : "It has no attachments.";

  if (sms) {
    return { text: excerpt(`${assignment.title} ${due} ${instructions} ${attachments}`, SMS_MAX_CHARS), citations: [] };
  }
  return { text: [`**${assignment.title}** ${due}`, instructions, attachments].join("\n\n"), citations: [] };
}
