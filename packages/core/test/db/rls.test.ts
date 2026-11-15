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

/** The column an attacker tries to overwrite; assignment_file_pages has no created_at. */
function touch(table: string): { column: string; value: string } {
  return table === "assignment_file_pages" ? { column: "text", value: "hijacked" } : { column: "created_at", value: EPOCH };
}

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
    expect(tables.map((t) => t.table_name).sort()).toEqual([...TABLES, "sms_inbound_receipts"].sort());

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
    const linkCodes = rowsOrDenied(
      await victim!.client.from("phone_link_codes").select("*"),
      "victim -> phone_link_codes",
    );
    expect(linkCodes).toEqual([]);
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
        assignmentId: victimRows.assignmentId,
        assignmentFileId: victimRows.assignmentFileId,
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
          const { column, value } = touch(table);
          const updated = rowsOrDenied(
            await attacker.client.from(table).update({ [column]: value }).eq(owner, targetId).select(),
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

    // Students cannot write the service-only tables even for themselves, and a saved note is never edited.
    for (const table of ["file_pages", "alerts", "study_blocks", "sms_messages", "magic_links", "phone_link_codes", "saved_notes", "assignment_files", "assignment_file_pages"]) {
      const { column, value } = touch(table);
      const res = await victim!.client.from(table).update({ [column]: value }).eq("student_id", victim!.id).select();
      expect(res.error?.code, `victim update own ${table}`).toBe("42501");
    }

    // Everything is still there and untouched.
    for (const table of TABLES) {
      const owner = OWNER_COLUMN[table]!;
      const { column, value } = touch(table);
      const rows = must(await service.from(table).select(column).eq(owner, victim!.id), table);
      expect(rows.length, `victim rows in ${table} after attacks`).toBe(1);
      const touched = must(
        await service.from(table).select(column).in(owner, [victim!.id, DEMO_STUDENT_ID]).eq(column, value),
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
        "saved_notes",
        { student_id: mine, course_id: victimRows.courseId, title: "x", body: "x" },
      ],
      [
        "saved_notes",
        { student_id: mine, session_id: victimRows.chatSessionId, title: "x", body: "x" },
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
      [
        "assignment_files",
        { student_id: mine, assignment_id: victimRows.assignmentId, canvas_file_id: "x", title: "x", file_type: "pdf" },
      ],
      ["assignment_file_pages", { student_id: mine, assignment_file_id: victimRows.assignmentFileId, page_number: 2, text: "x" }],
    ];
    for (const [table, row] of attempts) {
      // Service role bypasses RLS, so only the foreign key can stop this.
      const res = await service.from(table).insert(row).select();
      expect(res.error?.code, `${table} pointing at another student's parent`).toBe("23503");
    }
  });

  it("the auth trigger creates the profile with the name from user metadata", async () => {
    const profiles = must(await service.from("profiles").select("id, name").eq("id", fresh!.id), "profile");
    expect(profiles.map((p) => p.name)).toEqual(["RLS Fresh"]);
  });

  it("other students cannot rename a profile or retitle a file they do not own", async () => {
    const profileBefore = one(await service.from("profiles").select("name").eq("id", victim!.id).single(), "victim name");
    const fileBefore = one(await service.from("files").select("title").eq("id", victimRows.fileId).single(), "victim title");

    for (const attacker of attackers) {
      const renamed = await attacker.client.from("profiles").update({ name: "hijacked" }).eq("id", victim!.id).select();
      expect(renamed.error, `${attacker.label} rename`).toBeNull();
      expect(renamed.data, `${attacker.label} rename`).toEqual([]);

      const retitled = await attacker.client
        .from("files")
        .update({ title: "hijacked" })
        .eq("id", victimRows.fileId)
        .select();
      expect(retitled.error, `${attacker.label} retitle`).toBeNull();
      expect(retitled.data, `${attacker.label} retitle`).toEqual([]);
    }

    const profileAfter = one(await service.from("profiles").select("name").eq("id", victim!.id).single(), "victim name after");
    const fileAfter = one(await service.from("files").select("title").eq("id", victimRows.fileId).single(), "victim title after");
    expect(profileAfter.name).toBe(profileBefore.name);
    expect(fileAfter.title).toBe(fileBefore.title);
  });

  it("a student can edit their own file but cannot aim storage_path at any object", async () => {
    const inserted = one(
      await victim!.client
        .from("files")
        .insert({
          student_id: victim!.id,
          course_id: victimRows.courseId,
          title: "My notes",
          source: "manual",
        })
        .select("id, title, storage_path, ingest_status, page_count")
        .single(),
      "insert own file",
    );
    const fileId = inserted.id;

    try {
      expect(inserted.storage_path).toBeNull();
      expect(inserted.ingest_status).toBe("pending");

      const renamed = one(
        await victim!.client.from("files").update({ title: "Renamed notes", week_label: "Week 2" }).eq("id", fileId).select("title, week_label").single(),
        "rename own file",
      );
      expect(renamed).toMatchObject({ title: "Renamed notes", week_label: "Week 2" });

      const foreignPaths = [
        `${DEMO_STUDENT_ID}/${fileId}.pdf`,
        `${DEMO_STUDENT_ID}/${victimRows.fileId}.pdf`,
        `${victim!.id}/${victimRows.fileId}.pdf`,
        `${victim!.id}/../${DEMO_STUDENT_ID}/${victimRows.fileId}.pdf`,
        `${victim!.id}/${fileId}.pdf`,
        null,
      ];
      for (const storagePath of foreignPaths) {
        const res = await victim!.client.from("files").update({ storage_path: storagePath }).eq("id", fileId).select();
        expect(res.error?.code, `student storage_path ${storagePath}`).toBe("42501");
      }

      const withTitle = await victim!.client
        .from("files")
        .update({ title: "should not stick", storage_path: `${DEMO_STUDENT_ID}/${fileId}.pdf` })
        .eq("id", fileId)
        .select();
      expect(withTitle.error?.code, "title mixed with storage_path").toBe("42501");

      for (const patch of [{ ingest_status: "ready" }, { ingest_error: "nope" }, { page_count: 4 }]) {
        const res = await victim!.client.from("files").update(patch).eq("id", fileId).select();
        expect(res.error?.code, `student ${Object.keys(patch).join(",")}`).toBe("42501");
      }

      const sneaky = await victim!.client
        .from("files")
        .insert({
          student_id: victim!.id,
          course_id: victimRows.courseId,
          title: "sneaky",
          source: "manual",
          storage_path: `${DEMO_STUDENT_ID}/${victimRows.fileId}.pdf`,
        })
        .select("id");
      expect(sneaky.error?.code, "student insert storage_path").toBe("42501");

      const row = must(
        await service.from("files").select("title, week_label, storage_path, ingest_status, ingest_error, page_count").eq("id", fileId).single(),
        "file unchanged",
      );
      expect(row).toMatchObject({
        title: "Renamed notes",
        week_label: "Week 2",
        storage_path: null,
        ingest_status: "pending",
        ingest_error: null,
        page_count: null,
      });
      const sneakyRows = must(await service.from("files").select("id").eq("title", "sneaky"), "sneaky rows");
      expect(sneakyRows).toEqual([]);
    } finally {
      await service.from("files").delete().eq("id", fileId);
    }
  });

  it("storage_path is null or exactly <student_id>/<file_id>.pdf, even for service role", async () => {
    const id = randomUUID();
    const canonical = `${victim!.id}/${id}.pdf`;
    const created = one(
      await service
        .from("files")
        .insert({
          id,
          student_id: victim!.id,
          course_id: victimRows.courseId,
          title: "canonical path",
          source: "manual",
          storage_path: canonical,
        })
        .select("storage_path")
        .single(),
      "canonical insert",
    );
    expect(created.storage_path).toBe(canonical);

    const badPaths = [
      `${DEMO_STUDENT_ID}/${id}.pdf`,
      `${DEMO_STUDENT_ID}/${victimRows.fileId}.pdf`,
      `${victim!.id}/${victimRows.fileId}.pdf`,
      `${victim!.id}/../${DEMO_STUDENT_ID}/${victimRows.fileId}.pdf`,
      `${victim!.id.toUpperCase()}/${id.toUpperCase()}.pdf`,
      `${canonical}/extra`,
      `/${canonical}`,
      "",
      `notes/${canonical}`,
    ];
    for (const storagePath of badPaths) {
      const res = await service.from("files").update({ storage_path: storagePath }).eq("id", id).select("storage_path");
      expect(res.error?.code, storagePath).toBe("23514");
    }

    const badId = randomUUID();
    const badInsert = await service
      .from("files")
      .insert({
        id: badId,
        student_id: victim!.id,
        course_id: victimRows.courseId,
        title: "bad path",
        source: "manual",
        storage_path: `${DEMO_STUDENT_ID}/${badId}.pdf`,
      })
      .select("id");
    expect(badInsert.error?.code, "service insert of another student's key").toBe("23514");

    const still = one(await service.from("files").select("storage_path").eq("id", id).single(), "still canonical");
    expect(still.storage_path).toBe(canonical);
    const absent = must(await service.from("files").select("id").eq("id", badId), "bad insert rolled back");
    expect(absent).toEqual([]);

    const cleared = one(
      await service.from("files").update({ storage_path: null }).eq("id", id).select("storage_path").single(),
      "clear path",
    );
    expect(cleared.storage_path).toBeNull();
    await service.from("files").delete().eq("id", id);
  });

  it("a student can update only their profile name", async () => {
    const mine = one(
      await victim!.client.from("profiles").select("name, phone, canvas_base_url, canvas_token_encrypted").eq("id", victim!.id).single(),
      "own profile",
    );
    expect(mine.phone).toBeNull();

    const otherPhone = one(await service.from("profiles").select("phone").eq("id", OTHER_STUDENT_ID).single(), "other phone");
    expect(otherPhone.phone).toBeTruthy();

    const claimed = await victim!.client.from("profiles").update({ phone: otherPhone.phone }).eq("id", victim!.id).select();
    expect(claimed.error?.code, "claim another student's phone").toBe("42501");

    const unusedPhone = `+1555${victim!.id.replace(/\D/g, "").slice(0, 7).padEnd(7, "0")}`;
    const selfPhone = await victim!.client.from("profiles").update({ phone: unusedPhone }).eq("id", victim!.id).select();
    expect(selfPhone.error?.code, "set an unowned phone").toBe("42501");

    const ssrf = await victim!.client
      .from("profiles")
      .update({ canvas_base_url: "http://127.0.0.1/" })
      .eq("id", victim!.id)
      .select();
    expect(ssrf.error?.code, "canvas_base_url").toBe("42501");

    const token = await victim!.client
      .from("profiles")
      .update({ canvas_token_encrypted: "student-supplied" })
      .eq("id", victim!.id)
      .select();
    expect(token.error?.code, "canvas_token_encrypted").toBe("42501");

    const created = await victim!.client
      .from("profiles")
      .update({ created_at: EPOCH })
      .eq("id", victim!.id)
      .select();
    expect(created.error?.code, "created_at").toBe("42501");

    const mixed = await victim!.client
      .from("profiles")
      .update({ name: "should not stick", phone: unusedPhone, canvas_base_url: "http://169.254.169.254/" })
      .eq("id", victim!.id)
      .select();
    expect(mixed.error?.code, "name mixed with phone and canvas url").toBe("42501");

    const renamed = one(
      await victim!.client.from("profiles").update({ name: "RLS Victim Renamed" }).eq("id", victim!.id).select("name").single(),
      "rename self",
    );
    expect(renamed.name).toBe("RLS Victim Renamed");

    const serverPhone = `+1555${randomUUID().replace(/\D/g, "").slice(0, 7).padEnd(7, "1")}`;
    const asServer = one(
      await service
        .from("profiles")
        .update({
          phone: serverPhone,
          canvas_base_url: "https://umamherst.instructure.com",
          canvas_token_encrypted: "server-sealed",
        })
        .eq("id", victim!.id)
        .select("name, phone, canvas_base_url, canvas_token_encrypted")
        .single(),
      "service role writes the server-owned columns",
    );
    expect(asServer).toMatchObject({
      name: "RLS Victim Renamed",
      phone: serverPhone,
      canvas_base_url: "https://umamherst.instructure.com",
      canvas_token_encrypted: "server-sealed",
    });

    const afterRename = one(
      await victim!.client.from("profiles").update({ name: "RLS Victim" }).eq("id", victim!.id).select("name, phone, canvas_base_url").single(),
      "rename back",
    );
    expect(afterRename).toMatchObject({
      name: "RLS Victim",
      phone: serverPhone,
      canvas_base_url: "https://umamherst.instructure.com",
    });

    const otherStill = one(await service.from("profiles").select("phone").eq("id", OTHER_STUDENT_ID).single(), "other phone unchanged");
    expect(otherStill.phone).toBe(otherPhone.phone);
  });

  it("column privileges and the profile trigger match the write lock", async () => {
    const flags = await pgQuery<{
      profile_name: boolean;
      profile_phone: boolean;
      profile_url: boolean;
      profile_token: boolean;
      profile_created: boolean;
      profile_id: boolean;
      path_update: boolean;
      path_insert: boolean;
      title_update: boolean;
      ingest_update: boolean;
      page_update: boolean;
    }>(
      `select
         has_column_privilege('authenticated', 'public.profiles'::regclass, 'name', 'UPDATE') as profile_name,
         has_column_privilege('authenticated', 'public.profiles'::regclass, 'phone', 'UPDATE') as profile_phone,
         has_column_privilege('authenticated', 'public.profiles'::regclass, 'canvas_base_url', 'UPDATE') as profile_url,
         has_column_privilege('authenticated', 'public.profiles'::regclass, 'canvas_token_encrypted', 'UPDATE') as profile_token,
         has_column_privilege('authenticated', 'public.profiles'::regclass, 'created_at', 'UPDATE') as profile_created,
         has_column_privilege('authenticated', 'public.profiles'::regclass, 'id', 'UPDATE') as profile_id,
         has_column_privilege('authenticated', 'public.files'::regclass, 'storage_path', 'UPDATE') as path_update,
         has_column_privilege('authenticated', 'public.files'::regclass, 'storage_path', 'INSERT') as path_insert,
         has_column_privilege('authenticated', 'public.files'::regclass, 'title', 'UPDATE') as title_update,
         has_column_privilege('authenticated', 'public.files'::regclass, 'ingest_status', 'UPDATE') as ingest_update,
         has_column_privilege('authenticated', 'public.files'::regclass, 'page_count', 'UPDATE') as page_update`,
    );
    expect(flags).toEqual([
      {
        profile_name: true,
        profile_phone: false,
        profile_url: false,
        profile_token: false,
        profile_created: false,
        profile_id: false,
        path_update: false,
        path_insert: false,
        title_update: true,
        ingest_update: false,
        page_update: false,
      },
    ]);

    const constraint = await pgQuery<{ conname: string }>(
      "select conname from pg_constraint where conname = 'files_storage_path_canonical'",
    );
    expect(constraint.map((row) => row.conname)).toEqual(["files_storage_path_canonical"]);

    const victimId = assertUuid(victim!.id);
    must(
      await service.from("profiles").update({ canvas_base_url: "https://umamherst.instructure.com" }).eq("id", victim!.id).select("id").single(),
      "seed a canvas url for the trigger",
    );
    await expect(
      pgQuery(
        `do $pluto$
         begin
           perform set_config('row_security', 'off', true);
           perform set_config('request.jwt.claim.role', 'authenticated', true);
           perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
           update public.profiles
             set canvas_base_url = 'http://127.0.0.1/'
             where id = '${victimId}';
         end
         $pluto$;`,
      ),
    ).rejects.toThrow(/students may update only profiles.name/);

    const untouched = one(
      await service.from("profiles").select("canvas_base_url").eq("id", victim!.id).single(),
      "canvas url after trigger",
    );
    expect(untouched.canvas_base_url).toBe("https://umamherst.instructure.com");

    await pgQuery(
      `do $pluto$
       begin
         perform set_config('row_security', 'off', true);
         perform set_config('request.jwt.claim.role', 'service_role', true);
         perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
         update public.profiles
           set canvas_base_url = 'https://canvas.example.edu'
           where id = '${victimId}';
       end
       $pluto$;`,
    );
    const cleared = one(
      await service
        .from("profiles")
        .update({ phone: null, canvas_base_url: null, canvas_token_encrypted: null })
        .eq("id", victim!.id)
        .select("phone, canvas_base_url, canvas_token_encrypted")
        .single(),
      "clear server-owned profile columns",
    );
    expect(cleared).toMatchObject({ phone: null, canvas_base_url: null, canvas_token_encrypted: null });
  });
});

function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`refusing to interpolate id ${id}`);
  }
  return id;
}

/** `.single()` is typed as possibly null. `must` preserves that, so narrow it here. */
function one<T extends Record<string, unknown>>(
  res: { data: T | null; error: { message: string } | null },
  label: string,
): T {
  if (res.error || res.data == null) throw new Error(`${label}: ${res.error?.message ?? "no row"}`);
  return res.data;
}
