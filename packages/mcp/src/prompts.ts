/**
 * MCP prompts: read-only text templates that clients show as one-click options.
 * Arguments arrive as strings and are only placed into the rendered text; they are
 * never used in a query. No server-only imports, so a web page can import this file.
 */

export type PromptArgumentDef = {
  name: string;
  description: string;
  required: boolean;
};

export type PromptDef = {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgumentDef[];
};

export const PROMPT_NAMES = ["study_guide", "cram_plan", "quiz_me"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export const PROMPTS: readonly PromptDef[] = [
  {
    name: "study_guide",
    title: "Study guide",
    description:
      "Build a study guide for one course from the student's recent notes, cite every fact with a page link, and save it to Pluto.",
    arguments: [
      { name: "course", description: "Course name or id, for example History 105.", required: true },
      { name: "days", description: "How many days of notes to use (1-120, default 14).", required: false },
    ],
  },
  {
    name: "cram_plan",
    title: "Cram plan for my busiest week",
    description:
      "Find the busiest upcoming week and write a day-by-day plan with page links to the notes each block needs.",
    arguments: [{ name: "weeks", description: "How many weeks ahead to look (1-26, default 8).", required: false }],
  },
  {
    name: "quiz_me",
    title: "Quiz me",
    description:
      "Write a practice quiz from the student's notes. Answers come last, each linking to the exact notes page.",
    arguments: [
      { name: "course", description: "Course name or id, for example History 105.", required: true },
      { name: "topic", description: "Optional topic to focus the quiz on.", required: false },
      { name: "count", description: "Number of questions (1-20, default 8).", required: false },
    ],
  },
];

/** Thrown for a bad prompt name or argument. The server maps it to MCP InvalidParams. */
export class PromptArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptArgumentError";
  }
}

export type PromptMessage = {
  role: "user";
  content: { type: "text"; text: string };
};

export type RenderedPrompt = {
  description: string;
  messages: PromptMessage[];
};

type RawArgs = Record<string, unknown> | undefined;

function readText(args: RawArgs, name: string, required: boolean): string | undefined {
  const raw = args?.[name];
  if (raw === undefined || raw === null) {
    if (required) throw new PromptArgumentError(`Argument "${name}" is required.`);
    return undefined;
  }
  if (typeof raw !== "string") throw new PromptArgumentError(`Argument "${name}" must be text.`);
  const value = raw.trim();
  if (value.length === 0) {
    if (required) throw new PromptArgumentError(`Argument "${name}" is required.`);
    return undefined;
  }
  if (value.length > 200) throw new PromptArgumentError(`Argument "${name}" must be 200 characters or fewer.`);
  return value;
}

function readInt(args: RawArgs, name: string, min: number, max: number, fallback: number): number {
  const raw = args?.[name];
  if (raw === undefined || raw === null) return fallback;
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : null;
  if (text === null) throw new PromptArgumentError(`Argument "${name}" must be a whole number.`);
  if (text === "") return fallback;
  if (!/^\d+$/.test(text)) throw new PromptArgumentError(`Argument "${name}" must be a whole number from ${min} to ${max}.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new PromptArgumentError(`Argument "${name}" must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

const CITE_RULES = [
  "Rules for everything you write:",
  "- Use only Pluto's tools for the student's notes. Never invent page text.",
  "- Cite every fact as a markdown link like [p. 3](deepLink), using the exact `deepLink` the tool returned for that page. Page numbers start at 1.",
  "- If the notes do not cover something, say so instead of guessing.",
].join("\n");

function studyGuide(args: RawArgs): string {
  const course = readText(args, "course", true) as string;
  const days = readInt(args, "days", 1, 120, 14);
  return [
    `Build a study guide for my course "${course}" from my Pluto notes of the last ${days} days.`,
    "",
    CITE_RULES,
    "",
    "Steps:",
    `1. Call get_recent_notes with course "${course}" and days ${days}.`,
    "2. If the result has `truncated: true`, call get_note_pages for each file's remaining pages (from pagesIncluded + 1) until you have everything.",
    "3. Write the guide with these sections: Key ideas, Key terms, Timeline or process (only where it fits the material), Likely exam questions.",
    `4. Save it by calling save_study_guide with a title like "${course} study guide", the full guide as the body with the page links kept, and the course "${course}".`,
    "5. Tell me the guide was saved to my Pluto notes and that Pluto texted me a link to it.",
  ].join("\n");
}

function cramPlan(args: RawArgs): string {
  const weeks = readInt(args, "weeks", 1, 26, 8);
  return [
    `Build a cram plan for my busiest upcoming week, looking ${weeks} weeks ahead, using my Pluto data.`,
    "",
    CITE_RULES,
    "",
    "Steps:",
    `1. Call get_crunch_weeks with weeksAhead ${weeks} and take the week ranked 1.`,
    "2. Use that week's own `assignments` for what is due. If you also call get_deadlines, pass a `daysAhead` that reaches the end of that week (its `weekEnd`, counted from today, at most 365), because the default is only 30 days.",
    "3. For each deliverable, call search_notes for its topic to find the notes pages it needs.",
    "4. Write a day-by-day plan from today to the last due date. Use study blocks of 60 to 90 minutes, put the heaviest-weight items first, and link every block to the notes pages it needs.",
    "5. End with a one-line summary of the week and what to do first today.",
  ].join("\n");
}

function quizMe(args: RawArgs): string {
  const course = readText(args, "course", true) as string;
  const topic = readText(args, "topic", false);
  const count = readInt(args, "count", 1, 20, 8);
  const source = topic
    ? `1. Call search_notes with query "${topic}" and course "${course}", then read the matching pages (get_note_pages if you need more context).`
    : `1. Call get_recent_notes with course "${course}". If \`truncated\` is true, call get_note_pages for the rest.`;
  return [
    `Quiz me on my course "${course}"${topic ? ` about "${topic}"` : ""} using my Pluto notes.`,
    "",
    CITE_RULES,
    "",
    "Steps:",
    source,
    `2. Write ${count} numbered questions, mixing multiple choice (with options A-D) and short answer. Base each one on something actually in the notes.`,
    "3. Put no answers next to the questions.",
    "4. After the last question, add one \"Answers\" section. For each question give the answer, a one-line explanation, and the page link it comes from, like [p. 4](deepLink).",
  ].join("\n");
}

/** Render one prompt. Throws PromptArgumentError for an unknown name or a bad argument. */
export function renderPrompt(name: string, args?: Record<string, unknown>): RenderedPrompt {
  const def = PROMPTS.find((p) => p.name === name);
  if (!def) throw new PromptArgumentError(`Unknown prompt "${name.slice(0, 80)}".`);
  let text: string;
  switch (def.name as PromptName) {
    case "study_guide":
      text = studyGuide(args);
      break;
    case "cram_plan":
      text = cramPlan(args);
      break;
    case "quiz_me":
      text = quizMe(args);
      break;
  }
  return { description: def.description, messages: [{ role: "user", content: { type: "text", text } }] };
}
