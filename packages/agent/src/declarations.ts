import { TOOLS, TOOL_NAMES } from "@pluto/core/contract";
import { z } from "zod";
import { ClarifyArgs } from "./clarify";
import { ASK_TOOL_NAME, type AgentToolDeclaration } from "./types";

const CreateMagicLinkArgs = z.object({
  fileId: z.guid(),
  page: z.number().int().min(1),
});

function parametersFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * The eight contract tools, plus `create_magic_link` only when the host can mint one (SMS)
 * and `ask_clarifying_questions` only where the host can show questions (web).
 */
export function buildToolDeclarations(options: { magicLink: boolean; clarify: boolean }): AgentToolDeclaration[] {
  const declarations: AgentToolDeclaration[] = TOOL_NAMES.map((name) => {
    const tool = TOOLS[name];
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: parametersFor(tool.input),
    };
  });

  if (options.magicLink) {
    declarations.push({
      type: "function",
      name: "create_magic_link",
      description: "Opens a one-time link to one notes page. Pass fileId and a 1-based page.",
      parameters: parametersFor(CreateMagicLinkArgs),
    });
  }

  if (options.clarify) {
    declarations.push({
      type: "function",
      name: ASK_TOOL_NAME,
      description:
        "Ask the student for missing details before answering, for example which class or which weeks of notes. Ends your turn; the student's answer arrives as the next message. Call list_courses first so class options are real course names.",
      parameters: parametersFor(ClarifyArgs),
    });
  }

  return declarations;
}
