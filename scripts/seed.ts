// `npm run seed`: runs supabase/seed.sql against the local database, then sets the seeded students'
// passwords and the demo phone from env. Safe to re-run.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { loadLocalEnv, repoRoot, requireEnv } from "./lib/env";
import { DEMO_STUDENT_ID, OTHER_STUDENT_ID } from "./lib/seed-ids";

const STATEMENT_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const COUNTED_TABLES = ["courses", "grade_groups", "assignments", "files", "file_pages"] as const;

export interface SeedContext {
  /** Service-role client (server-only). */
  admin: SupabaseClient;
  demoStudentId: string;
  otherStudentId: string;
}

/**
 * Seam for the ingest task: upload the synthetic lecture PDFs to the `notes` bucket
 * (`<student_id>/<file_id>.pdf`), insert `files` rows and run ingest. Must stay idempotent.
 */
export async function seedFiles(_ctx: SeedContext): Promise<void> {
  // Intentionally empty until the ingest task lands.
}

async function runSeedSql(dbUrl: string): Promise<void> {
  const sql = readFileSync(join(repoRoot, "supabase", "seed.sql"), "utf8");
  const client = new pg.Client({
    connectionString: dbUrl,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

async function seedCounts(dbUrl: string): Promise<Record<string, number>> {
  const client = new pg.Client({
    connectionString: dbUrl,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    const counts: Record<string, number> = {};
    const users = await client.query("select count(*)::int as n from auth.users where id = any($1::uuid[])", [
      [DEMO_STUDENT_ID, OTHER_STUDENT_ID],
    ]);
    counts["auth.users"] = users.rows[0].n;
    const profiles = await client.query("select count(*)::int as n from public.profiles where id = any($1::uuid[])", [
      [DEMO_STUDENT_ID, OTHER_STUDENT_ID],
    ]);
    counts.profiles = profiles.rows[0].n;
    for (const table of COUNTED_TABLES) {
      const res = await client.query(
        `select count(*)::int as n from public.${table} where student_id = any($1::uuid[])`,
        [[DEMO_STUDENT_ID, OTHER_STUDENT_ID]],
      );
      counts[table] = res.rows[0].n;
    }
    return counts;
  } finally {
    await client.end();
  }
}

function adminClient(): SupabaseClient {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
    },
  });
}

async function setPassword(admin: SupabaseClient, userId: string, envName: string): Promise<void> {
  const password = process.env[envName];
  if (!password) {
    console.log(`seed: ${envName} not set, keeping the seed.sql default password`);
    return;
  }
  const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
  if (error) throw new Error(`seed: setting password from ${envName} failed: ${error.message}`);
  console.log(`seed: password set from ${envName}`);
}

async function setDemoPhone(admin: SupabaseClient): Promise<void> {
  const phone = process.env.DEMO_STUDENT_PHONE?.trim();
  if (!phone) return;
  if (!E164.test(phone)) throw new Error("seed: DEMO_STUDENT_PHONE must be E.164, for example +14135550123");
  const { data, error } = await admin.from("profiles").update({ phone }).eq("id", DEMO_STUDENT_ID).select("id");
  if (error) throw new Error(`seed: setting demo phone failed: ${error.message}`);
  if (!data || data.length !== 1) throw new Error("seed: demo profile not found when setting phone");
  console.log("seed: demo phone set from DEMO_STUDENT_PHONE");
}

export async function main(): Promise<void> {
  loadLocalEnv();
  const dbUrl = requireEnv("SUPABASE_DB_URL");

  await runSeedSql(dbUrl);
  console.log("seed: supabase/seed.sql applied");

  const admin = adminClient();
  await setPassword(admin, DEMO_STUDENT_ID, "DEMO_STUDENT_PASSWORD");
  await setPassword(admin, OTHER_STUDENT_ID, "OTHER_STUDENT_PASSWORD");
  await setDemoPhone(admin);

  await seedFiles({ admin, demoStudentId: DEMO_STUDENT_ID, otherStudentId: OTHER_STUDENT_ID });

  const counts = await seedCounts(dbUrl);
  console.log(
    "seed: rows for seeded students: " +
      Object.entries(counts)
        .map(([table, n]) => `${table}=${n}`)
        .join(" "),
  );
  console.log("seed: done");
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
