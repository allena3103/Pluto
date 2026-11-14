import { describe, expect, it, vi } from "vitest";
import { createCanvasClient } from "../../src/client";
import {
  DEMO_STUDENT_ID,
  INSTRUCTURE_HOST,
  normalizeCanvasBaseUrl,
  prepareLiveCanvasClient,
  type LiveCanvasDeps,
} from "../../src/host";
import type { CanvasClientOptions } from "../../src/types";
import { DEMO_STUDENT_ID as SEEDED_DEMO_STUDENT_ID } from "../../../../scripts/lib/seed-ids";

const NON_DEMO_STUDENT = "22222222-2222-4222-8222-222222222222";
const ENV_TOKEN = "env-canvas-token-DO-NOT-LEAK";
const PROFILE_TOKEN = "profile-canvas-token-1234567890";
const CIPHERTEXT = "v1:ciphertext";

/** Records every client the helper builds and every request those clients make. */
function harness() {
  const fetchSpy = vi.fn<typeof fetch>(async () => new Response("[]", { status: 200 }));
  const built: CanvasClientOptions[] = [];
  const decrypt = vi.fn((ciphertext: string) => {
    if (ciphertext !== CIPHERTEXT) throw new Error("bad ciphertext");
    return PROFILE_TOKEN;
  });
  const deps: LiveCanvasDeps = {
    decrypt,
    createClient: (options) => {
      built.push(options);
      return createCanvasClient({ ...options, fetch: fetchSpy });
    },
  };
  return { fetchSpy, built, decrypt, deps };
}

function builtWithEnvToken(built: CanvasClientOptions[]): boolean {
  return built.some((options) => options.token === ENV_TOKEN);
}

describe("prepareLiveCanvasClient", () => {
  it("never sends the env token to a profile URL when the profile has no token", async () => {
    const h = harness();
    for (const studentId of [DEMO_STUDENT_ID, NON_DEMO_STUDENT]) {
      const result = prepareLiveCanvasClient(
        {
          studentId,
          profileBaseUrl: "https://evil.example.com",
          profileTokenCiphertext: null,
          envToken: ENV_TOKEN,
          envBaseUrl: "https://umamherst.instructure.com",
        },
        h.deps,
      );
      if (result.ok) {
        // Demo student: env pair only; the profile URL is ignored.
        expect(result.baseUrl).toBe("https://umamherst.instructure.com");
        await result.client.listCourses();
      }
    }
    const hosts = h.fetchSpy.mock.calls.map(([input]) => new URL(String(input)).host);
    expect(hosts.every((host) => host === "umamherst.instructure.com")).toBe(true);
    expect(h.built.every((options) => options.baseUrl === "https://umamherst.instructure.com")).toBe(true);
  });

  it("makes no request and never uses the env token for evil.example.com with no profile token", () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: NON_DEMO_STUDENT,
        profileBaseUrl: "https://evil.example.com",
        profileTokenCiphertext: null,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://umamherst.instructure.com",
      },
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(h.built).toHaveLength(0);
    expect(h.fetchSpy).not.toHaveBeenCalled();
    expect(builtWithEnvToken(h.built)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(ENV_TOKEN);
  });

  it("rejects evil.example.com with a profile token before any fetch", () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: NON_DEMO_STUDENT,
        profileBaseUrl: "https://evil.example.com",
        profileTokenCiphertext: CIPHERTEXT,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://umamherst.instructure.com",
      },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(h.built).toHaveLength(0);
    expect(h.fetchSpy).not.toHaveBeenCalled();
    expect(h.decrypt).not.toHaveBeenCalled();
  });

  it.each([
    "http://umamherst.instructure.com",
    "https://umamherst.instructure.com:8443",
    "https://user:pw@umamherst.instructure.com",
    "https://umamherst.instructure.com/evil",
    "https://umamherst.instructure.com.evil.com",
    "https://a.b.instructure.com",
    "https://instructure.com",
    "",
  ])("rejects profile URL %s with a profile token before any fetch", (profileBaseUrl) => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: DEMO_STUDENT_ID,
        profileBaseUrl,
        profileTokenCiphertext: CIPHERTEXT,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://umamherst.instructure.com",
      },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(h.built).toHaveLength(0);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("builds the client with the profile URL and decrypted profile token", async () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: NON_DEMO_STUDENT,
        profileBaseUrl: "https://umamherst.instructure.com",
        profileTokenCiphertext: CIPHERTEXT,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://other.instructure.com",
      },
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(h.built).toEqual([{ baseUrl: "https://umamherst.instructure.com", token: PROFILE_TOKEN, mode: "live" }]);
    expect(h.decrypt).toHaveBeenCalledWith(CIPHERTEXT);

    if (!result.ok) throw new Error("expected ok");
    await result.client.listCourses();
    const [input, init] = h.fetchSpy.mock.calls[0]!;
    expect(new URL(String(input)).origin).toBe("https://umamherst.instructure.com");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${PROFILE_TOKEN}`);
  });

  it("errors with no fetch for a non-demo student with no profile token", () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: NON_DEMO_STUDENT,
        profileBaseUrl: null,
        profileTokenCiphertext: null,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://umamherst.instructure.com",
      },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/not connected/i);
    expect(h.built).toHaveLength(0);
    expect(h.fetchSpy).not.toHaveBeenCalled();
  });

  it("lets the demo student use the env pair only", () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: DEMO_STUDENT_ID,
        profileBaseUrl: "https://evil.example.com",
        profileTokenCiphertext: null,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://umamherst.instructure.com/",
      },
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(h.built).toEqual([{ baseUrl: "https://umamherst.instructure.com", token: ENV_TOKEN, mode: "live" }]);
  });

  it("refuses the demo env pair when the env base URL is not a Canvas host", () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: DEMO_STUDENT_ID,
        profileBaseUrl: null,
        profileTokenCiphertext: null,
        envToken: ENV_TOKEN,
        envBaseUrl: "https://evil.example.com",
      },
      h.deps,
    );
    expect(result.ok).toBe(false);
    expect(h.built).toHaveLength(0);
  });

  it("returns 400 when the stored token can't be decrypted", () => {
    const h = harness();
    const result = prepareLiveCanvasClient(
      {
        studentId: NON_DEMO_STUDENT,
        profileBaseUrl: "https://umamherst.instructure.com",
        profileTokenCiphertext: "v1:garbage",
        envToken: ENV_TOKEN,
        envBaseUrl: "https://umamherst.instructure.com",
      },
      h.deps,
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(h.built).toHaveLength(0);
  });
});

describe("canvas host rule", () => {
  it("matches the seeded demo student id", () => {
    expect(DEMO_STUDENT_ID).toBe(SEEDED_DEMO_STUDENT_ID);
  });

  it("normalizes a plain instructure host", () => {
    expect(normalizeCanvasBaseUrl("https://UMamherst.instructure.com/")).toBe("https://umamherst.instructure.com");
    expect(INSTRUCTURE_HOST.test("umamherst.instructure.com")).toBe(true);
    expect(INSTRUCTURE_HOST.test("instructure.com")).toBe(false);
  });
});
