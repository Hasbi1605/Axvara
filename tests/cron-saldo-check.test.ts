import { expect, it, vi } from "vitest";
import { supplierSaldoCheckDue } from "@/lib/cron/saldo-check";
import { createBudgetedDatabase } from "@/lib/db-access";
import { parseExpiry } from "@/lib/expiry";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/expiry", { spy: true });

it.each(["wr", "sk"] as const)("%s: latest api_check controls exactly one metered SELECT and the strict ten-minute cadence", async supplier => {
  const fx = createD1Fixture();
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-22T12:00:00Z"));
  try {
    const table = `${supplier}_saldo_log`;
    const insert = fx.sql.prepare(`INSERT INTO ${table}(balance,source,created_at) VALUES(1,?,?)`);
    insert.run("manual_topup", "2026-11-22 12:00:00");
    const budget = createBudgetedDatabase(12, 2, fx.db);
    const query = vi.fn(budget.access.queryFirst);
    const parse = vi.mocked(parseExpiry);
    let expectedCost = 0;

    for (const [stamp, due, clockReads] of [
      [undefined, true, 0],
      ["invalid", true, 0],
      ["2026-11-22 11:50:01", false, 1],
      ["2026-11-22 11:50:00", false, 1],
      ["2026-11-22 11:49:59", true, 1],
    ] as const) {
      fx.sql.prepare(`DELETE FROM ${table} WHERE source='api_check'`).run();
      if (stamp !== undefined) {
        insert.run("api_check", stamp);
        insert.run("api_check", "2026-11-21 00:00:00");
      }
      query.mockClear(); parse.mockClear(); now.mockClear();
      expect(await supplierSaldoCheckDue(query, supplier)).toBe(due);
      expect(query).toHaveBeenCalledExactlyOnceWith(`SELECT created_at FROM ${table} WHERE source='api_check' ORDER BY created_at DESC LIMIT 1`);
      expect(budget.used).toBe(++expectedCost);
      expect(parse).toHaveBeenCalledExactlyOnceWith(stamp);
      expect(query).toHaveBeenCalledBefore(parse);
      expect(now).toHaveBeenCalledTimes(clockReads);
    }

    // SQLite rejects the lookup; a starved meter rejects it before submission.
    fx.sql.exec(`DROP TABLE ${table}`);
    const starved = createBudgetedDatabase(2, 2, fx.db);
    for (const access of [budget.access, starved.access]) {
      parse.mockClear(); now.mockClear();
      expect(await supplierSaldoCheckDue(access.queryFirst, supplier)).toBe(true);
      expect(parse).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(now).not.toHaveBeenCalled();
    }
    expect(starved.used).toBe(0);
  } finally {
    now.mockRestore();
    fx.close();
  }
});
