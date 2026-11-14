// `npm run smoke`: runs every smoke file in this folder (each default-exports an async function).
// Foundation adds 00-core.ts in F2; later orchestrators add their own files (10-web.ts, 30-mcp.ts, ...).
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { loadLocalEnv } from "../lib/env";

loadLocalEnv();

const dir = fileURLToPath(new URL(".", import.meta.url));
const files = readdirSync(dir)
  .filter((f) => /^\d\d-.*\.ts$/.test(f))
  .sort();

let failed = 0;
for (const file of files) {
  const mod = (await import(pathToFileURL(join(dir, file)).href)) as { default?: () => Promise<void> };
  if (typeof mod.default !== "function") {
    console.error(`FAIL ${file}: no default export`);
    failed++;
    continue;
  }
  try {
    await mod.default();
    console.log(`PASS ${file}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${file}:`, err instanceof Error ? err.message : err);
  }
}
console.log(`smoke: ${files.length - failed}/${files.length} files passed`);
process.exit(failed === 0 ? 0 : 1);
