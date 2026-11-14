import { randomBytes } from "node:crypto";
import type { PlutoDb } from "./context";

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  url?: string;
}

export interface BuildIcsInput {
  calendarName: string;
  events: IcsEvent[];
  now?: Date;
}

export interface CalendarFeedEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
}

export interface CalendarFeedResult {
  studentId: string;
  alertId: string;
  events: CalendarFeedEvent[];
}

function formatUtcTimestamp(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const chunks: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > 75) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) chunks.push(current);
  return chunks.join("\r\n ");
}

export function buildIcs(input: BuildIcsInput): string {
  const now = input.now ?? new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pluto//Study Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(input.calendarName)}`,
  ];

  for (const event of input.events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeText(event.uid)}`);
    lines.push(`DTSTAMP:${formatUtcTimestamp(now)}`);
    lines.push(`DTSTART:${formatUtcTimestamp(event.start)}`);
    lines.push(`DTEND:${formatUtcTimestamp(event.end)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${escapeText(event.url)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map((line) => foldLine(line)).join("\r\n")}\r\n`;
}

export function newFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

export function calendarFeedUrl(appUrl: string, token: string): string {
  if (!appUrl) throw new TypeError("appUrl is required");
  if (!token) throw new TypeError("token is required");
  return `${appUrl.replace(/\/+$/, "")}/cal/${token}.ics`;
}

export async function getCalendarFeed(admin: PlutoDb, feedToken: string): Promise<CalendarFeedResult | null> {
  if (!feedToken) return null;

  const { data: alert, error: alertError } = await admin
    .from("alerts")
    .select("id,student_id")
    .eq("calendar_feed_token", feedToken)
    .maybeSingle();
  if (alertError) throw new Error(`failed to load alert for feed token: ${alertError.message}`);
  if (!alert) return null;

  const { data: blocks, error: blocksError } = await admin
    .from("study_blocks")
    .select("id,title,starts_at,ends_at")
    .eq("student_id", alert.student_id)
    .eq("alert_id", alert.id)
    .order("starts_at", { ascending: true });
  if (blocksError) throw new Error(`failed to load study blocks for feed token: ${blocksError.message}`);

  return {
    studentId: alert.student_id,
    alertId: alert.id,
    events: (blocks ?? []).map((block) => ({
      id: block.id,
      title: block.title,
      start: new Date(block.starts_at),
      end: new Date(block.ends_at),
    })),
  };
}
