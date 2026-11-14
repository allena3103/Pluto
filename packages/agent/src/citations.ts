import type { AgentCitation } from "./types";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Citations come from tool JSON, not model prose. A hit is an object with a uuid
 * `fileId` (its own, or a parent file's), an integer `page` >= 1, and a `deepLink`
 * string. That matches search hits, note pages, and a top-level result.
 */
export function collectCitations(value: unknown): AgentCitation[] {
  const citations: AgentCitation[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();

  const add = (fileId: string, page: number, deepLink: string) => {
    const key = `${fileId}\0${page}`;
    if (seen.has(key)) return;
    seen.add(key);
    citations.push({ fileId, page, deepLink });
  };

  const walk = (node: unknown, inheritedFileId: string | undefined) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, inheritedFileId);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (visited.has(node)) return;
    visited.add(node);

    const record = node as Record<string, unknown>;
    const ownFileId = typeof record.fileId === "string" && UUID.test(record.fileId) ? record.fileId : undefined;
    const fileId = ownFileId ?? inheritedFileId;
    const page = record.page;
    const deepLink = record.deepLink;
    if (
      fileId &&
      typeof page === "number" &&
      Number.isInteger(page) &&
      page >= 1 &&
      typeof deepLink === "string" &&
      deepLink.length > 0
    ) {
      add(fileId, page, deepLink);
    }

    const nextFileId = ownFileId ?? inheritedFileId;
    for (const child of Object.values(record)) {
      if (child && typeof child === "object") walk(child, nextFileId);
    }
  };

  walk(value, undefined);
  return citations;
}

export function mergeCitations(into: AgentCitation[], more: AgentCitation[]): void {
  const seen = new Set(into.map((citation) => `${citation.fileId}\0${citation.page}`));
  for (const citation of more) {
    const key = `${citation.fileId}\0${citation.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(citation);
  }
}
