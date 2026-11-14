// `npm run dev`: starts the Next.js dev server on the port from apps/web/.env.local (PORT), default 3000.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, "apps", "web", ".env.local");
let port = process.env.PORT ?? "3000";
if (existsSync(envFile)) {
  const m = /^PORT=(\d+)\s*$/m.exec(readFileSync(envFile, "utf8"));
  if (m) port = m[1];
} else {
  console.warn("dev: apps/web/.env.local not found. Run `npm run env:local` first.");
}
const child = spawn("npm", ["run", "dev", "-w", "@pluto/web", "--", "-p", port], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
