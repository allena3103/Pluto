import type { PlutoDb } from "@pluto/core/context";
import { MagicLinkResponse } from "@pluto/core/contract";
import { describe, expect, it, vi } from "vitest";
import { handleMagicLink, type MagicLinkDeps } from "../app/api/magic-link/handler";
import type { FilePageCheck, MagicLinkCreator } from "../lib/sms-magic-link";

const SECRET = "test-internal-secret";
const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const FILE = "22222222-2222-4222-8222-222222222222";
const admin = {} as PlutoDb;

function req(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-internal-secret"] = secret;
  return new Request("http://localhost/api/magic-link", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(over: Partial<MagicLinkDeps> = {}) {
  const createAdmin = vi.fn(() => admin);
  // The file belongs to STUDENT and has 5 pages.
  const check = vi.fn<FilePageCheck>(async (_db, i) => i.studentId === STUDENT && i.fileId === FILE && i.page <= 5);
  const create = vi.fn<MagicLinkCreator>(async (_db, i) => ({
    url: `${i.appUrl}/open/tok123`,
    token: "tok123",
    expiresAt: "2026-11-14T12:15:00.000Z",
  }));
  const d: MagicLinkDeps = { expectedSecret: SECRET, appUrl: "http://localhost:3105", createAdmin, check, create, ...over };
  return { d, createAdmin, check, create };
}

const valid = { studentId: STUDENT, fileId: FILE, page: 2 };

describe("POST /api/magic-link", () => {
  it("401 without a secret and makes no DB call", async () => {
    const { d, createAdmin, check, create } = deps();
    const res = await handleMagicLink(req(valid), d);
    expect(res.status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("401 with a wrong secret and makes no DB call", async () => {
    const { d, createAdmin } = deps();
    expect((await handleMagicLink(req(valid, "nope"), d)).status).toBe(401);
    expect((await handleMagicLink(req(valid, `${SECRET}x`), d)).status).toBe(401);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("500 when the server secret is not configured", async () => {
    const { d, createAdmin } = deps({ expectedSecret: undefined });
    expect((await handleMagicLink(req(valid, SECRET), d)).status).toBe(500);
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("400 on a bad body", async () => {
    const { d, createAdmin } = deps();
    for (const body of ["not json", {}, { ...valid, page: 0 }, { ...valid, page: 1.5 }, { ...valid, fileId: "x" }]) {
      expect((await handleMagicLink(req(body, SECRET), d)).status).toBe(400);
    }
    expect(createAdmin).not.toHaveBeenCalled();
  });

  it("404 for another student's file, same body as no such file, and mints nothing", async () => {
    const { d, create } = deps();
    const other = await handleMagicLink(req({ ...valid, studentId: OTHER }, SECRET), d);
    const missing = await handleMagicLink(req({ ...valid, fileId: OTHER }, SECRET), d);
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.text()).toBe(await missing.text());
    expect(create).not.toHaveBeenCalled();
  });

  it("404 for a page past page_count", async () => {
    const { d, create } = deps();
    expect((await handleMagicLink(req({ ...valid, page: 6 }, SECRET), d)).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("200 with an /open/ URL that parses as the contract response", async () => {
    const { d, create } = deps();
    const res = await handleMagicLink(req(valid, SECRET), d);
    expect(res.status).toBe(200);
    const body = MagicLinkResponse.parse(await res.json());
    expect(body.url).toMatch(/^http:\/\/localhost:3105\/open\/[^/]+$/);
    expect(create).toHaveBeenCalledWith(admin, { ...valid, appUrl: "http://localhost:3105" });
  });

  it("500 without leaking details when creation throws", async () => {
    const { d } = deps({
      create: vi.fn<MagicLinkCreator>(async () => {
        throw new Error("db exploded");
      }),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleMagicLink(req(valid, SECRET), d);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("db exploded");
  });
});
