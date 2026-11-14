import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // DB tests share one local Supabase stack; keep files serial to avoid auth rate limits.
    fileParallelism: false,
  },
});
