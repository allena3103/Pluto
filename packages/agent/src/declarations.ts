import { TOOLS, TOOL_NAMES } from "@pluto/core/contract";
import { z } from "zod";
import type { AgentToolDeclaration } from "./types";

const CreateMagicLinkArgs = z.object({
  fileId: z.guid(),
  page: z.number().int().min(1),
});

function parametersFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** The seven contract tools, plus `create_magic_link` only when the host can mint one. */
export function buildToolDeclarations(includeMagicLink: boolean): AgentToolDeclaration[] {
  const declarations: AgentToolDeclaration[] = TOOL_NAMES.map((name) => {
    const tool = TOOLS[name];
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: parametersFor(tool.input),
    };
  });

  if (includeMagicLink) {
    declarations.push({
      type: "function",
      name: "create_magic_link",
      description: "Opens a one-time link to one notes page. Pass fileId and a 1-based page.",
      parameters: parametersFor(CreateMagicLinkArgs),
    });
  }

  return declarations;
}
