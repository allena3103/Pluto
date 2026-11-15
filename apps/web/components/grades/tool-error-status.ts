import { ToolError } from "@pluto/core/tools/tool-error";

const STATUS_BY_CODE: Record<ToolError["code"], number> = {
  invalid_input: 400,
  course_not_found: 404,
  course_ambiguous: 409,
  file_not_found: 404,
  assignment_not_found: 404,
  db_error: 500,
};

export function httpStatusForToolError(error: ToolError): number {
  return STATUS_BY_CODE[error.code] ?? 500;
}