import { describe, expect, test } from "vitest";
import {
  bearerChallenge,
  buildProtectedResourceMetadata,
  protectedResourceMetadataResponse,
  protectedResourceOptionsResponse,
  resourceMetadataUrl,
  supabaseIssuer,
} from "../src/metadata";

describe("protected resource metadata", () => {
  test("exact resource and authorization server, with no trailing slashes", () => {
    for (const [appUrl, supabaseUrl] of [
      ["https://pluto.example", "https://abc.supabase.co"],
      ["https://pluto.example/", "https://abc.supabase.co/"],
      ["https://pluto.example//", "https://abc.supabase.co//"],
    ] as const) {
      expect(buildProtectedResourceMetadata({ appUrl, supabaseUrl })).toEqual({
        resource: "https://pluto.example/api/mcp",
        authorization_servers: ["https://abc.supabase.co/auth/v1"],
        bearer_methods_supported: ["header"],
        resource_name: "Pluto",
      });
    }
    expect(supabaseIssuer("http://127.0.0.1:54321/")).toBe("http://127.0.0.1:54321/auth/v1");
    expect(resourceMetadataUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/.well-known/oauth-protected-resource",
    );
  });

  test("401 challenge names the metadata URL and flags rejected tokens", () => {
    expect(bearerChallenge("https://pluto.example/", false)).toBe(
      'Bearer resource_metadata="https://pluto.example/.well-known/oauth-protected-resource"',
    );
    expect(bearerChallenge("https://pluto.example", true)).toBe(
      'Bearer error="invalid_token", resource_metadata="https://pluto.example/.well-known/oauth-protected-resource"',
    );
  });

  test("response is no-store JSON with open CORS, and 500 without env", async () => {
    const ok = protectedResourceMetadataResponse({
      appUrl: "https://pluto.example",
      supabaseUrl: "https://abc.supabase.co",
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    await expect(ok.json()).resolves.toMatchObject({ resource: "https://pluto.example/api/mcp" });

    const missing = protectedResourceMetadataResponse({ appUrl: undefined, supabaseUrl: "https://abc.supabase.co" });
    expect(missing.status).toBe(500);
    await expect(missing.json()).resolves.toEqual({ error: "server_error" });

    const preflight = protectedResourceOptionsResponse();
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });
});
