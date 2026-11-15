// Handoff section 4, scenarios 10-12 (PLUTO_LLM=gemini). Gemini is not deterministic: these check
// structure (card shown, no fallback, no error, timing), never wording.
import { CARD, chatText, openChat, pickOption, readCard, sendChat, submitCard, typeAnswer } from "./lib/browser.mjs";
import { DEMO_ID, check } from "./scenarios-mock.mjs";

const FALLBACK = "I couldn't put an answer together just now.";
const REPLY_TIMEOUT = 60_000;
const STUDY_GUIDE_BUDGET_MS = 25_000;
// Markup the chat cannot render and would show as raw text: LaTeX math and unrendered rules.
const RAW_MARKUP = /\$\\|\\(?:text|frac|mathrm)\{|^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m;

function checkAnswer(reply, label) {
  check(reply, `${label}: no reply`);
  check(!reply.error, `${label}: error "${reply.error}"`);
  check(!reply.text.includes(FALLBACK), `${label}: fallback text`);
  check(reply.text.trim().length > 0 || reply.hasCard, `${label}: empty reply`);
  const raw = RAW_MARKUP.exec(reply.text);
  check(!raw, `${label}: raw markup shown: "${raw?.[0]}"`);
}

async function courseNames(db) {
  const { rows } = await db.query("select name from courses where student_id = $1 order by name", [DEMO_ID]);
  return rows.map((r) => r.name);
}

async function s10(ctx) {
  const { page, baseUrl } = ctx;
  const out = [];
  for (const message of ["lets take a look at my class notes", "summarize my notes"]) {
    await openChat(page, baseUrl);
    const reply = await sendChat(page, message, REPLY_TIMEOUT);
    checkAnswer(reply, message);
    check(reply.hasCard && (await page.$(CARD)) !== null, `"${message}": no questions card; got "${reply.text.slice(0, 160)}"`);
    const card = await readCard(page);
    out.push(`"${message}" -> card ${card.length}q in ${(reply.ms / 1000).toFixed(1)}s`);
  }
  return out.join("; ");
}

async function s11(ctx) {
  const { page, baseUrl, db } = ctx;
  const number = (await courseNames(db)).map((name) => /\d{3}/.exec(name)?.[0]).find(Boolean);
  check(number, "no course number among the demo student's courses");
  await openChat(page, baseUrl);
  const first = await sendChat(page, "when is my next exam", REPLY_TIMEOUT);
  checkAnswer(first, "when is my next exam");
  const second = await sendChat(page, `check ${number}`, REPLY_TIMEOUT);
  checkAnswer(second, `check ${number}`);
  check(second.text.trim().length > 0, `check ${number}: empty reply`);
  check(!/http/i.test(await chatText(page)), "chat text contains http");
  return `turn 1 ${(first.ms / 1000).toFixed(1)}s${first.hasCard ? " (card)" : ""}; "check ${number}" ${(second.ms / 1000).toFixed(1)}s: "${second.text.trim().slice(0, 100)}"`;
}

async function s12(ctx) {
  const { page, baseUrl, db } = ctx;
  const names = await courseNames(db);
  await openChat(page, baseUrl);
  const started = Date.now();
  const asked = await sendChat(page, "build me a study guide with this weeks notes", REPLY_TIMEOUT);
  checkAnswer(asked, "study guide request");
  check(asked.hasCard, `no questions card; got "${asked.text.slice(0, 160)}"`);
  const card = await readCard(page);
  for (let i = 0; i < card.length; i++) {
    const q = card[i];
    const option = q.options.find((o) => names.includes(o)) ?? q.options.find((o) => /this week/i.test(o)) ?? q.options[0];
    if (option) await pickOption(page, i, option);
    else await typeAnswer(page, i, "this week");
  }
  const reply = await submitCard(page, REPLY_TIMEOUT);
  const total = Date.now() - started;
  checkAnswer(reply, "study guide");
  check(reply.text.trim().length > 0, "empty study guide");
  check(total < STUDY_GUIDE_BUDGET_MS, `took ${(total / 1000).toFixed(1)}s (budget 25s)`);
  return `card ${card.length}q in ${(asked.ms / 1000).toFixed(1)}s, guide in ${(reply.ms / 1000).toFixed(1)}s, total ${(total / 1000).toFixed(1)}s; ${reply.headings.length} headings, ${reply.sources.length} chips${reply.savedText ? `, "${reply.savedText}"` : ""}`;
}

export const GEMINI_SCENARIOS = [
  { id: 10, name: "vague requests ask with the questions card", run: s10 },
  { id: 11, name: "next exam, then course number", run: s11 },
  { id: 12, name: "study guide under 25 s", run: s12 },
];
