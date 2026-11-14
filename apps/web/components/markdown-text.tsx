import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small Markdown subset for agent replies and saved notes: headings, bullet and
 * numbered lists, bold, italic, inline code, paragraphs. Builds React elements only
 * (no HTML injection). Links are not rendered as links.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: "paragraph"; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2]!.trim() });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      flush();
      const ordered = Boolean(numbered);
      const depth = Math.min(Math.floor(item[1]!.replace(/\t/g, "  ").length / 2), 3);
      const last = blocks.at(-1);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push({ text: item[2]!, depth });
      else blocks.push({ kind: "list", ordered, items: [{ text: item[2]!, depth }] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

// Underscore emphasis is left out on purpose: it would mangle snake_case terms.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-extrabold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-lg font-black",
  2: "text-base font-extrabold",
  3: "text-[0.97rem] font-extrabold",
};

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cn("space-y-3 break-words", className)}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = (`h${block.level + 1}` as "h2" | "h3" | "h4");
          return (
            <Tag key={index} className={cn("leading-snug text-foreground", HEADING_CLASS[block.level])}>
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index} className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} style={item.depth ? { marginLeft: `${item.depth * 1.25}rem` } : undefined}>
                  {renderInline(item.text)}
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
