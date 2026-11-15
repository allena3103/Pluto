// `npm run seed:judge`: creates or resets the shared judge demo account behind the login page's
// "Judge demo login" button. Deletes the judge user (every judge row cascades: chats, saved notes,
// courses, files), recreates it with `app_metadata.judge`, loads the synthetic courses
// (scripts/seed-judge.sql) and the lecture PDFs. Touches no other student, so it is safe to run
// against the hosted project (`npm run env:local -- --hosted` writes .env.production.local; pass
// `--hosted` here to read it).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import pg from "pg";
import { NOTES_BUCKET } from "@pluto/core/ingest";
import type { PlutoDb } from "@pluto/core/context";
import { loadLocalEnv, repoRoot, requireEnv } from "./lib/env";
import { seedJudgeLectureFiles } from "./lib/seed-files";
import { JUDGE_STUDENT_ID } from "./lib/seed-ids";

const STATEMENT_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
/** The `.env.example` default. Fine on a laptop, refused anywhere else. */
const LOCAL_DEFAULT_PASSWORD = "pluto-judge-local-1";

function loadEnv(): void {
  if (process.argv.includes("--hosted")) {
    config({ path: join(repoRoot, "apps", "web", ".env.production.local"), quiet: true });
  } else {
    loadLocalEnv();
  }
}

function adminClient(url: string): SupabaseClient {
  return createClient(url, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) }),
    },
  });
}

async function withDb<T>(dbUrl: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: dbUrl,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: STATEMENT_TIMEOUT_MS + 5_000,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Removes every stored object under the judge's notes folder (stale PDFs from earlier runs). */
async function clearJudgeStorage(admin: SupabaseClient): Promise<void> {
  const { data, error } = await admin.storage.from(NOTES_BUCKET).list(JUDGE_STUDENT_ID, { limit: 1000 });
  if (error) throw new Error(`seed:judge: listing judge storage failed: ${error.message}`);
  if (data.length === 0) return;
  const { error: removeError } = await admin.storage
    .from(NOTES_BUCKET)
    .remove(data.map((object) => `${JUDGE_STUDENT_ID}/${object.name}`));
  if (removeError) throw new Error(`seed:judge: clearing judge storage failed: ${removeError.message}`);
}

export async function main(): Promise<void> {
  loadEnv();
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const dbUrl = requireEnv("SUPABASE_DB_URL");
  const email = requireEnv("JUDGE_STUDENT_EMAIL").trim();
  const password = requireEnv("JUDGE_STUDENT_PASSWORD");
  const local = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  if (!local && password === LOCAL_DEFAULT_PASSWORD) {
    throw new Error("seed:judge: set a real JUDGE_STUDENT_PASSWORD (PROD_JUDGE_STUDENT_PASSWORD in the secrets file) for a hosted project");
  }

  const sql = readFileSync(join(repoRoot, "scripts", "seed-judge.sql"), "utf8");
  const admin = adminClient(url);

  // Delete by id and by email: the email may be held by a hand-made user. Cascades every judge row.
  await withDb(dbUrl, (client) =>
    client.query("delete from auth.users where id = $1 or lower(email) = lower($2)", [JUDGE_STUDENT_ID, email]),
  );
  console.log("seed:judge: old judge account removed");

  const { error: createError } = await admin.auth.admin.createUser({
    id: JUDGE_STUDENT_ID,
    email,
    password,
    email_confirm: true,
    app_metadata: { judge: true },
    user_metadata: { name: "Judge Demo" },
  });
  if (createError) throw new Error(`seed:judge: creating the judge user failed: ${createError.message}`);

  await withDb(dbUrl, async (client) => {
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    }
  });
  console.log("seed:judge: courses, grade groups and assignments loaded");

  await clearJudgeStorage(admin);
  await seedJudgeLectureFiles(admin as PlutoDb);
  console.log(`seed:judge: done (${email}, ${local ? "local" : new URL(url).hostname})`);
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
