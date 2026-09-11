import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  checkAndLogSaldo,
  estimateOrderCapacity,
  getSaldoHistory,
  getSaldoThreshold,
} from "@/lib/warung-rebahan/saldo";

const MIGRATION = "drizzle/migrations/0027_warung_rebahan.sql";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Warung Rebahan saldo monitor", () => {
  it("threshold default 50000 dan bisa di-override", () => {
    vi.stubEnv("WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD", "");
    expect(getSaldoThreshold()).toBe(50000);
    vi.stubEnv("WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD", "100000");
    expect(getSaldoThreshold()).toBe(100000);
  });

  it("checkAndLogSaldo mencatat + mendeteksi saldo rendah", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync(MIGRATION, "utf8"));
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD", "50000");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ success: true, message: "ok", data: { balance: 30000, currency: "IDR" } }),
        })),
      );
      const db = createDatabaseAccess(fx.db);
      const result = await checkAndLogSaldo(db);
      expect(result).toMatchObject({ balance: 30000, isLow: true, threshold: 50000 });
      const history = await getSaldoHistory(5, db);
      expect(history.length).toBe(1);
      expect(history[0].balance).toBe(30000);
      const log = fx.sql.prepare("SELECT sync_type, saldo_amount FROM wr_sync_log ORDER BY id DESC LIMIT 1").get() as { sync_type: string; saldo_amount: number };
      expect(log.sync_type).toBe("saldo");
      expect(Number(log.saldo_amount)).toBe(30000);
    } finally {
      fx.close();
    }
  });

  it("saldo cukup tidak isLow", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync(MIGRATION, "utf8"));
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ success: true, message: "ok", data: { balance: 245000, currency: "IDR" } }),
        })),
      );
      const result = await checkAndLogSaldo(createDatabaseAccess(fx.db));
      expect(result.isLow).toBe(false);
    } finally {
      fx.close();
    }
  });

  it("estimasi kapasitas dari rata-rata wr_cost completed", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync(MIGRATION, "utf8"));
      fx.sql.prepare("INSERT INTO wr_saldo_log(balance,source) VALUES(100000,'api_check')").run();
      fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('A','X','6280','[]',10000,'qris','lunas','paid','web'),('B','X','6280','[]',10000,'qris','lunas','paid','web')`).run();
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('A','v',1,5000,'completed'),('B','v',1,15000,'completed')").run();
      const cap = await estimateOrderCapacity(createDatabaseAccess(fx.db));
      expect(cap.balance).toBe(100000);
      expect(cap.avgOrderCost).toBe(10000);
      expect(cap.estimatedOrders).toBe(10);
    } finally {
      fx.close();
    }
  });

  it("disabled melempar, bukan mencatat diam-diam", async () => {
    const fs = await import("node:fs");
    const fx = createD1Fixture();
    try {
      fx.sql.exec(fs.readFileSync(MIGRATION, "utf8"));
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
      await expect(checkAndLogSaldo(createDatabaseAccess(fx.db))).rejects.toThrow("warung_rebahan_disabled");
    } finally {
      fx.close();
    }
  });
});
