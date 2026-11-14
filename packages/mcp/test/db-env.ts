// Shared gate for tests that need the local Supabase stack.
// CI sets PLUTO_SKIP_DB_TESTS=1 (no Docker stack there). Locally the tests must run:
// if the env is missing they fail loudly instead of skipping.
//
// Usage:  describe.skipIf(SKIP_DB_TESTS)("...", () => { const env = dbEnv(); ... })
export const SKIP_DB_TESTS = process.env.PLUTO_SKIP_DB_TESTS === "1";

export interface DbEnv {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export function dbEnv(): DbEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "DB tests need local Supabase env. Run `npx supabase start` and `npm run env:local` (or set PLUTO_SKIP_DB_TESTS=1 to skip, CI only).",
    );
  }
  return { url, anonKey, serviceRoleKey };
}
