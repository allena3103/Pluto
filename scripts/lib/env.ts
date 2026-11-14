// Loads apps/web/.env.local for scripts (seed, smoke). Run `npm run env:local` first.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export function loadLocalEnv(): void {
  const envFile = fileURLToPath(new URL("../../apps/web/.env.local", import.meta.url));
  if (existsSync(envFile)) config({ path: envFile, quiet: true });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Run \`npm run env:local\` first.`);
  return value;
}
