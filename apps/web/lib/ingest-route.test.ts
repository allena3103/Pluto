// POST /api/ingest gate: the secret is checked before the service-role client is created
// and before any ingest work. No database: the admin client and ingestFile are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAdminClient = vi.fn(() => ({ fake: "admin" }));
const ingestFile = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@pluto/core/ingest", () => ({ ingestFile }));

const { POST } = await import("../app/api/ingest/route");

const SECRET = "test-internal-secret";
const FILE_ID = "3f2c1b7e-8a4d-4c1e-9b0a-5d6e7f8a9b0c";

function request(headers: Record<string, string>, body: string = JSON.stringify({ fileId: FILE_ID })): Request {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("POST /api/ingest", () => {
  beforeEach(() => {
    vi.stubEnv("INTERNAL_API_SECRET", SECRET);
    createAdminClient.mockClear();
    ingestFile.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const untouched = () => {
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(ingestFile).not.toHaveBeenCalled();
  };

  it("returns 500 and does nothing when INTERNAL_API_SECRET is unset, even with a header", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    const res = await POST(request({ "x-internal-secret": "" }));
    expect(res.status).toBe(500);
    const res2 = await POST(request({ "x-internal-secret": "anything" }));
    expect(res2.status).toBe(500);
    untouched();
  });

  it("returns 401 without the header", async () => {
    const res = await POST(request({}));
    expect(res.status).toBe(401);
    untouched();
  });

  it("returns 401 with a wrong secret, including a prefix of the real one", async () => {
    expect((await POST(request({ "x-internal-secret": "wrong" }))).status).toBe(401);
    expect((await POST(request({ "x-internal-secret": SECRET.slice(0, -1) }))).status).toBe(401);
    expect((await POST(request({ "x-internal-secret": `${SECRET}x` }))).status).toBe(401);
    untouched();
  });

  it("returns 400 for a bad body without creating the admin client", async () => {
    expect((await POST(request({ "x-internal-secret": SECRET }, "not json"))).status).toBe(400);
    expect((await POST(request({ "x-internal-secret": SECRET }, JSON.stringify({ fileId: "nope" })))).status).toBe(400);
    untouched();
  });

  it("ingests with the admin client once the secret matches", async () => {
    ingestFile.mockResolvedValue({ fileId: FILE_ID, status: "ready", pageCount: 4 });
    const res = await POST(request({ "x-internal-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fileId: FILE_ID, status: "ready", pageCount: 4 });
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(ingestFile).toHaveBeenCalledWith({ fake: "admin" }, FILE_ID);
  });

  it("returns 404 for an unknown file and a generic 500 when ingest throws", async () => {
    ingestFile.mockResolvedValueOnce(null);
    expect((await POST(request({ "x-internal-secret": SECRET }))).status).toBe(404);
    ingestFile.mockRejectedValueOnce(new Error("relation secret_table does not exist"));
    const res = await POST(request({ "x-internal-secret": SECRET }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Ingest failed." });
  });
});
