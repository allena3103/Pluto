import { describe, expect, it } from "vitest";
import { createCanvasClient } from "../../src/client";
import type { CanvasClient } from "../../src/client";

const BASE_URL = "https://canvas.local";
const COURSE_ID = "100/assignments?x=1";

function clientRecording(urls: string[]): CanvasClient {
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response("[]", { status: 200 });
  };
  return createCanvasClient({
    baseUrl: BASE_URL,
    token: "canvas-token-DO-NOT-LEAK",
    mode: "live",
    fetch: fetchImpl,
  });
}

describe("canvas course id path encoding", () => {
  it("encodes course ids in assignment group, assignment, file, and module paths", async () => {
    const encoded = encodeURIComponent(COURSE_ID);
    const cases: Array<{ resource: string; run: (client: CanvasClient) => Promise<unknown> }> = [
      { resource: "assignment_groups", run: (client) => client.listAssignmentGroups(COURSE_ID) },
      { resource: "assignments", run: (client) => client.listAssignments(COURSE_ID) },
      { resource: "files", run: (client) => client.listCourseFiles(COURSE_ID) },
      { resource: "modules", run: (client) => client.listModuleItems(COURSE_ID) },
    ];

    for (const { resource, run } of cases) {
      const urls: string[] = [];
      await run(clientRecording(urls));
      expect(urls).toHaveLength(1);
      const url = new URL(urls[0] ?? "");
      expect(url.origin).toBe(BASE_URL);
      expect(url.pathname).toBe(`/api/v1/courses/${encoded}/${resource}`);
      expect(url.pathname.split("/").filter(Boolean)).toEqual([
        "api",
        "v1",
        "courses",
        encoded,
        resource,
      ]);
      expect(url.searchParams.has("x")).toBe(false);
      expect(urls[0]?.includes("/courses/100/")).toBe(false);
    }
  });
});
