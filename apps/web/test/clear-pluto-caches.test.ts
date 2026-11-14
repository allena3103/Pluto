import { describe, expect, test } from "vitest";
import { CLEAR_CACHES_TYPE, clearPlutoCaches } from "../lib/clear-pluto-caches";

describe("clearPlutoCaches", () => {
  test("deletes every Pluto cache and tells the service worker to clear", async () => {
    const deleted: string[] = [];
    const messages: { type: string }[] = [];

    await clearPlutoCaches({
      caches: {
        keys: async () => ["pluto-shell-v1", "other-app", "pluto-static-v2"],
        delete: async (name) => {
          deleted.push(name);
          return true;
        },
      },
      postMessage: (message) => {
        messages.push(message);
      },
    });

    expect(deleted).toEqual(["pluto-shell-v1", "pluto-static-v2"]);
    expect(messages).toEqual([{ type: CLEAR_CACHES_TYPE }]);
  });
});
