import type { Deadline } from "@pluto/core/contract";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatDueDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDueTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function dayGroupKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function formatDayHeading(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function groupDeadlinesByDay(deadlines: Deadline[]): { key: string; heading: string; items: Deadline[] }[] {
  const map = new Map<string, Deadline[]>();

  for (const deadline of deadlines) {
    const key = dayGroupKey(deadline.dueAt);
    const list = map.get(key) ?? [];
    list.push(deadline);
    map.set(key, list);
  }

  return [...map.entries()].map(([key, items]) => ({
    key,
    heading: formatDayHeading(items[0]!.dueAt),
    items,
  }));
}