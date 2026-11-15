/* global document, AbortController */
// Handoff section 4, scenarios 1-9 (PLUTO_LLM=mock). Each returns a short evidence string or throws.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  CARD,
  COMPOSER,
  SEND,
  STOP,
  cardSubmitEnabled,
  chatText,
  cookieHeader,
  fillUntilEnabled,
  goto,
  lastAssistant,
  newPage,
  openChat,
  pickOption,
  readCard,
  sendChat,
  signIn,
  submitCard,
  waitForHydration,
  waitForReply,
} from "./lib/browser.mjs";
import { connectDb, dbNow, trackSessionsByTitle } from "./lib/db.mjs";
import { ROOT } from "./lib/env.mjs";

export const DEMO_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ID = "22222222-2222-4222-8222-222222222222";

const SOURCE_HREF = /^\/notes\/[0-9a-f-]{36}\?page=[1-9]\d*$/;
const WHOLE_TERM = "Whole term";
const VAGUE = "lets take a look at my class notes";
const TOPIC = "show me my notes on the printing press";

export function check(condition, message) {
  if (!condition) throw new Error(message);
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** Demo student's classes, the ones with the most ready notes first. */
async function demoCourses(db) {
  const { rows } = await db.query(
    `select c.id, c.name, count(f.id) filter (where f.ingest_status = 'ready') as files
       from courses c left join files f on f.course_id = c.id and f.student_id = c.student_id
      where c.student_id = $1 group by c.id, c.name order by files desc, c.name`,
    [DEMO_ID],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, files: Number(r.files) }));
}

async function savedNote(db, id) {
  const { rows } = await db.query(
    "select id, student_id, course_id, session_id, title, sources from saved_notes where id = $1",
    [id],
  );
  return rows[0] ?? null;
}

const noteIdOf = (href) => decodeURIComponent(href.split("/").pop());

/** Waits until React is live on the empty chat page (typing enables Send), then clears the box. */
async function hydrateChat(page) {
  await fillUntilEnabled(page, COMPOSER, SEND, "x");
  await page.click(COMPOSER);
  await page.keyboard.press("Backspace");
}

async function clickSuggestion(page, text) {
  const buttons = await page.$$("ul[aria-label='Suggestions'] button");
  for (const button of buttons) {
    if ((await button.evaluate((b) => b.textContent.trim())) === text) {
      await button.click();
      return;
    }
  }
  throw new Error(`suggestion "${text}" not found`);
}

/** Answers the class + weeks card and checks the gating. Returns the reply. */
async function answerClassCard(page, courseNames, course) {
  const card = await readCard(page);
  const classIndex = card.findIndex((q) => q.options.some((o) => courseNames.includes(o)));
  check(classIndex >= 0, `no class question in card: ${JSON.stringify(card)}`);
  check(sameSet(card[classIndex].options, courseNames), `class options ${JSON.stringify(card[classIndex].options)} != DB ${JSON.stringify(courseNames)}`);
  check(!(await cardSubmitEnabled(page)), "Send answers enabled before any answer");
  await pickOption(page, classIndex, course.name);
  for (let i = 0; i < card.length; i++) {
    if (i === classIndex) continue;
    check(!(await cardSubmitEnabled(page)), `Send answers enabled with question ${i + 1} unanswered`);
    await pickOption(page, i, card[i].options.includes(WHOLE_TERM) ? WHOLE_TERM : card[i].options[0]);
  }
  check(await cardSubmitEnabled(page), "Send answers still disabled after every question was answered");
  return { reply: await submitCard(page), card };
}

/** The checks shared by scenarios 1 and 2: headings, no URLs, source chips, saved chip, DB row. */
async function checkNotesReply(page, db, reply, course, expectedTitle) {
  check(!reply.error, `reply error: ${reply.error}`);
  check(reply.headings.length > 0, "reply has no headings");
  const text = await chatText(page);
  check(!/http/i.test(text), "chat text contains http");
  check(reply.sources.length > 0, "no source chips");
  for (const href of reply.sources) check(SOURCE_HREF.test(href), `bad source chip href ${href}`);
  // Chips read "<file title> p.<n>", the same as on the saved note's page.
  const fileIds = [...new Set(reply.sources.map((href) => href.split("/")[2].split("?")[0]))];
  const { rows: files } = await db.query("select id, title from files where id = any($1::uuid[])", [fileIds]);
  const titleOf = new Map(files.map((f) => [f.id, f.title.trim()]));
  reply.sources.forEach((href, i) => {
    const [, fileId, pageNumber] = /^\/notes\/([0-9a-f-]+)\?page=(\d+)$/.exec(href);
    const expected = `${titleOf.get(fileId)} p.${pageNumber}`;
    check(reply.sourceLabels[i] === expected, `chip "${reply.sourceLabels[i]}" != "${expected}"`);
  });
  check(reply.savedText === `Saved to Notes · ${course.name}`, `saved chip was "${reply.savedText}"`);
  const id = noteIdOf(reply.savedHref);
  const row = await savedNote(db, id);
  check(row, `saved_notes row ${id} missing`);
  check(row.student_id === DEMO_ID, "saved note has the wrong student");
  check(row.course_id === course.id, `saved note course_id ${row.course_id} != ${course.id}`);
  check(row.title === expectedTitle, `saved note title "${row.title}" != "${expectedTitle}"`);
  return { id, title: row.title, course, sources: row.sources, sessionId: row.session_id };
}

async function s1(ctx) {
  const { page, db, baseUrl, state } = ctx;
  const courses = await demoCourses(db);
  const names = courses.map((c) => c.name);
  const course = courses[0];
  await openChat(page, baseUrl);
  const asked = await sendChat(page, VAGUE);
  check(asked.hasCard, `no questions card; reply: ${asked.text.slice(0, 120)}`);
  const { reply, card } = await answerClassCard(page, names, course);
  state.note1 = await checkNotesReply(page, db, reply, course, `${course.name} notes`);
  return `card ${card.length}q, classes=[${names.join(", ")}]; ${reply.headings.length} headings, ${reply.sources.length} chips, "${reply.savedText}", saved_notes ${state.note1.id} "${state.note1.title}"`;
}

async function s2(ctx) {
  const { page, db, baseUrl, state } = ctx;
  const courses = await demoCourses(db);
  const course = courses.find((c) => c.files > 0 && c.id !== state.note1?.course.id) ?? courses[0];
  await openChat(page, baseUrl);
  await hydrateChat(page);
  await clickSuggestion(page, "Make me a study guide from my latest notes");
  const asked = await waitForReply(page, 0);
  check(asked.hasCard, `no questions card; reply: ${asked.text.slice(0, 120)}`);
  const { reply } = await answerClassCard(page, courses.map((c) => c.name), course);
  state.note2 = await checkNotesReply(page, db, reply, course, `${course.name} study guide`);
  return `suggestion chip -> card -> "${reply.savedText}", title "${state.note2.title}" (${state.note2.id})`;
}

async function s3(ctx) {
  const { page, baseUrl } = ctx;
  await openChat(page, baseUrl);
  const reply = await sendChat(page, TOPIC);
  check(!reply.hasCard && (await page.$(CARD)) === null, "questions card shown for a topic request");
  check(!reply.error, `reply error: ${reply.error}`);
  check(reply.text.trim().length > 0, "empty reply");
  check(reply.sources.length > 0, "no source chips");
  check(!/http/i.test(reply.text), "reply contains http");
  return `no card; "${reply.text.split("\n")[0].slice(0, 80)}", ${reply.sources.length} chip(s)`;
}

async function s4(ctx) {
  const { page, db, baseUrl, state } = ctx;
  const note = state.note1;
  check(note, "needs the note from scenario 1");
  await goto(page, `${baseUrl}/notes`);
  const listed = await page.$$eval(
    "section",
    (sections, id) =>
      sections
        .filter((s) => s.querySelector(`a[href='/notes/saved/${id}']`))
        .map((s) => ({
          heading: s.querySelector("h2")?.textContent.trim(),
          label: [...s.querySelectorAll("p")].some((p) => p.textContent.trim() === "Saved by chat or AI"),
          title: s.querySelector(`a[href='/notes/saved/${id}'] p`)?.textContent.trim(),
        })),
    note.id,
  );
  check(listed.length === 1, `note listed in ${listed.length} sections`);
  check(listed[0].heading === note.course.name, `note under "${listed[0].heading}", expected "${note.course.name}"`);
  check(listed[0].label, `no "Saved by chat or AI" group in ${note.course.name}`);
  check(listed[0].title === note.title, `list title "${listed[0].title}"`);

  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(`a[href='/notes/saved/${note.id}']`)]);
  await page.waitForSelector("article");
  const detail = await page.evaluate(() => {
    const article = document.querySelector("article");
    return {
      h1: document.querySelector("h1")?.textContent.trim(),
      headings: article.querySelectorAll("h2, h3, h4").length,
      items: article.querySelectorAll("ul li, ol li").length,
      rawMarkdown: article.innerText.split("\n").some((line) => /^\s*(#{1,6}\s|- |\* )/.test(line)),
      sources: [...document.querySelectorAll("section[aria-label='Sources'] a")].map((a) => a.getAttribute("href")),
    };
  });
  check(detail.h1 === note.title, `detail h1 "${detail.h1}"`);
  check(detail.headings > 0 && detail.items > 0, `markdown not rendered (headings ${detail.headings}, items ${detail.items})`);
  check(!detail.rawMarkdown, "raw markdown (#, -) visible in the note");
  check(detail.sources.length > 0, "no source chips on the detail page");
  const expected = note.sources.map((s) => `/notes/${s.fileId}?page=${s.page}`);
  for (const href of detail.sources) {
    check(SOURCE_HREF.test(href), `bad source href ${href}`);
    check(expected.includes(href), `source ${href} not in saved_notes.sources`);
  }

  const href = detail.sources[0];
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(`section[aria-label='Sources'] a[href='${href}']`)]);
  const url = new URL(page.url());
  check(`${url.pathname}${url.search}` === href, `source chip opened ${url.pathname}${url.search}`);
  const fileId = href.split("/")[2].split("?")[0];
  const { rows } = await db.query("select title from files where id = $1", [fileId]);
  const fileTitle = rows[0]?.title;
  await page
    .waitForFunction((t) => document.querySelector("h1")?.textContent.trim() === t, { timeout: 60_000 }, fileTitle)
    .catch(() => {});
  const h1 = await page.$eval("h1", (el) => el.textContent.trim()).catch(() => "");
  check(h1 === fileTitle, `file page h1 "${h1}" != "${fileTitle}"`);
  return `listed under "${note.course.name}" / "Saved by chat or AI"; detail ${detail.headings} headings + ${detail.items} list items, no raw #; ${detail.sources.length} chips; opened ${href} ("${h1}")`;
}

async function s5(ctx) {
  const { page, db, baseUrl, state } = ctx;
  const note = state.note2;
  check(note, "needs the note from scenario 2");
  await goto(page, `${baseUrl}/notes`);
  const row = `div:has(> a[href='/notes/saved/${note.id}'])`;
  const button = `${row} button[aria-label="Delete ${note.title.replaceAll('"', '\\"')}"]`;
  // Clicking before hydration would post without the confirm; wait for React first.
  await waitForHydration(page, button);

  let message = "";
  page.once("dialog", (dialog) => {
    message = dialog.message();
    void dialog.dismiss().catch(() => {});
  });
  await page.click(button);
  await sleep(2000);
  check(message === `Delete "${note.title}"? This can't be undone.`, `confirm text was "${message}"`);
  check((await page.$(row)) !== null, "note left the list after Cancel");
  check(await savedNote(db, note.id), "note deleted from DB after Cancel");

  page.once("dialog", (dialog) => void dialog.accept().catch(() => {}));
  await page.click(button);
  await page.waitForFunction((sel) => document.querySelector(sel) === null, { timeout: 30_000 }, row);
  check((await savedNote(db, note.id)) === null, "note still in DB after confirm");
  return `Cancel kept it (UI + DB); confirm removed ${note.id} from list and DB`;
}

async function clientStop(ctx) {
  const { page, db, baseUrl } = ctx;
  const message = "what's in my notes on the columbian exchange";
  const since = await dbNow(db);
  await openChat(page, baseUrl);
  const held = [];
  const onRequest = (req) => {
    if (req.method() === "POST" && req.url().endsWith("/api/chat")) held.push(req);
    else void req.continue();
  };
  await page.setRequestInterception(true);
  page.on("request", onRequest);
  try {
    await fillUntilEnabled(page, COMPOSER, SEND, message);
    await page.click(SEND);
    await page.waitForSelector(STOP);
    check(held.length === 1, `held ${held.length} /api/chat requests`);
    await page.click(STOP);
    await page.waitForFunction(
      (send, stop) => document.querySelector(send) !== null && document.querySelector(stop) === null,
      {},
      SEND,
      STOP,
    );
    const reply = await lastAssistant(page);
    check(reply.text.includes("You stopped this reply."), `no stop notice; got "${reply.text}"`);
  } finally {
    page.off("request", onRequest);
    for (const req of held) await req.abort().catch(() => {});
    await page.setRequestInterception(false);
  }
  await fillUntilEnabled(page, COMPOSER, SEND, "still works");
  const sessions = await trackSessionsByTitle(db, ctx.tracker, { studentId: DEMO_ID, titles: [message], since });
  check(sessions.length === 0, "the held request reached the server");
  return `"You stopped this reply." shown, Send back and enabled`;
}

/**
 * Server-side stop, made deterministic with a table lock: the request reaches the server and
 * creates its session, then blocks on the user-message insert. The client disconnects while it
 * is blocked; after the lock is released the server must finish without a reply or a note.
 */
async function serverStop(ctx) {
  const { page, db, baseUrl, dbUrl, tracker } = ctx;
  const message = TOPIC; // a finished reply would cite notes and save a note
  const since = await dbNow(db);
  const lock = await connectDb(dbUrl);
  let status;
  try {
    await lock.query("begin");
    await lock.query("set local lock_timeout = '5s'");
    await lock.query("lock table public.chat_messages in share mode");
    const controller = new AbortController();
    const request = fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson",
        cookie: await cookieHeader(page),
      },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    }).then(
      (res) => `HTTP ${res.status}`,
      (err) => err.name,
    );
    const deadline = Date.now() + 30_000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const { rows } = await db.query(
        "select count(*) as n from pg_locks where relation = 'public.chat_messages'::regclass and not granted",
      );
      waiting = Number(rows[0].n);
      if (waiting > 0) break;
      await sleep(100);
    }
    check(waiting > 0, "request never blocked on the chat_messages insert");
    controller.abort();
    status = await request;
    await sleep(1500); // let the server see the disconnect before the insert goes through
  } finally {
    await lock.query("commit").catch(() => {});
    await lock.end();
  }
  await sleep(4000); // the server finishes produce() after the lock is released
  const sessions = await trackSessionsByTitle(db, tracker, { studentId: DEMO_ID, titles: [message], since });
  check(sessions.length === 1, `expected 1 new session, found ${sessions.length}`);
  const { rows: messages } = await db.query(
    "select role from chat_messages where session_id = $1 order by created_at",
    [sessions[0]],
  );
  const { rows: notes } = await db.query("select id from saved_notes where session_id = $1", [sessions[0]]);
  for (const n of notes) tracker.notes.add(n.id);
  const roles = messages.map((m) => m.role).join(",");
  check(roles === "user", `session messages were [${roles}], expected [user]`);
  check(notes.length === 0, `${notes.length} saved note(s) for the stopped session`);
  return `client fetch ended with ${status}; session ${sessions[0]} has [${roles}], 0 saved notes`;
}

async function s6(ctx) {
  const a = await clientStop(ctx);
  const b = await serverStop(ctx);
  return `client: ${a} | server: ${b}`;
}

async function s7(ctx) {
  const { page, db, baseUrl, tracker } = ctx;
  const message = "What's due this week?";
  const since = await dbNow(db);
  await openChat(page, baseUrl);
  await hydrateChat(page);
  await clickSuggestion(page, message);
  const reply = await waitForReply(page, 0);
  check(!reply.error, `reply error: ${reply.error}`);
  check(reply.text.trim().length > 0, "empty reply");
  check(!reply.hasCard, "questions card for a deadlines question");
  check(reply.savedHref === null, "a deadlines answer was saved to Notes");
  const sessions = await trackSessionsByTitle(db, tracker, { studentId: DEMO_ID, titles: [message], since });
  check(sessions.length >= 1, "no session recorded");
  const { rows } = await db.query("select count(*) as n from saved_notes where session_id = any($1::uuid[])", [sessions]);
  check(Number(rows[0].n) === 0, `${rows[0].n} saved notes for the deadlines session`);
  return `"${reply.text.trim().slice(0, 80)}"; no saved chip, 0 saved_notes rows`;
}

async function smsSend(page, text, matcher, timeout = 60_000) {
  await fillUntilEnabled(page, "input[aria-label='Message']", "form button[aria-label='Send']", text);
  const before = await page.$$eval("ol[aria-label='Messages'] li", (els) => els.length);
  await page.click("form button[aria-label='Send']");
  await page.waitForFunction(
    (n, source) => {
      const items = [...document.querySelectorAll("ol[aria-label='Messages'] li")];
      return items.length >= n + 2 && new RegExp(source).test(items[items.length - 1].innerText);
    },
    { timeout },
    before,
    matcher.source,
  );
  return page.$$eval("ol[aria-label='Messages'] li", (els) => {
    const last = els[els.length - 1];
    return { text: last.innerText, links: [...last.querySelectorAll("a")].map((a) => a.getAttribute("href")) };
  });
}

async function s8(ctx) {
  const { page, db, baseUrl, tracker } = ctx;
  const { rows: profile } = await db.query("select phone from profiles where id = $1", [DEMO_ID]);
  const phone = profile[0]?.phone;
  check(phone, "demo student has no linked phone");
  const since = await dbNow(db);
  try {
    await goto(page, `${baseUrl}/sms-sim`);
    const from = await page.$eval("#sim-from", (el) => el.value);
    check(from === phone, `sim number ${from} != linked phone ${phone}`);

    const ask = await smsSend(page, VAGUE, /^Which class\?/);
    check(!ask.text.includes("\n") && !/[#*]/.test(ask.text), `not plain text: ${JSON.stringify(ask.text)}`);
    check((await page.$(CARD)) === null && (await page.$("fieldset")) === null, "a questions card on the SMS page");
    const courses = (await demoCourses(db)).map((c) => c.name);
    for (const name of courses) check(ask.text.includes(name), `"${ask.text}" does not list ${name}`);

    const cited = await smsSend(page, TOPIC, /\/open\//);
    const link = cited.links.find((href) => href.startsWith(`${baseUrl}/open/`));
    check(link, `no magic link in "${cited.text}"`);
    return `"${ask.text}" (no card); cited reply carries ${baseUrl}/open/<token>`;
  } finally {
    // Rows this scenario created: the four texts, the magic link and the two sim receipts.
    const { rows: sms } = await db.query(
      `select id from sms_messages where student_id = $1 and phone = $2 and created_at >= $3
          and (body = any($4::text[]) or (direction = 'outbound' and (body like 'Which class?%' or body like '%/open/%')))`,
      [DEMO_ID, phone, since, [VAGUE, TOPIC]],
    );
    for (const r of sms) tracker.smsMessages.add(r.id);
    const { rows: links } = await db.query("select id from magic_links where student_id = $1 and created_at >= $2", [DEMO_ID, since]);
    for (const r of links) tracker.magicLinks.add(r.id);
    const { rows: receipts } = await db.query(
      "select dedupe_key from sms_inbound_receipts where dedupe_key like 'sendblue:sim-%' and created_at >= $1",
      [since],
    );
    for (const r of receipts) tracker.receipts.add(r.dedupe_key);
  }
}

function runRlsTest() {
  const env = { ...process.env };
  delete env.PLUTO_SKIP_DB_TESTS;
  env.NO_COLOR = "1";
  const core = join(ROOT, "packages", "core");
  const vitest = join(dirname(createRequire(join(core, "package.json")).resolve("vitest/package.json")), "vitest.mjs");
  const result = spawnSync(process.execPath, [vitest, "run", "test/db/rls.test.ts"], { cwd: core, env, encoding: "utf8" });
  const out = `${result.stdout}\n${result.stderr}`;
  const tests = /Tests\s+(.+)/.exec(out)?.[1]?.trim() ?? "no summary";
  return { ok: result.status === 0 && /\d+ passed/.test(tests) && !/skipped/.test(tests), tests };
}

async function s9(ctx) {
  const { db, baseUrl, browser, state, tracker, env } = ctx;
  const note = state.note1;
  check(note, "needs the note from scenario 1");
  const context = await browser.createBrowserContext();
  try {
    const page = await newPage(context);
    ctx.otherPage = page;
    await signIn(page, baseUrl, env.OTHER_STUDENT_EMAIL, env.OTHER_STUDENT_PASSWORD);
    await goto(page, `${baseUrl}/notes/saved/${note.id}`);
    const body = await page.$eval("body", (el) => el.innerText);
    check(/could not be found/i.test(body), "other student's view is not a not-found page");
    check(!body.includes(note.title), "other student sees the note title");

    // A note of their own gives the other student a real delete form; point it at the first student's note.
    const { rows } = await db.query(
      "insert into saved_notes (student_id, title, body) values ($1, $2, $3) returning id",
      [OTHER_ID, "e2e probe note", "Probe row created by scripts/e2e; deleted at the end of the run."],
    );
    const probe = rows[0].id;
    tracker.notes.add(probe);
    await goto(page, `${baseUrl}/notes`);
    const submit = `form:has(input[name=noteId][value='${probe}']) button[type=submit]`;
    await waitForHydration(page, submit);
    const button = await page.$(submit);
    // Setting a hidden input's value also changes its attribute, so keep the handle, not the selector.
    await button.evaluate((el, id) => (el.form.elements.namedItem("noteId").value = id), note.id);
    page.once("dialog", (dialog) => void dialog.accept().catch(() => {}));
    const action = page.waitForResponse((r) => r.request().method() === "POST" && "next-action" in r.request().headers());
    action.catch(() => {});
    await button.click();
    const res = await action;
    await sleep(1000);
    check(await savedNote(db, note.id), "the other student deleted the first student's note");
    check(await savedNote(db, probe), "the probe note was deleted instead");

    const rls = runRlsTest();
    check(rls.ok, `rls.test.ts: ${rls.tests}`);
    return `other@ gets not-found on /notes/saved/${note.id}; delete action (HTTP ${res.status()}) left it in DB; rls.test.ts: ${rls.tests}`;
  } finally {
    await context.close().catch(() => {});
    ctx.otherPage = undefined;
  }
}

export const MOCK_SCENARIOS = [
  { id: 1, name: "vague request -> questions card -> saved note", run: s1 },
  { id: 2, name: "study guide suggestion chip", run: s2 },
  { id: 3, name: "topic request answers directly", run: s3 },
  { id: 4, name: "/notes list + detail page + source chip", run: s4 },
  { id: 5, name: "delete: cancel keeps, confirm removes", run: s5 },
  { id: 6, name: "stop: client and server side", run: s6 },
  { id: 7, name: "non-notes question saves nothing", run: s7 },
  { id: 8, name: "SMS: plain-text class question, magic link", run: s8 },
  { id: 9, name: "other student cannot see or delete", run: s9 },
];
