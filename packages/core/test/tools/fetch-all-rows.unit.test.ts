import { describe, expect, test } from "vitest";
import { fetchAllRows, type PagedQuery } from "../../src/tools/shared";
import { ToolError } from "../../src/tools/tool-error";

function fakeQuery(total: number, fail?: unknown): { query: PagedQuery<{ id: number }>; ranges: Array<[number, number]> } {
  const ranges: Array<[number, number]> = [];
  const query: PagedQuery<{ id: number }> = {
    order() {
      return query;
    },
    range(from, to) {
      ranges.push([from, to]);
      if (fail) return Promise.resolve({ data: null, error: fail });
      const data: Array<{ id: number }> = [];
      const end = Math.min(to, total - 1);
      for (let id = from; id <= end; id += 1) data.push({ id });
      return Promise.resolve({ data, error: null });
    },
  };
  return { query, ranges };
}

describe("fetchAllRows", () => {
  test("reads 2500 rows in three range calls", async () => {
    const { query, ranges } = fakeQuery(2500);
    const rows = await fetchAllRows(query);
    expect(rows).toHaveLength(2500);
    expect(rows[0]?.id).toBe(0);
    expect(rows[2499]?.id).toBe(2499);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("returns exactly 20000 rows and throws past that", async () => {
    const atCap = fakeQuery(20_000);
    await expect(fetchAllRows(atCap.query)).resolves.toHaveLength(20_000);

    const over = fakeQuery(20_001);
    await expect(fetchAllRows(over.query)).rejects.toBeInstanceOf(ToolError);
    await expect(fetchAllRows(over.query)).rejects.toMatchObject({ code: "db_error" });
  });

  test("hides database error details", async () => {
    const { query } = fakeQuery(0, { message: "secret row value" });
    await expect(fetchAllRows(query)).rejects.toMatchObject({
      code: "db_error",
      message: "Database query failed.",
    });
  });
});
