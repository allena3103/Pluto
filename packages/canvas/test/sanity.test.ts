import { describe, expect, it } from "vitest";
import { PLUTO_CANVAS } from "../src/index";

describe("@pluto/canvas", () => {
  it("loads", () => {
    expect(PLUTO_CANVAS).toBe("pluto-canvas");
  });
});
