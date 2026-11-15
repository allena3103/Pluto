/**
 * Deep links to an exact notes page in the web app: `/notes/<fileId>?page=<n>`.
 * Page numbers are 1-based.
 */

function assertPage(page: number): void {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`page must be an integer >= 1, got ${String(page)}`);
  }
}

/** `/notes/<fileId>?page=<n>`. Throws when `page` is not an integer >= 1. */
export function notePath(fileId: string, page: number): string {
  assertPage(page);
  if (!fileId) throw new TypeError("fileId is required");
  return `/notes/${encodeURIComponent(fileId)}?page=${page}`;
}

/** Absolute URL to the notes page. A trailing slash on `appUrl` is fine. */
export function noteUrl(appUrl: string, fileId: string, page: number): string {
  return `${appUrl.replace(/\/+$/, "")}${notePath(fileId, page)}`;
}

/**
 * Reads a path (`/notes/<fileId>?page=3`) or absolute URL back into its parts.
 * `page` defaults to 1 when missing. Returns null for anything that is not a notes
 * link or whose page is not an integer >= 1.
 */
export function parseNotePath(pathOrUrl: string): { fileId: string; page: number } | null {
  let url: URL;
  try {
    url = new URL(pathOrUrl, "http://pluto.invalid");
  } catch {
    return null;
  }
  const match = /^\/notes\/([^/]+)\/?$/.exec(url.pathname);
  if (!match?.[1]) return null;

  let fileId: string;
  try {
    fileId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const rawPage = url.searchParams.get("page");
  if (rawPage === null) return { fileId, page: 1 };
  if (!/^[1-9]\d*$/.test(rawPage)) return null;
  const page = Number(rawPage);
  if (!Number.isSafeInteger(page)) return null;
  return { fileId, page };
}

/** `/assignments/<assignmentId>`: an assignment's instructions and attachments. */
export function assignmentPath(assignmentId: string): string {
  if (!assignmentId) throw new TypeError("assignmentId is required");
  return `/assignments/${encodeURIComponent(assignmentId)}`;
}

/** `/assignments/<assignmentId>/files/<attachmentId>[?page=<n>]`. */
export function assignmentFilePath(assignmentId: string, attachmentId: string, page?: number): string {
  if (!attachmentId) throw new TypeError("attachmentId is required");
  if (page !== undefined) assertPage(page);
  const base = `${assignmentPath(assignmentId)}/files/${encodeURIComponent(attachmentId)}`;
  return page === undefined ? base : `${base}?page=${page}`;
}
