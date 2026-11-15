// @pluto/core entry. Owned by the foundation orchestrator (the director after F2).
// This entry re-exports only the modules that are safe in any runtime, including the browser.
// Server-only modules are imported by subpath so they never reach a client bundle:
//   @pluto/core/tools/index   the 7 tool functions and TOOL_HANDLERS (needs a Supabase client)
//   @pluto/core/ingest        PDF ingest (service role)
//   @pluto/core/magic-links   createMagicLink / consumeMagicLink (service role, node:crypto)
//   @pluto/core/save-study-guide  saveStudyGuide, the MCP write tool (service role for the text step)
//   @pluto/core/sms           sendSms, recordInboundSms, findStudentByPhone (service role)
//   @pluto/core/ics           buildIcs, getCalendarFeed (service role for the feed lookup)
//   @pluto/core/database.types  generated Supabase types
export const PLUTO_CORE = "pluto-core";

export * from "./contract";
export * from "./deep-links";
export * from "./context";
