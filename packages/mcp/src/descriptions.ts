import { TOOLS, TOOL_NAMES, type ToolName } from "@pluto/core/contract";

const CITE =
  "Pages are 1-based. Cite every fact with the page's deepLink as a markdown link, for example [notes](deepLink).";

/**
 * Server instructions sent on initialize. They tell the model which tool to call
 * and how to cite pages.
 */
export const SERVER_INSTRUCTIONS = [
  "Pluto is a read-only view of the signed-in student's courses, notes, deadlines, and grades. Do not invent page text.",
  "Call list_courses first when the course is unclear.",
  "Use get_recent_notes for notes from the past N days or weeks and when building a study guide.",
  "If truncated is true, call get_note_pages({ fileId, firstPage: pagesIncluded + 1 }) for each file with pagesIncluded < pageCount.",
  "Use search_notes to find where a topic is covered.",
  CITE,
].join(" ");

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_courses: `${TOOLS.list_courses.description} Call list_courses first when the course is unclear.`,
  get_recent_notes: `${TOOLS.get_recent_notes.description} Use get_recent_notes for notes from the past N days or weeks and for study guides. If truncated is true, call get_note_pages({ fileId, firstPage: pagesIncluded + 1 }) for each file with pagesIncluded < pageCount. ${CITE}`,
  get_note_pages: `${TOOLS.get_note_pages.description} Pages are 1-based. If truncated is true, call get_note_pages again with firstPage set to the last returned page plus 1. ${CITE}`,
  search_notes: `${TOOLS.search_notes.description} Use search_notes to find where a topic is covered. ${CITE}`,
  get_deadlines: `${TOOLS.get_deadlines.description} Call list_courses first when the course is unclear.`,
  get_grades: `${TOOLS.get_grades.description} Call list_courses first when the course is unclear.`,
  get_crunch_weeks: `${TOOLS.get_crunch_weeks.description} ${CITE}`,
};

export function descriptionCorpus(): string {
  return [SERVER_INSTRUCTIONS, ...TOOL_NAMES.map((name) => TOOL_DESCRIPTIONS[name])].join("\n");
}
