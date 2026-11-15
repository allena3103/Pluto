// Direct Postgres access to the local stack for checks and cleanup. The stack is shared, so cleanup
// deletes only ids this run recorded, and only rows created after the run started.
import pg from "pg";

export async function connectDb(url) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function dbNow(db) {
  const { rows } = await db.query("select now() as now");
  return rows[0].now;
}

export function createTracker({ studentIds, since }) {
  return {
    studentIds,
    since,
    sessions: new Set(),
    notes: new Set(),
    smsMessages: new Set(),
    magicLinks: new Set(),
    receipts: new Set(),
  };
}

/** Sessions this run started: matched by student, title (the first message) and time window. */
export async function trackSessionsByTitle(db, tracker, { studentId, titles, since }) {
  const { rows } = await db.query(
    "select id from chat_sessions where student_id = $1 and created_at >= $2 and title = any($3::text[])",
    [studentId, since, titles.map((t) => t.slice(0, 80))],
  );
  for (const row of rows) tracker.sessions.add(row.id);
  return rows.map((row) => row.id);
}

/** Notes saved in this run's sessions (catches a note whose chip was never seen). */
export async function trackNotesOfSessions(db, tracker) {
  const { rows } = await db.query(
    "select id from saved_notes where session_id = any($1::uuid[]) and created_at >= $2",
    [[...tracker.sessions], tracker.since],
  );
  for (const row of rows) tracker.notes.add(row.id);
}

async function deleteTracked(db, sql, ids, tracker) {
  if (ids.size === 0) return 0;
  const { rowCount } = await db.query(sql, [[...ids], tracker.studentIds, tracker.since]);
  return rowCount ?? 0;
}

/** Deletes every tracked row. Returns a one-line summary. */
export async function cleanup(db, tracker) {
  await trackNotesOfSessions(db, tracker);
  const counts = {
    magic_links: await deleteTracked(
      db,
      "delete from magic_links where id = any($1::uuid[]) and student_id = any($2::uuid[]) and created_at >= $3",
      tracker.magicLinks,
      tracker,
    ),
    saved_notes: await deleteTracked(
      db,
      "delete from saved_notes where id = any($1::uuid[]) and student_id = any($2::uuid[]) and created_at >= $3",
      tracker.notes,
      tracker,
    ),
    // chat_messages go with their session (on delete cascade).
    chat_sessions: await deleteTracked(
      db,
      "delete from chat_sessions where id = any($1::uuid[]) and student_id = any($2::uuid[]) and created_at >= $3",
      tracker.sessions,
      tracker,
    ),
    sms_messages: await deleteTracked(
      db,
      "delete from sms_messages where id = any($1::uuid[]) and student_id = any($2::uuid[]) and created_at >= $3",
      tracker.smsMessages,
      tracker,
    ),
    sms_inbound_receipts:
      tracker.receipts.size === 0
        ? 0
        : ((
            await db.query(
              "delete from sms_inbound_receipts where dedupe_key = any($1::text[]) and created_at >= $2",
              [[...tracker.receipts], tracker.since],
            )
          ).rowCount ?? 0),
  };
  const tracked =
    tracker.magicLinks.size + tracker.notes.size + tracker.sessions.size + tracker.smsMessages.size + tracker.receipts.size;
  const deleted = Object.values(counts).reduce((a, b) => a + b, 0);
  const parts = Object.entries(counts).map(([table, n]) => `${table}=${n}`);
  return { deleted, tracked, line: `deleted ${parts.join(" ")} (tracked ${tracked})` };
}

/** Rows that still exist for the tracked ids. Should be zero after cleanup. */
export async function leftovers(db, tracker) {
  const q = async (table, ids, column = "id", type = "uuid") =>
    ids.size === 0
      ? 0
      : Number((await db.query(`select count(*) as n from ${table} where ${column} = any($1::${type}[])`, [[...ids]])).rows[0].n);
  return (
    (await q("saved_notes", tracker.notes)) +
    (await q("chat_sessions", tracker.sessions)) +
    (await q("magic_links", tracker.magicLinks)) +
    (await q("sms_messages", tracker.smsMessages)) +
    (await q("sms_inbound_receipts", tracker.receipts, "dedupe_key", "text"))
  );
}
