import { afterEach, expect, it, vi } from "vitest";
import { logD1ReadCost } from "@/lib/db/read-metrics";
import { createDatabaseAccess } from "@/lib/db-access";
import { queryAll, type D1, type D1Statement } from "@/lib/db";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("logs only costly reads, without SQL or customer/supplier data", () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  logD1ReadCost("SELECT private_data FROM products p WHERE token='secret'", { rows_read: 1200, rows_written: 0 });
  expect(log).toHaveBeenCalledWith("[d1-read]", JSON.stringify({ scope: "market_catalog", rows_read: 1200, rows_written: 0 }));
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private_data|SELECT/);
  logD1ReadCost("SELECT small", { rows_read: 999 });
  logD1ReadCost("SELECT no_meta");
  expect(log).toHaveBeenCalledTimes(1);
});

it("captures metadata in both read APIs, while preserving results and query count", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const all = vi.fn(async () => ({ results: [{ value: "private result" }], meta: { rows_read: 2000 } }));
  const statement: D1Statement = { bind: () => statement, first: async () => null, all, run: async () => ({ meta: {} }) };
  const db: D1 = { prepare: () => statement, batch: async () => [] };
  vi.stubGlobal("DB", db);
  expect(await queryAll("SELECT value WHERE id=?", "secret bind")).toEqual([{ value: "private result" }]);
  expect(await createDatabaseAccess(db).queryAll("SELECT value WHERE id=?", "secret bind")).toEqual([{ value: "private result" }]);
  expect(all).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private result/);
});

it("a logging failure cannot fail a database read", () => {
  vi.spyOn(console, "info").mockImplementation(() => { throw new Error("log unavailable"); });
  expect(() => logD1ReadCost("SELECT expensive", { rows_read: 10000 })).not.toThrow();
});
