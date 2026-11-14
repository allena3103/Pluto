import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEncryptedCanvasToken } from "@pluto/canvas/token-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DELETE, GET, POST } from "@/app/api/canvas/token/route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "canvas-token-DO-NOT-LEAK";
const GOOD_KEY = Buffer.alloc(32, 7).toString("base64");
const BAD_KEY = "canvas-key-DO-NOT-LEAK";
const FAKE_SERVICE_ROLE_KEY = "service-role-DO-NOT-LEAK";

const originalKey = process.env.CANVAS_TOKEN_KEY;

type ProfileUpdate = {
  canvas_token_encrypted: string | null;
  canvas_base_url: string | null;
};

function mockSession(user: { id: string } | null) {
  const maybeSingle = vi.fn();
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from,
  };
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  return { from, select, eq, maybeSingle };
}

function mockAdmin(error: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  vi.mocked(createAdminClient).mockReturnValue({ from } as unknown as ReturnType<typeof createAdminClient>);
  return { from, update, eq };
}

function post(body: unknown): Request {
  return new Request("https://pluto.test/api/canvas/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(baseUrl = "https://umamherst.instructure.com", extra: Record<string, unknown> = {}) {
  return { token: TOKEN, baseUrl, ...extra };
}

async function responseText(response: Response): Promise<string> {
  return response.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CANVAS_TOKEN_KEY = GOOD_KEY;
});

afterEach(() => {
  if (originalKey === undefined) {
    delete process.env.CANVAS_TOKEN_KEY;
    return;
  }
  process.env.CANVAS_TOKEN_KEY = originalKey;
});

describe("POST /api/canvas/token", () => {
  it("returns 401 when signed out, before reading the body", async () => {
    mockSession(null);
    const admin = mockAdmin();

    const response = await POST(
      new Request("https://pluto.test/api/canvas/token", {
        method: "POST",
        body: "not-json",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(admin.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a base URL that is not an https instructure.com host without a port", async () => {
    const badBaseUrls = [
      "http://umamherst.instructure.com",
      "https://evil.com",
      "https://instructure.com",
      "https://not-instructure.com",
      "https://umamherst.instructure.com.evil.com",
      "https://a.b.instructure.com",
      "https://umamherst.instructure.com:8443",
      "https://umamherst.instructure.com/path",
      "https://umamherst.instructure.com?x=1",
      `https://umamherst.instructure.com?token=${TOKEN}`,
      "https://user:pass@umamherst.instructure.com",
    ];

    for (const baseUrl of badBaseUrls) {
      const session = mockSession({ id: USER_ID });
      mockAdmin();

      const response = await POST(post(validBody(baseUrl)));
      const text = await responseText(response);

      expect(response.status, baseUrl).toBe(400);
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(GOOD_KEY);
      expect(createAdminClient).not.toHaveBeenCalled();
      expect(session.from).not.toHaveBeenCalled();
      vi.clearAllMocks();
    }
  });

  it("writes the encrypted token for the session user only", async () => {
    const session = mockSession({ id: USER_ID });
    const admin = mockAdmin();

    const response = await POST(
      post(validBody("https://UMAMHERST.INSTRUCTURE.COM/", { id: OTHER_ID })),
    );
    const text = await responseText(response);

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      connected: true,
      baseUrl: "https://umamherst.instructure.com",
    });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toMatch(/v1\./);
    expect(session.from).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.update).toHaveBeenCalledTimes(1);
    expect(admin.eq).toHaveBeenCalledTimes(1);
    expect(admin.eq).toHaveBeenCalledWith("id", USER_ID);

    const values = admin.update.mock.calls[0]?.[0] as ProfileUpdate | undefined;
    expect(values?.canvas_base_url).toBe("https://umamherst.instructure.com");
    expect(values?.canvas_token_encrypted).toBeTruthy();
    expect(values?.canvas_token_encrypted).not.toContain(TOKEN);
    expect(isEncryptedCanvasToken(values?.canvas_token_encrypted ?? "")).toBe(true);
  });

  it("accepts the default https port and a trailing-dot host", async () => {
    mockSession({ id: USER_ID });
    const admin = mockAdmin();

    const response = await POST(post(validBody("https://canvas.instructure.com.:443")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: true,
      baseUrl: "https://canvas.instructure.com",
    });
    expect(admin.eq).toHaveBeenCalledWith("id", USER_ID);
  });

  it("returns a generic 500 when CANVAS_TOKEN_KEY is missing", async () => {
    mockSession({ id: USER_ID });
    mockAdmin();
    delete process.env.CANVAS_TOKEN_KEY;

    const response = await POST(post(validBody()));
    const text = await responseText(response);

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(JSON.parse(text)).toEqual({ error: "Failed to save Canvas connection" });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("CANVAS_TOKEN_KEY");
    expect(text).not.toContain("Error");
    expect(text).not.toContain("at ");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when CANVAS_TOKEN_KEY is invalid", async () => {
    mockSession({ id: USER_ID });
    mockAdmin();
    process.env.CANVAS_TOKEN_KEY = BAD_KEY;

    const response = await POST(post(validBody()));
    const text = await responseText(response);

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "Failed to save Canvas connection" });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(BAD_KEY);
    expect(text).not.toContain("CANVAS_TOKEN_KEY");
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("hides service-role and database failures", async () => {
    mockSession({ id: USER_ID });
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error(`Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY ${FAKE_SERVICE_ROLE_KEY}`);
    });

    const thrown = await POST(post(validBody()));
    const thrownText = await responseText(thrown);
    expect(thrown.status).toBe(500);
    expect(JSON.parse(thrownText)).toEqual({ error: "Failed to save Canvas connection" });
    expect(thrownText).not.toContain(FAKE_SERVICE_ROLE_KEY);
    expect(thrownText).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(thrownText).not.toContain(TOKEN);

    const admin = mockAdmin({ message: `permission denied for table profiles ${TOKEN}` });
    const denied = await POST(post(validBody()));
    const deniedText = await responseText(denied);
    expect(denied.status).toBe(500);
    expect(JSON.parse(deniedText)).toEqual({ error: "Failed to save Canvas connection" });
    expect(deniedText).not.toContain(TOKEN);
    expect(deniedText).not.toContain("permission denied");
    expect(admin.eq).toHaveBeenCalledWith("id", USER_ID);
  });
});

describe("DELETE /api/canvas/token", () => {
  it("returns 401 when signed out", async () => {
    mockSession(null);
    mockAdmin();

    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("clears token columns for the session user only", async () => {
    const session = mockSession({ id: USER_ID });
    const admin = mockAdmin();
    delete process.env.CANVAS_TOKEN_KEY;

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ connected: false, baseUrl: null });
    expect(session.from).not.toHaveBeenCalled();
    expect(admin.from).toHaveBeenCalledWith("profiles");
    expect(admin.update).toHaveBeenCalledWith({
      canvas_token_encrypted: null,
      canvas_base_url: null,
    });
    expect(admin.eq).toHaveBeenCalledTimes(1);
    expect(admin.eq).toHaveBeenCalledWith("id", USER_ID);
  });
});

describe("GET /api/canvas/token", () => {
  it("returns connection state without the ciphertext", async () => {
    const ciphertext = "v1.iv.tag.ciphertext-DO-NOT-LEAK";
    const session = mockSession({ id: USER_ID });
    session.maybeSingle.mockResolvedValue({
      data: {
        canvas_token_encrypted: ciphertext,
        canvas_base_url: "https://umamherst.instructure.com",
      },
      error: null,
    });

    const response = await GET();
    const text = await responseText(response);

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({
      connected: true,
      baseUrl: "https://umamherst.instructure.com",
    });
    expect(text).not.toContain(ciphertext);
    expect(text).not.toContain("ciphertext-DO-NOT-LEAK");
    expect(session.from).toHaveBeenCalledWith("profiles");
    expect(session.eq).toHaveBeenCalledWith("id", USER_ID);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
