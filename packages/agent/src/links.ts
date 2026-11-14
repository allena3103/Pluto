/**
 * Web chat shows sources as chips and saves notes-based replies to the Notes page,
 * so reply text carries no URLs. Links are for SMS only, where the app appends one.
 * Markdown links keep their label; bare and angle-bracket URLs are dropped.
 */
export function stripLinks(text: string): string {
  return text
    .replace(/!?\[([^\]\n]*)\]\((?:https?:\/\/|\/)[^)\s]*\)/g, "$1")
    .replace(/<https?:\/\/[^>\s]+>/g, "")
    .replace(/\(\s*https?:\/\/[^)\s]+\s*\)/g, "")
    .replace(/https?:\/\/[^\s)\]>]+/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
