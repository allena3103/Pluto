// Reads apps/web/.env.local without putting it into process.env. Values are never printed.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const WEB_DIR = join(ROOT, "apps", "web");

export function loadWebEnv() {
  const file = join(WEB_DIR, ".env.local");
  if (!existsSync(file)) throw new Error("apps/web/.env.local not found. Run `npm run env:local -- --port 3500` first.");
  return parse(readFileSync(file, "utf8"));
}

/** Only the local stack. Refuses anything that is not 127.0.0.1/localhost, so a hosted URL can never be used here. */
export function localDbUrl(env) {
  const url = env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is missing from apps/web/.env.local.");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("SUPABASE_DB_URL must point at the local stack.");
  return url;
}

export function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is missing from apps/web/.env.local.`);
  return value;
}
