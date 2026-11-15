// `npm run e2e:chat`: end-to-end check of web chat, saved notes and SMS (handoff section 4).
//   npm run e2e:chat                       scenarios 1-9, PLUTO_LLM=mock
//   npm run e2e:chat -- --llm gemini       scenarios 10-12, real Gemini
//   --port <n>        port for the run's own `next dev` (default 3500)
//   --base-url <url>  reuse a running server instead (not started or stopped here)
//   --only <ids>      comma-separated scenario ids
// Needs the local Supabase stack and apps/web/.env.local. Artifacts: .e2e-artifacts/<run>/.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { launchBrowser, newPage, signIn, trackChatResponses, goto } from "./lib/browser.mjs";
import { cleanup, connectDb, createTracker, dbNow, leftovers } from "./lib/db.mjs";
import { ROOT, loadWebEnv, localDbUrl, requireEnv } from "./lib/env.mjs";
import { killDevServerNow, startDevServer, stopDevServer, warmUp } from "./lib/server.mjs";
import { DEMO_ID, MOCK_SCENARIOS, OTHER_ID } from "./scenarios-mock.mjs";
import { GEMINI_SCENARIOS } from "./scenarios-gemini.mjs";

const { values: args } = parseArgs({
  options: {
    llm: { type: "string", default: "mock" },
    port: { type: "string", default: "3500" },
    "base-url": { type: "string" },
    only: { type: "string" },
  },
});
if (args.llm !== "mock" && args.llm !== "gemini") throw new Error("--llm must be mock or gemini");
const port = Number(args.port);

const runId = new Date().toISOString().replace(/[:.]/g, "-");
const artifacts = join(ROOT, ".e2e-artifacts", `${runId}-${args.llm}`);
mkdirSync(artifacts, { recursive: true });

const env = loadWebEnv();
const dbUrl = localDbUrl(env);
requireEnv(env, "DEMO_STUDENT_PASSWORD");
requireEnv(env, "OTHER_STUDENT_PASSWORD");
if (args.llm === "gemini") requireEnv(env, "GEMINI_API_KEY");

const only = args.only ? new Set(args.only.split(",").map(Number)) : null;
const scenarios = (args.llm === "gemini" ? GEMINI_SCENARIOS : MOCK_SCENARIOS).filter((s) => !only || only.has(s.id));

const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const log = (line) => console.log(line);

// A stray puppeteer rejection must not skip cleanup and the server stop in `finally`.
process.on("unhandledRejection", (err) => {
  log(`e2e: unhandled rejection: ${err instanceof Error ? err.message : String(err)}`);
});

const db = await connectDb(dbUrl);
const tracker = createTracker({ studentIds: [DEMO_ID, OTHER_ID], since: await dbNow(db) });
const results = [];
let server;
let browser;
let failed = false;
process.once("SIGINT", async () => {
  log("e2e: interrupted");
  if (server) killDevServerNow(server);
  try {
    log(`e2e: cleanup ${(await cleanup(db, tracker)).line}`);
  } catch (err) {
    log(`e2e: cleanup FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(130);
});

try {
  let baseUrl = args["base-url"]?.replace(/\/+$/, "");
  if (!baseUrl) {
    log(`e2e: starting next dev on ${port} (PLUTO_LLM=${args.llm}); log ${join(artifacts, "server.log")}`);
    const started = Date.now();
    server = await startDevServer({
      port,
      logFile: join(artifacts, "server.log"),
      env: {
        PLUTO_LLM: args.llm,
        PORT: String(port),
        APP_URL: `http://localhost:${port}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
        SMS_PROVIDER: "simulator",
        CANVAS_MODE: "fixtures",
        PLUTO_AUTO_LOGIN_DEMO: "",
      },
    });
    baseUrl = server.baseUrl;
    log(`e2e: server ready in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
  await warmUp(baseUrl);

  browser = await launchBrowser();
  const page = await newPage(browser.browser);
  trackChatResponses(page, tracker);
  await signIn(page, baseUrl, requireEnv(env, "DEMO_STUDENT_EMAIL"), env.DEMO_STUDENT_PASSWORD);
  for (const path of ["/", "/notes", "/sms-sim", "/notes/saved/00000000-0000-4000-8000-000000000000"]) {
    await goto(page, `${baseUrl}${path}`);
  }

  const ctx = { page, browser: browser.browser, baseUrl, db, dbUrl, env, tracker, state: {} };
  for (const scenario of scenarios) {
    const name = `${String(scenario.id).padStart(2, "0")}-${slug(scenario.name)}`;
    const started = Date.now();
    let line;
    try {
      const evidence = (await scenario.run(ctx)).replace(/\s+/g, " ");
      line = `PASS ${scenario.id}. ${scenario.name} (${((Date.now() - started) / 1000).toFixed(1)}s): ${evidence}`;
      results.push({ id: scenario.id, ok: true });
    } catch (err) {
      failed = true;
      line = `FAIL ${scenario.id}. ${scenario.name} (${((Date.now() - started) / 1000).toFixed(1)}s): ${err instanceof Error ? err.message : String(err)}`;
      results.push({ id: scenario.id, ok: false });
    }
    await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true }).catch(() => {});
    log(line);
  }
} catch (err) {
  failed = true;
  log(`FAIL setup: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  try {
    const summary = await cleanup(db, tracker);
    const left = await leftovers(db, tracker);
    if (left > 0) failed = true;
    log(`e2e: cleanup ${summary.line}; ${left} tracked rows left`);
  } catch (err) {
    failed = true;
    log(`e2e: cleanup FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
  await browser?.close();
  if (server) {
    const status = await stopDevServer(server);
    if (status.includes("STILL IN USE")) failed = true;
    log(`e2e: server stopped, ${status}`);
  }
  await db.end().catch(() => {});
}

const passed = results.filter((r) => r.ok).length;
log(`e2e: ${passed}/${scenarios.length} passed (llm=${args.llm}); artifacts ${artifacts}`);
process.exit(failed ? 1 : 0);
