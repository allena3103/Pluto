import { ZodError } from "zod";
import { TOOLS, type ToolName, type ToolOutput } from "../contract";
import type { ToolContext } from "../context";
import { getCrunchWeeks } from "./get-crunch-weeks";
import { getDeadlines } from "./get-deadlines";
import { getGrades } from "./get-grades";
import { getNotePages } from "./get-note-pages";
import { getRecentNotes } from "./get-recent-notes";
import { listCourses } from "./list-courses";
import { searchNotes } from "./search-notes";
import { ToolError } from "./tool-error";

function zodMessage(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ") || "Invalid input.";
}

function toInvalidInput(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof ZodError) return new ToolError("invalid_input", zodMessage(error));
  return new ToolError("invalid_input", "Invalid input.");
}

async function runHandler<K extends ToolName>(
  name: K,
  ctx: ToolContext,
  rawInput: unknown,
  fn: (ctx: ToolContext, input: unknown) => Promise<unknown>,
): Promise<ToolOutput<K>> {
  let parsedInput: unknown;
  try {
    parsedInput = TOOLS[name].input.parse(rawInput);
  } catch (error) {
    throw toInvalidInput(error);
  }
  const result = await fn(ctx, parsedInput);
  try {
    return TOOLS[name].output.parse(result) as ToolOutput<K>;
  } catch (error) {
    throw toInvalidInput(error);
  }
}

export { ToolError } from "./tool-error";
export { resolveCourse, matchCourse } from "./resolve-course";
export { listCourses } from "./list-courses";
export { getRecentNotes } from "./get-recent-notes";
export { getNotePages } from "./get-note-pages";
export { searchNotes } from "./search-notes";
export { getDeadlines } from "./get-deadlines";
export { getGrades, computeGroupGrades, round2 } from "./get-grades";
export { getCrunchWeeks, buildCrunchWeeks, utcMondayStart } from "./get-crunch-weeks";

export const TOOL_HANDLERS: {
  [K in ToolName]: (ctx: ToolContext, input: unknown) => Promise<ToolOutput<K>>;
} = {
  list_courses: async (ctx, input) => runHandler("list_courses", ctx, input, async () => listCourses(ctx)),
  get_recent_notes: async (ctx, input) =>
    runHandler("get_recent_notes", ctx, input, async (innerCtx, parsed) =>
      getRecentNotes(innerCtx, parsed as Parameters<typeof getRecentNotes>[1]),
    ),
  get_note_pages: async (ctx, input) =>
    runHandler("get_note_pages", ctx, input, async (innerCtx, parsed) =>
      getNotePages(innerCtx, parsed as Parameters<typeof getNotePages>[1]),
    ),
  search_notes: async (ctx, input) =>
    runHandler("search_notes", ctx, input, async (innerCtx, parsed) =>
      searchNotes(innerCtx, parsed as Parameters<typeof searchNotes>[1]),
    ),
  get_deadlines: async (ctx, input) =>
    runHandler("get_deadlines", ctx, input, async (innerCtx, parsed) =>
      getDeadlines(innerCtx, parsed as Parameters<typeof getDeadlines>[1]),
    ),
  get_grades: async (ctx, input) =>
    runHandler("get_grades", ctx, input, async (innerCtx, parsed) =>
      getGrades(innerCtx, parsed as Parameters<typeof getGrades>[1]),
    ),
  get_crunch_weeks: async (ctx, input) =>
    runHandler("get_crunch_weeks", ctx, input, async (innerCtx, parsed) =>
      getCrunchWeeks(innerCtx, parsed as Parameters<typeof getCrunchWeeks>[1]),
    ),
};
