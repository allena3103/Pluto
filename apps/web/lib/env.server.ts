import "server-only";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Server secrets. This module is not importable from client components. */
export function getServerEnv() {
  return {
    appUrl: requiredEnv("APP_URL"),
    internalApiSecret: requiredEnv("INTERNAL_API_SECRET"),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };
}
