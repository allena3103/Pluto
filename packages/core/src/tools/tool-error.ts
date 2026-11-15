/** Codes the 7 read tools (and `save_study_guide`) throw as `ToolError`. */
export type ToolErrorCode =
  | "invalid_input"
  | "course_not_found"
  | "course_ambiguous"
  | "file_not_found"
  | "db_error";

/** Codes only the write tool throws, as `WriteToolError`. */
export type WriteToolErrorCode = "rate_limited";

/** Tool failure whose message is safe to show the caller as `code: message`. */
export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

/**
 * Write-tool failure, shown to the caller the same way (`code: message`). A separate
 * class, not a new `ToolErrorCode`, so the web's exhaustive `Record<ToolError["code"], ...>`
 * maps for the read tools stay exact; only the MCP server handles it.
 */
export class WriteToolError extends Error {
  readonly code: WriteToolErrorCode;

  constructor(code: WriteToolErrorCode, message: string) {
    super(message);
    this.name = "WriteToolError";
    this.code = code;
  }
}
