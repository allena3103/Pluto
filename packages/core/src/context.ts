/**
 * The context every core tool function receives. One per request, built by the
 * surface (MCP route, web chat, SMS agent) after it has authenticated the student.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/** Supabase client typed with the Pluto schema. */
export type PlutoDb = SupabaseClient<Database>;

export type ToolContext = {
  /** Supabase client. Prefer one bound to the student's session so row-level security applies. */
  db: PlutoDb;
  /** The signed-in student. Every query also filters by this id explicitly. */
  studentId: string;
  /** Web app origin without a trailing slash, e.g. `https://pluto.example.com`. Used for deep links. */
  appUrl: string;
};

/** Builds a `ToolContext`, trimming any trailing slash from `appUrl`. */
export function makeToolContext(input: { db: PlutoDb; studentId: string; appUrl: string }): ToolContext {
  if (!input.studentId) throw new TypeError("studentId is required");
  if (!input.appUrl) throw new TypeError("appUrl is required");
  return {
    db: input.db,
    studentId: input.studentId,
    appUrl: input.appUrl.replace(/\/+$/, ""),
  };
}
