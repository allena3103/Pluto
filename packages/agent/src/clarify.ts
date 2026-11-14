import { CLARIFY_MAX_OPTIONS, CLARIFY_MAX_QUESTIONS, ClarifyingQuestion } from "@pluto/core/contract";
import { z } from "zod";

/** What the model passes to `ask_clarifying_questions`. Defaults are filled by `parseClarifyArgs`. */
export const ClarifyArgs = z.object({
  intro: z.string().max(300).optional().describe("One short sentence shown above the questions."),
  questions: z
    .array(
      z.object({
        id: z.string().max(40).describe("Short key, for example class or weeks."),
        prompt: z.string().max(300).describe("The question, for example: Which class?"),
        options: z
          .array(z.string().max(120))
          .max(CLARIFY_MAX_OPTIONS)
          .optional()
          .describe("Choices the student can tap. Use real names from tool results, such as course names."),
        multiple: z.boolean().optional().describe("True when the student may pick more than one option."),
        allowText: z
          .boolean()
          .optional()
          .describe("True to also accept a typed answer. Questions without options always take a typed answer."),
      }),
    )
    .min(1)
    .max(CLARIFY_MAX_QUESTIONS),
});

export type Clarification = { intro: string; questions: ClarifyingQuestion[] };

export const DEFAULT_CLARIFY_INTRO = "I need a little more detail first.";

/** Validates and normalizes model arguments. Returns null when nothing usable is left. */
export function parseClarifyArgs(raw: unknown): Clarification | null {
  const parsed = ClarifyArgs.safeParse(raw);
  if (!parsed.success) return null;

  const questions: ClarifyingQuestion[] = [];
  const ids = new Set<string>();
  for (const [index, question] of parsed.data.questions.entries()) {
    const prompt = question.prompt.trim();
    if (!prompt) continue;
    let id = question.id.trim() || `q${index + 1}`;
    if (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);

    const options = [...new Set((question.options ?? []).map((option) => option.trim()).filter(Boolean))];
    const candidate = {
      id,
      prompt,
      options,
      multiple: options.length > 1 && question.multiple === true,
      allowText: options.length === 0 || question.allowText === true,
    };
    const valid = ClarifyingQuestion.safeParse(candidate);
    if (valid.success) questions.push(valid.data);
  }
  if (questions.length === 0) return null;

  const intro = parsed.data.intro?.trim() || DEFAULT_CLARIFY_INTRO;
  return { intro, questions };
}

/** Plain-text form kept in chat history, so the next turn knows what was asked. */
export function clarificationText({ intro, questions }: Clarification): string {
  const lines = questions.map((question) =>
    question.options.length > 0 ? `- ${question.prompt} (${question.options.join(", ")})` : `- ${question.prompt}`,
  );
  return [intro, ...lines].join("\n");
}
