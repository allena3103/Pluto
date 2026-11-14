import type { PlutoDb } from "@pluto/core/context";
import type { ConsumedMagicLink } from "@pluto/core/magic-links";
import { describe, expect, it, vi } from "vitest";
import { handleOpen, type OpenDeps } from "../app/open/[token]/handler";

const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const FILE = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(43);
const INVALID = "/login?error=link";

type Row = { studentId: string; fileId: string; page: number; expiresAt: Date; usedAt: Date | null };

/**
 * Fake store with the same semantics as core `consumeMagicLink`: returns the row
 * only if unused and unexpired, and marks it used in the same step.
 */
function store(rows: Record<string, Row>) {
  return vi.fn(async (_admin: PlutoDb, token: string): Promise<ConsumedMagicLink | null> => {
    const row = rows[token];
    const now = new Date();
    if (!row || row.usedAt || row.expiresAt <= now) return null;
    row.usedAt = now;
    return { studentId: row.studentId, fileId: row.fileId, page: row.page, redirectPath: "" };
  });
}

function fakes(opts: { sessionUser?: string; email?: string | null } = {}) {
  const generateLink = vi.fn(async () => ({
    data: { properties: { hashed_token: "hashed" }, user: { id: STUDENT } },
    error: null,
  }));
  const getUserById = vi.fn(async (id: string) => ({
    data: { user: opts.email === null ? null : { id, email: opts.email ?? "student@example.test" } },
    error: null,
  }));
  const admin = { auth: { admin: { getUserById, generateLink } } } as unknown as PlutoDb;
  const verifyOtp = vi.fn(async (params: { type: string; token_hash: string }) => {
    void params;
    const id = opts.sessionUser ?? STUDENT;
    return { data: { user: { id }, session: { user: { id } } }, error: null };
  });
  const signOut = vi.fn(async () => ({ error: null }));
  const session = { auth: { verifyOtp, signOut } } as unknown as PlutoDb;
  const createAdmin = vi.fn(() => admin);
  const createSession = vi.fn(async () => session);
  return { createAdmin, createSession, verifyOtp, signOut, generateLink, getUserById };
}

function deps(f: ReturnType<typeof fakes>, consume: OpenDeps["consume"]): OpenDeps {
  return { createAdmin: f.createAdmin, createSession: f.createSession, consume };
}

function freshRow(over: Partial<Row> = {}): Row {
  return { studentId: STUDENT, fileId: FILE, page: 3, expiresAt: new Date(Date.now() + 15 * 60_000), usedAt: null, ...over };
}

describe("GET /open/[token]", () => {
  it("signs in and redirects to the exact notes page, uncached", async () => {
    const f = fakes();
    const res = await handleOpen(TOKEN, deps(f, store({ [TOKEN]: freshRow() })));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/notes/${FILE}?page=3`);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(f.getUserById).toHaveBeenCalledWith(STUDENT);
    expect(f.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hashed" });
  });

  it("a token used twice signs in once", async () => {
    const f = fakes();
    const consume = store({ [TOKEN]: freshRow() });
    const first = await handleOpen(TOKEN, deps(f, consume));
    const second = await handleOpen(TOKEN, deps(f, consume));
    expect(first.headers.get("location")).toBe(`/notes/${FILE}?page=3`);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toBe(INVALID);
    expect(f.generateLink).toHaveBeenCalledTimes(1);
    expect(f.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("an expired token goes to /login?error=link and signs no one in", async () => {
    const f = fakes();
    const res = await handleOpen(TOKEN, deps(f, store({ [TOKEN]: freshRow({ expiresAt: new Date(Date.now() - 1000) }) })));
    expect(res.headers.get("location")).toBe(INVALID);
    expect(f.verifyOtp).not.toHaveBeenCalled();
  });

  it("garbage tokens go to /login?error=link", async () => {
    for (const bad of ["nope", "", "x".repeat(600), "../etc", undefined, 42]) {
      const f = fakes();
      const res = await handleOpen(bad, deps(f, store({})));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(INVALID);
      expect(f.verifyOtp).not.toHaveBeenCalled();
    }
  });

  it("over-long and empty tokens never reach the database", async () => {
    const f = fakes();
    const consume = store({});
    await handleOpen("x".repeat(600), deps(f, consume));
    await handleOpen("", deps(f, consume));
    expect(f.createAdmin).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("fails and signs out if the session is not the token's student", async () => {
    const f = fakes({ sessionUser: OTHER });
    const res = await handleOpen(TOKEN, deps(f, store({ [TOKEN]: freshRow() })));
    expect(res.headers.get("location")).toBe(INVALID);
    expect(f.signOut).toHaveBeenCalled();
  });

  it("fails when the student has no email", async () => {
    const f = fakes({ email: null });
    const res = await handleOpen(TOKEN, deps(f, store({ [TOKEN]: freshRow() })));
    expect(res.headers.get("location")).toBe(INVALID);
    expect(f.generateLink).not.toHaveBeenCalled();
  });

  it("fails generically and does not log the token when the DB throws", async () => {
    const f = fakes();
    const consume = vi.fn(async (): Promise<ConsumedMagicLink | null> => {
      throw new Error(`boom ${TOKEN}`);
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleOpen(TOKEN, deps(f, consume));
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(res.headers.get("location")).toBe(INVALID);
    expect(logged).not.toContain(TOKEN);
  });
});
