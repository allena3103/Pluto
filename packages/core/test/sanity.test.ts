import { expect, test } from "vitest";
import { PLUTO_CORE } from "../src/index";

test("core package loads", () => {
  expect(PLUTO_CORE).toBe("pluto-core");
});
