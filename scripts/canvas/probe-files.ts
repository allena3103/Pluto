// Read-only live probe: how many PDFs `listCourseFiles` finds per real Canvas course (GET only).
// Reads CANVAS_BASE_URL and CANVAS_API_TOKEN from env, else from C:/Pluto/.env.secrets. Never prints them.
//   npx tsx scripts/canvas/probe-files.ts [canvasCourseId ...]
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { createCanvasClient } from "@pluto/canvas/client";

const SECRETS_FILE = "C:/Pluto/.env.secrets";
const COURSES: Array<[id: string, label: string]> = [
  ["40414", "OIM 350"],
  ["41909", "INFO 324"],
  ["41270", "COMPSCI 325"],
  ["41896", "COMPSCI 328"],
];

async function main(): Promise<number> {
  if (existsSync(SECRETS_FILE)) config({ path: SECRETS_FILE, quiet: true });
  const baseUrl = process.env.CANVAS_BASE_URL;
  const token = process.env.CANVAS_API_TOKEN;
  if (!baseUrl || !token) {
    console.error(`CANVAS_BASE_URL and CANVAS_API_TOKEN must be set (env or ${SECRETS_FILE}).`);
    return 1;
  }

  const ids = process.argv.slice(2);
  const courses = ids.length > 0 ? ids.map((id): [string, string] => [id, ""]) : COURSES;
  const client = createCanvasClient({ baseUrl, token, mode: "live" });

  let failed = false;
  for (const [id, label] of courses) {
    try {
      const files = await client.listCourseFiles(id);
      console.log(`${id} ${label}: ${files.length} PDFs`);
    } catch (error) {
      failed = true;
      console.log(`${id} ${label}: error ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code));
