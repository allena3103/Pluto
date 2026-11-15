/* global document */
// Browser helpers: system Chrome via puppeteer-core, sign-in, and the chat page.
// Selectors and texts come from apps/web/components/chat/*, app/login/login-form.tsx and components/sms-sim/*.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";

export const SEND = "button[aria-label='Send message']";
export const STOP = "button[aria-label='Stop reply']";
export const COMPOSER = "#chat-composer";
export const CARD = "form:has(fieldset)";
export const CARD_SUBMIT = "form:has(fieldset) > button[type=submit]";
const MESSAGES = "[aria-label='Chat messages'] > div > div:not([aria-hidden])";

const DEFAULT_CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export const NAV_TIMEOUT = 180_000;

export async function launchBrowser() {
  const userDataDir = mkdtempSync(join(tmpdir(), "pluto-e2e-chrome-"));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || DEFAULT_CHROME,
    headless: true,
    userDataDir,
    defaultViewport: { width: 390, height: 844 },
    args: ["--no-first-run", "--no-default-browser-check", "--disable-extensions"],
  });
  return {
    browser,
    async close() {
      await browser.close().catch(() => {});
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

export async function newPage(context) {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  page.setDefaultTimeout(60_000);
  return page;
}

export async function goto(page, url) {
  const res = await page.goto(url, { waitUntil: "networkidle0" });
  return res;
}

export async function signIn(page, baseUrl, email, password) {
  await goto(page, `${baseUrl}/login`);
  await page.waitForSelector("#email");
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([
    page.waitForFunction(() => document.location.pathname !== "/login", { timeout: NAV_TIMEOUT }),
    page.click("form button[type=submit]"),
  ]);
}

/** Waits until React has hydrated the element (it then carries React's internal props key). */
export async function waitForHydration(page, selector, timeout = 60_000) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el !== null && Object.keys(el).some((key) => key.startsWith("__reactProps"));
    },
    { timeout },
    selector,
  );
}

/** Puts `text` in a React-controlled field, retrying until hydration makes `submit` enabled. */
export async function fillUntilEnabled(page, field, submit, text, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    await page.click(field);
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(field, text);
    await sleep(150);
    const enabled = await page.$eval(submit, (b) => !b.disabled).catch(() => false);
    if (enabled) return;
    await sleep(500);
  }
  throw new Error(`${submit} never enabled after typing (page not hydrated?)`);
}

export async function openChat(page, baseUrl) {
  await goto(page, `${baseUrl}/`);
  await page.waitForSelector(COMPOSER);
}

export async function messageCount(page) {
  return page.$$eval(MESSAGES, (els) => els.length).catch(() => 0);
}

/** Waits until the reply after `before` messages finished streaming (Stop gone, Send back). */
export async function waitForReply(page, before, timeout = 60_000) {
  await page.waitForFunction(
    (selector, n, send, stop) =>
      document.querySelectorAll(selector).length >= n + 2 &&
      document.querySelector(send) !== null &&
      document.querySelector(stop) === null,
    { timeout },
    MESSAGES,
    before,
    SEND,
    STOP,
  );
  return lastAssistant(page);
}

export async function sendChat(page, text, timeout) {
  await fillUntilEnabled(page, COMPOSER, SEND, text);
  const before = await messageCount(page);
  const started = Date.now();
  await page.click(SEND);
  const reply = await waitForReply(page, before, timeout);
  return { ...reply, ms: Date.now() - started };
}

/** Facts about the last message (the assistant reply). */
export async function lastAssistant(page) {
  return page.$$eval(MESSAGES, (els) => {
    const el = els[els.length - 1];
    if (!el) return null;
    const sources = [...el.querySelectorAll("ul[aria-label='Sources'] a")].map((a) => a.getAttribute("href"));
    const saved = el.querySelector("a[href^='/notes/saved/']");
    const alert = el.querySelector("[role=alert]");
    return {
      text: el.innerText,
      headings: [...el.querySelectorAll("h2, h3, h4")].map((h) => h.textContent.trim()),
      listItems: el.querySelectorAll("li").length - sources.length,
      sources,
      savedHref: saved ? saved.getAttribute("href") : null,
      savedText: saved ? saved.textContent.trim() : null,
      error: alert ? alert.textContent.trim() : null,
      hasCard: el.querySelector("form fieldset") !== null,
    };
  });
}

export async function chatText(page) {
  return page.$eval("[aria-label='Chat messages']", (el) => el.innerText).catch(() => "");
}

/** The questions card: each question's prompt and option labels. */
export async function readCard(page) {
  return page.$$eval(`${CARD} fieldset`, (sets) =>
    sets.map((set) => ({
      prompt: set.querySelector("legend")?.textContent.trim() ?? "",
      options: [...set.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent.trim()),
      hasText: set.querySelector("input[type=text]") !== null,
    })),
  );
}

export async function cardSubmitEnabled(page) {
  return page.$eval(CARD_SUBMIT, (b) => !b.disabled);
}

/** Taps `option` in question `index` of the card. */
export async function pickOption(page, index, option) {
  const sets = await page.$$(`${CARD} fieldset`);
  const buttons = await sets[index].$$("button[aria-pressed]");
  for (const button of buttons) {
    const label = await button.evaluate((b) => b.textContent.trim());
    if (label === option) {
      await button.click();
      await page.waitForFunction((b) => b.getAttribute("aria-pressed") === "true", {}, button);
      return;
    }
  }
  throw new Error(`option "${option}" not found in question ${index}`);
}

export async function typeAnswer(page, index, text) {
  const sets = await page.$$(`${CARD} fieldset`);
  const input = await sets[index].$("input[type=text]");
  if (!input) throw new Error(`question ${index} has no text field`);
  await input.type(text);
}

/** Submits the card and waits for the reply to the answers. */
export async function submitCard(page, timeout) {
  const before = await messageCount(page);
  const started = Date.now();
  await page.click(CARD_SUBMIT);
  const reply = await waitForReply(page, before, timeout);
  return { ...reply, ms: Date.now() - started };
}

/** `Cookie` header for Node `fetch` calls made as the signed-in browser user. */
export async function cookieHeader(page) {
  const cookies = await page.browserContext().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Records chat session and saved note ids from every /api/chat stream the page reads. */
export function trackChatResponses(page, tracker) {
  page.on("response", async (res) => {
    if (!res.url().endsWith("/api/chat") || res.request().method() !== "POST") return;
    let body;
    try {
      body = await res.text();
    } catch {
      return; // Aborted stream.
    }
    for (const line of body.split("\n")) {
      try {
        const event = JSON.parse(line);
        if (event.type === "done" && event.sessionId) tracker.sessions.add(event.sessionId);
        if (event.type === "saved_note" && event.noteId) tracker.notes.add(event.noteId);
      } catch {
        // Not a JSON line.
      }
    }
  });
}
