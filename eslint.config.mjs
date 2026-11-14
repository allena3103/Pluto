// Root ESLint config: used by packages/* and scripts/. apps/web has its own config.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "apps/web/**", "**/database.types.ts", "supabase/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly", fetch: "readonly", AbortSignal: "readonly", Buffer: "readonly", setTimeout: "readonly", clearTimeout: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
