// Proves one student cannot read or write another student's rows, in every public table.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  COURSE_IDS,
  DEMO_STUDENT_EMAIL,
  DEMO_STUDENT_ID,
  OTHER_COURSE_ID,
  OTHER_STUDENT_EMAIL,
  OTHER_STUDENT_ID,
  SEED_COUNTS,
} from "../../../../scripts/lib/seed-ids";
import { SKIP_DB_TESTS } from "../db-env";
import {
  OWNER_COLUMN,
  STUDENT_READABLE,
  anonClient,
  createRowInEveryTable,
  createThrowawayUser,
  deleteUsers,
  insertPayloads,
  must,
  pgQuery,
  requireTestEnv,
  rowsOrDenied,
  serviceClient,
  signIn,
  type OwnedRows,
  type TestUser,
} from "./helpers";

const TABLES = Object.keys(OWNER_COLUMN);
const EPOCH = "1970-01-01T00:00:00+00:00";

describe.skipIf(SKIP_DB_TESTS)("row-level security", () => {
  let service: SupabaseClient;
  let demo: SupabaseClient;
  let other: SupabaseClient;
  let victim: TestUser | undefined; // throwaway student who owns one row in every table
  let fresh: TestUser | undefined; // throwaway student who owns nothing
  let victimRows: OwnedRows;
  let attackers: Array<{ label: string; id: string; client: SupabaseClient }>;

  beforeAll(async () => {
    service = serviceClient();
    demo = await signIn(DEMO_STUDENT_EMAIL, requireTestEnv("DEMO_STUDENT_PASSWORD"));
    other = await signIn(OTHER_STUDENT_EMAIL, requireTestEnv("OTHER_STUDENT_PASSWORD"));
    victim = await createThrowawayUser(service, "RLS Victim");
    fresh = await createThrowawayUser(service, "RLS Fresh");
    victimRows = await createRowInEveryTable(service, victim.id);
    attackers = [
      { label: "other@pluto.test", id: OTHER_STUDENT_ID, client: other },
      { label: "fresh throwaway user", id: fresh.id, client: fresh.client },
    ];
  });

  afterAll(async () => {
    if (service) await deleteUsers(service, [victim, fresh]);
  });

  it("covers every public table and every table has RLS on", async () => {
    const tables = await pgQuery<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    expect(tables.map((t) => t.table_name).sort()).toEqual([...TABLES].sort());

    const noRls = await pgQuery<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`,
    );
    expect(noRls.map((r) => r.relname)).toEqual([]);

    const anonGrants = await pgQuery<{ table_name: string }>(
      "select distinct table_name from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'PUBLIC')",
    );
    expect(anonGrants.map((r) => r.table_name)).toEqual([]);

    const badPolicies = await pgQuery<{ policyname: string }>(
      "select policyname from pg_policies where schemaname = 'public' and (roles <> '{authenticated}' or coalesce(qual, with_check) not like '%auth.uid()%')",
    );
    expect(badPolicies.map((r) => r.policyname)).toEqual([]);
  });

  it("control: the rows to hide exist (service role sees them)", async () => {
    for (const table of TABLES) {
      const rows = must(await service.from(table).select("*").eq(OWNER_COLUMN[table]!, victim!.id), table);
      expect(rows.length, `victim rows in ${table}`).toBeGreaterThanOrEqual(1);
    }
    for (const table of ["profiles", "courses", "grade_groups", "assignments"]) {
      const rows = must(await service.from(table).select("*").eq(OWNER_COLUMN[table]!, DEMO_STUDENT_ID), table);
      expect(rows.length, `demo rows in ${table}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("other students read zero rows of the demo student or the victim, in every table", async () => {
    for (const attacker of attackers) {
      for (const table of TABLES) {
        const owner = OWNER_COLUMN[table]!;
        const label = `${attacker.label} -> ${table}`;

        const all = rowsOrDenied(await attacker.client.from(table).select("*").limit(1000), label);
        for (const row of all) expect(row[owner], `${label}: leaked a row`).toBe(attacker.id);

        for (const targetId of [DEMO_STUDENT_ID, victim!.id]) {
          const filtered = rowsOrDenied(await attacker.client.from(table).select("*").eq(owner, targetId), label);
          expect(filtered, `${label}: rows for ${targetId}`).toEqual([]);
        }
      }
      // Direct lookups by primary key leak nothing either.
      const byId = rowsOrDenied(
        await attacker.client.from("courses").select("*").in("id", [COURSE_IDS.history105, victimRows.courseId]),
        `${attacker.label} -> courses by id`,
      );
      expect(byId).toEqual([]);
    }
  });

  it("anonymous (no session) reads return zero rows from every table", async () => {
    const anon = anonClient();
    for (const table of TABLES) {
      const rows = rowsOrDenied(await anon.from(table).select("*").limit(10), `anon -> ${table}`);
      expect(rows, `anon -> ${table}`).toEqual([]);
    }
  });

  it("positive control: students read their own rows", async () => {
    const demoCourses = must(await demo.from("courses").select("id, student_id, name"), "demo courses");
    expect(demoCourses.map((c) => c.id)).toEqual(expect.arrayContaining(Object.values(COURSE_IDS)));
    expect(demoCourses.map((c) => c.id)).not.toContain(OTHER_COURSE_ID);
    expect(demoCourses.every((c) => c.student_id === DEMO_STUDENT_ID)).toBe(true);
    expect(demoCourses.map((c) => c.name)).toContain("History 105");

    const demoAssignments = must(await demo.from("assignments").select("id, student_id"), "demo assignments");
    expect(demoAssignments.length).toBeGreaterThanOrEqual(SEED_COUNTS.demo.assignments);
    expect(demoAssignments.every((a) => a.student_id === DEMO_STUDENT_ID)).toBe(true);

    const otherCourses = must(await other.from("courses").select("id"), "other courses");
    expect(otherCourses.map((c) => c.id)).toContain(OTHER_COURSE_ID);

    // The victim sees exactly their own row in every table students may read.
    for (const table of STUDENT_READABLE) {
      const rows = must(await victim!.client.from(table).select("*"), `victim -> ${table}`);
      expect(rows.length, `victim own rows in ${table}`).toBe(1);
    }
    const links = rowsOrDenied(await victim!.client.from("magic_links").select("*"), "victim -> magic_links");
    expect(links).toEqual([]);
  });

  it("other students cannot insert rows owned by the demo student or the victim", async () => {
    const targets = [
      { studentId: DEMO_STUDENT_ID, courseId: COURSE_IDS.history105 },
      {
        studentId: victim!.id,
        courseId: victimRows.courseId,
        fileId: victimRows.fileId,
        chatSessionId: victimRows.chatSessionId,
        alertId: victimRows.alertId,
      },
    ];
    for (const attacker of attackers) {
      for (const target of targets) {
        const payloads = insertPayloads(target);
        for (const table of TABLES) {
          const res = await attacker.client.from(table).insert(payloads[table]!).select();
          expect(res.error, `${attacker.label} insert into ${table} for ${target.studentId}`).not.toBeNull();
        }
      }
    }
    // Nothing landed.
    for (const table of TABLES) {
      const rows = must(await service.from(table).select("*").eq(OWNER_COLUMN[table]!, victim!.id), table);
      expect(rows.length, `victim rows in ${table} after insert attempts`).toBe(1);
    }
    const intruders = must(await service.from("courses").select("id").eq("name", "intruder course"), "intruders");
    expect(intruders).toEqual([]);
  });

  it("other students cannot update or delete rows owned by the demo student or the victim", async () => {
    for (const attacker of attackers) {
      for (const targetId of [DEMO_STUDENT_ID, victim!.id]) {
        for (const table of TABLES) {
          const owner = OWNER_COLUMN[table]!;
          const label = `${attacker.label} -> ${table} of ${targetId}`;
          const updated = rowsOrDenied(
            await attacker.client.from(table).update({ created_at: EPOCH }).eq(owner, targetId).select(),
            `update ${label}`,
          );
          expect(updated, `update ${label}`).toEqual([]);
          const deleted = rowsOrDenied(
            await attacker.client.from(table).delete().eq(owner, targetId).select(),
            `delete ${label}`,
          );
          expect(deleted, `delete ${label}`).toEqual([]);
        }
      }
    }

    // Students cannot write the service-only tables even for themselves.
    for (const table of ["file_pages", "alerts", "study_blocks", "sms_messages", "magic_links"]) {
      const res = await victim!.client.from(table).update({ created_at: EPOCH }).eq("student_id", victim!.id).select();
      expect(res.error?.code, `victim update own ${table}`).toBe("42501");
    }

    // Everything is still there and untouched.
    for (const table of TABLES) {
      const owner = OWNER_COLUMN[table]!;
      const rows = must(await service.from(table).select("created_at").eq(owner, victim!.id), table);
      expect(rows.length, `victim rows in ${table} after attacks`).toBe(1);
      const touched = must(
        await service.from(table).select("created_at").in(owner, [victim!.id, DEMO_STUDENT_ID]).eq("created_at", EPOCH),
        table,
      );
      expect(touched, `rows in ${table} modified by an attacker`).toEqual([]);
    }
    const demoCourses = must(await service.from("courses").select("id").eq("student_id", DEMO_STUDENT_ID), "courses");
    expect(demoCourses.length).toBeGreaterThanOrEqual(SEED_COUNTS.demo.courses);
    const demoAssignments = must(
      await service.from("assignments").select("id").eq("student_id", DEMO_STUDENT_ID),
      "assignments",
    );
    expect(demoAssignments.length).toBeGreaterThanOrEqual(SEED_COUNTS.demo.assignments);
  });

  it("a student cannot re-own their row to another student", async () => {
    const res = await victim!.client
      .from("courses")
      .update({ student_id: DEMO_STUDENT_ID })
      .eq("id", victimRows.courseId)
      .select();
    expect(res.error, "moving a course to the demo student").not.toBeNull();
  });

  it("child rows cannot point at another student's parent (composite foreign keys)", async () => {
    const mine = fresh!.id;
    const attempts: Array<[string, Record<string, unknown>]> = [
      ["grade_groups", { student_id: mine, course_id: victimRows.courseId, name: "x", weight_percent: 1 }],
      ["assignments", { student_id: mine, course_id: victimRows.courseId, title: "x" }],
      ["files", { student_id: mine, course_id: victimRows.courseId, title: "x", source: "manual" }],
      ["file_pages", { student_id: mine, file_id: victimRows.fileId, page_number: 2, text: "x" }],
      [
        "chat_messages",
        { student_id: mine, session_id: victimRows.chatSessionId, role: "user", text: "x", channel: "web" },
      ],
      [
        "magic_links",
        {
          student_id: mine,
          token_hash: `fk-${Date.now()}-${mine}`,
          file_id: victimRows.fileId,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    ];
    for (const [table, row] of attempts) {
      // Service role bypasses RLS, so only the foreign key can stop this.
      const res = await service.from(table).insert(row).select();
      expect(res.error?.code, `${table} pointing at another student's parent`).toBe("23503");
    }
  });

  it("students cannot write files rows, profile updates are name-only, and storage_path shape is enforced", async () => {
    const demoFileId = randomUUID();
    const otherFileId = randomUUID();

    must(
      await service
        .from("files")
        .insert({
          id: demoFileId,
          student_id: DEMO_STUDENT_ID,
          course_id: COURSE_IDS.history105,
          title: "demo-owned file for hardening test",
          source: "manual",
          storage_path: `${DEMO_STUDENT_ID}/${demoFileId}.pdf`,
        })
        .select("id")
        .single(),
      "seed demo files row",
    );
    must(
      await service
        .from("files")
        .insert({
          id: otherFileId,
          student_id: OTHER_STUDENT_ID,
          course_id: OTHER_COURSE_ID,
          title: "other-owned file for hardening test",
          source: "manual",
          storage_path: `${OTHER_STUDENT_ID}/${otherFileId}.pdf`,
        })
        .select("id")
        .single(),
      "seed other files row",
    );

    const demoInsert = await demo
      .from("files")
      .insert({
        student_id: DEMO_STUDENT_ID,
        course_id: COURSE_IDS.history105,
        title: "demo tries to insert files row",
        source: "manual",
      })
      .select();
    expect(demoInsert.error?.code, "demo insert into files").toBe("42501");

    const otherInsert = await other
      .from("files")
      .insert({
        student_id: OTHER_STUDENT_ID,
        course_id: OTHER_COURSE_ID,
        title: "other tries to insert files row",
        source: "manual",
      })
      .select();
    expect(otherInsert.error?.code, "other insert into files").toBe("42501");

    const demoUpdate = await demo
      .from("files")
      .update({ storage_path: `${DEMO_STUDENT_ID}/${randomUUID()}.pdf` })
      .eq("id", demoFileId)
      .select();
    expect(demoUpdate.error?.code, "demo update files storage_path").toBe("42501");

    const otherUpdate = await other
      .from("files")
      .update({ storage_path: `${OTHER_STUDENT_ID}/${randomUUID()}.pdf` })
      .eq("id", otherFileId)
      .select();
    expect(otherUpdate.error?.code, "other update files storage_path").toBe("42501");

    const name = `Demo Hardened ${Date.now()}`;
    const nameUpdate = await demo.from("profiles").update({ name }).eq("id", DEMO_STUDENT_ID).select("name").single();
    expect(nameUpdate.error, "demo update own profile name").toBeNull();
    expect(nameUpdate.data?.name).toBe(name);

    const phoneUpdate = await demo
      .from("profiles")
      .update({ phone: "+15555550999" })
      .eq("id", DEMO_STUDENT_ID)
      .select("id");
    expect(phoneUpdate.error?.code, "demo update own phone").toBe("42501");

    const canvasUrlUpdate = await demo
      .from("profiles")
      .update({ canvas_base_url: "https://evil.example" })
      .eq("id", DEMO_STUDENT_ID)
      .select("id");
    expect(canvasUrlUpdate.error?.code, "demo update own canvas_base_url").toBe("42501");

    const tokenUpdate = await demo
      .from("profiles")
      .update({ canvas_token_encrypted: "not-allowed" })
      .eq("id", DEMO_STUDENT_ID)
      .select("id");
    expect(tokenUpdate.error?.code, "demo update own canvas_token_encrypted").toBe("42501");

    const badFileId = randomUUID();
    const mismatched = await service
      .from("files")
      .insert({
        id: badFileId,
        student_id: DEMO_STUDENT_ID,
        course_id: COURSE_IDS.history105,
        title: "service role mismatch test",
        source: "manual",
        storage_path: `${OTHER_STUDENT_ID}/${badFileId}.pdf`,
      })
      .select("id");
    expect(mismatched.error?.code, "service role insert mismatched storage_path").toBe("23514");

    await service.from("files").delete().in("id", [demoFileId, otherFileId, badFileId]);
  });

  it("the auth trigger creates the profile with the name from user metadata", async () => {
    const profiles = must(await service.from("profiles").select("id, name").eq("id", fresh!.id), "profile");
    expect(profiles.map((p) => p.name)).toEqual(["RLS Fresh"]);
  });
});
