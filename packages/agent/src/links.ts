/**
 * Web chat shows sources as chips and saves notes-based replies to the Notes page,
 * so reply text carries no URLs. Links are for SMS only, where the app appends one.
 * Markdown links keep their label; bare and angle-bracket URLs are dropped.
 */

// A URL may contain balanced parentheses (`.../Printing_(press)`) and never ends on sentence punctuation.
const URL_BODY = String.raw`(?:[^\s()<>\[\]]|\([^\s()]*\))*(?:[^\s()<>\[\].,;:!?'"]|\([^\s()]*\))`;
const MARKDOWN_LINK = new RegExp(String.raw`!?\[([^\]\n]*)\]\((?:https?:\/\/|\/)${URL_BODY}\)`, "g");
const BARE_URL = new RegExp(String.raw`https?:\/\/${URL_BODY}`, "g");

export function stripLinks(text: string): string {
  return text
    .replace(MARKDOWN_LINK, "$1")
    .replace(/<https?:\/\/[^>\s]+>/g, "")
    .replace(BARE_URL, "")
    // What a removed URL leaves inside parentheses: "( )", "(p. 2, )", "(see )".
    .replace(/(^|[ \t]+)\([\s,;:]*\)/gm, "")
    .replace(/[ \t]*[,;:]?[ \t]+\)/g, ")")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
