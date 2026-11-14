import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlutoDb } from "../../src/context";
import { buildIcs, calendarFeedUrl, getCalendarFeed, newFeedToken } from "../../src/ics";
import { SKIP_DB_TESTS } from "../db-env";
import { createThrowawayUser, deleteUsers, serviceClient, type TestUser } from "../db/helpers";

describe("buildIcs", () => {
  it("writes RFC5545-like ICS output with escaped text, UTC time and folded lines", () => {
    const ics = buildIcs({
      calendarName: "History 105, Week Plan",
      now: new Date("2026-11-14T00:00:00.000Z"),
      events: [
        {
          uid: "event-1",
          title: "Read chapter 3, section A",
          start: new Date("2026-11-14T14:00:00.000Z"),
          end: new Date("2026-11-14T15:00:00.000Z"),
          description:
            "Bring notes,\nfocus on causes; compare\\contrast and summarize the key themes in one paragraph for review.",
          url: "https://pluto.test/notes/abc?page=2",
        },
        {
          uid: "event-2",
          title: "Review quiz",
          start: new Date("2026-11-15T14:00:00.000Z"),
          end: new Date("2026-11-15T14:30:00.000Z"),
        },
      ],
    });

    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//Pluto//Study Calendar//EN\r\n");
    expect(ics).toContain("DTSTAMP:20261114T000000Z");
    expect(ics).toContain("DTSTART:20261114T140000Z");
    expect(ics).toContain("DTEND:20261114T150000Z");
    expect(ics).toContain("SUMMARY:Read chapter 3\\, section A");
    expect(ics).toContain("DESCRIPTION:Bring notes\\,\\nfocus on causes\\; compare\\\\contrast");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);

    const lines = ics.split("\r\n").filter(Boolean);
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
    for (const line of lines) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });

  it("builds a feed url and token", () => {
    const token = newFeedToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(calendarFeedUrl("https://pluto.test/", token)).toBe(`https://pluto.test/cal/${token}.ics`);
  });
});

describe.skipIf(SKIP_DB_TESTS)("getCalendarFeed", () => {
  let admin: PlutoDb;
  const users: Array<TestUser | undefined> = [];

  beforeAll(() => {
    admin = serviceClient() as unknown as PlutoDb;
  });

  afterAll(async () => {
    await deleteUsers(admin, users);
  });

  it("returns null for unknown token", async () => {
    const result = await getCalendarFeed(admin, "does-not-exist");
    expect(result).toBeNull();
  });

  it("returns only blocks for the alert owner", async () => {
    const owner = await createThrowawayUser(admin, "Feed Owner");
    users.push(owner);
    const other = await createThrowawayUser(admin, "Feed Other");
    users.push(other);

    const ownerToken = newFeedToken();
    const { data: ownerAlert, error: ownerAlertError } = await admin
      .from("alerts")
      .insert({ student_id: owner.id, kind: "crunch_week", calendar_feed_token: ownerToken, message: "owner feed" })
      .select("id")
      .single();
    if (ownerAlertError || !ownerAlert) throw new Error(`failed to insert owner alert: ${ownerAlertError?.message ?? "no data"}`);

    const { error: ownerBlockError } = await admin.from("study_blocks").insert({
      student_id: owner.id,
      alert_id: ownerAlert.id,
      title: "Owner Block",
      starts_at: "2026-11-14T14:00:00.000Z",
      ends_at: "2026-11-14T15:00:00.000Z",
    });
    if (ownerBlockError) throw new Error(`failed to insert owner block: ${ownerBlockError.message}`);

    const { data: otherAlert, error: otherAlertError } = await admin
      .from("alerts")
      .insert({ student_id: other.id, kind: "crunch_week", calendar_feed_token: newFeedToken(), message: "other feed" })
      .select("id")
      .single();
    if (otherAlertError || !otherAlert) throw new Error(`failed to insert other alert: ${otherAlertError?.message ?? "no data"}`);

    const { error: otherBlockError } = await admin.from("study_blocks").insert({
      student_id: other.id,
      alert_id: otherAlert.id,
      title: "Other Block",
      starts_at: "2026-11-14T16:00:00.000Z",
      ends_at: "2026-11-14T17:00:00.000Z",
    });
    if (otherBlockError) throw new Error(`failed to insert other block: ${otherBlockError.message}`);

    const feed = await getCalendarFeed(admin, ownerToken);
    expect(feed).not.toBeNull();
    expect(feed?.studentId).toBe(owner.id);
    expect(feed?.alertId).toBe(ownerAlert.id);
    expect(feed?.events.map((event) => event.title)).toEqual(["Owner Block"]);
  });
});
