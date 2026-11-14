// Loads apps/web/.env.local (written by `npm run env:local`) so DB tests can reach local Supabase.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const envFile = fileURLToPath(new URL("../../../apps/web/.env.local", import.meta.url));
if (existsSync(envFile)) config({ path: envFile, quiet: true });
