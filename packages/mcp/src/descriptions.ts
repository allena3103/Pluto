import { TOOLS, TOOL_NAMES, WRITE_TOOLS, WRITE_TOOL_NAMES, type ToolName, type WriteToolName } from "@pluto/core/contract";

const CITE =
  "Pages are 1-based. Cite every fact with the page's deepLink as a markdown link, for example [notes](deepLink).";

/**
 * Server instructions sent on initialize. They tell the model which tool to call,
 * how to cite pages, and when to use the one write tool.
 */
export const SERVER_INSTRUCTIONS = [
  "Pluto's tools read the signed-in student's courses, notes, deadlines, assignments, and grades. Do not invent page text.",
  "Call list_courses first when the course is unclear.",
  "Use get_recent_notes for notes from the past N days or weeks and when building a study guide.",
  "If truncated is true, call get_note_pages({ fileId, firstPage: pagesIncluded + 1 }) for each file with pagesIncluded < pageCount.",
  "Use search_notes to find where a topic is covered.",
  "For what an assignment requires or to show its handout or attachment, call get_deadlines, then get_assignment with its assignmentId.",
  CITE,
  "One tool writes: save_study_guide saves a finished study guide to the student's Pluto Notes and texts the student a link to it. Use it only when the student asks to save the guide (or a prompt says to), once per finished guide.",
].join(" ");

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_courses: `${TOOLS.list_courses.description} Call list_courses first when the course is unclear.`,
  get_recent_notes: `${TOOLS.get_recent_notes.description} Use get_recent_notes for notes from the past N days or weeks and for study guides. If truncated is true, call get_note_pages({ fileId, firstPage: pagesIncluded + 1 }) for each file with pagesIncluded < pageCount. ${CITE}`,
  get_note_pages: `${TOOLS.get_note_pages.description} Pages are 1-based. If truncated is true, call get_note_pages again with firstPage set to the last returned page plus 1. ${CITE}`,
  search_notes: `${TOOLS.search_notes.description} Use search_notes to find where a topic is covered. ${CITE}`,
  get_deadlines: `${TOOLS.get_deadlines.description} Call list_courses first when the course is unclear.`,
  get_assignment: `${TOOLS.get_assignment.description} Call get_deadlines first to find the assignmentId (pass a larger daysAhead for later work). Quote the instructions and attachment text the student needs, and give the attachment's url so they can open the file in Pluto. Attachments with status other than ready have no text; list them by title. If truncated is true, some attachment pages were left out; point the student to the url.`,
  get_grades: `${TOOLS.get_grades.description} Call list_courses first when the course is unclear.`,
  get_crunch_weeks: `${TOOLS.get_crunch_weeks.description} ${CITE}`,
};

export const WRITE_TOOL_DESCRIPTIONS: Record<WriteToolName, string> = {
  save_study_guide: `${WRITE_TOOLS.save_study_guide.description} Call it once per finished guide, only when the student asks to save it (or a prompt says to). Pass the full markdown with every page deepLink kept (they become the guide's cited pages), a short title such as "History 105 study guide", and the course when known. Then tell the student the returned url and whether the text was sent (textStatus).`,
};

export function descriptionCorpus(): string {
  return [
    SERVER_INSTRUCTIONS,
    ...TOOL_NAMES.map((name) => TOOL_DESCRIPTIONS[name]),
    ...WRITE_TOOL_NAMES.map((name) => WRITE_TOOL_DESCRIPTIONS[name]),
  ].join("\n");
}
