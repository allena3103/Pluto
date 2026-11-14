export type ToolErrorCode =
  | "invalid_input"
  | "course_not_found"
  | "course_ambiguous"
  | "file_not_found"
  | "db_error";

export class ToolError extends Error {
  readonly code: ToolErrorCode;

  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}
