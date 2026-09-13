import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  createWrOrderLink,
  processWrPendingOrders,
  reconcileBlockedBalance,
  reconcileMissingWrLinks,
  recoverStaleClaims,
  WR_MAX_ATTEMPTS,
} from "@/lib/warung-rebahan/order";
import {
  seedWrCatalog,
  seedWrOrder,
  setupWrFixture,
} from "./helpers";

// Test regresi wajib #1–#5, #10: exactly-once order submission.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubEnv() {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
}

describe("regresi #1: timeout setelah vendor menerima tidak menghasilkan POST kedua", () => {
  it("link submitted tidak dibeli ulang; hanya reconcile", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00001");
      stubEnv();
      let posts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          // /order timeout; /transactions kosong (vendor belum terindeks).
          if (String(url).includes("/order")) {
            posts++;
            throw new DOMException("aborted", "AbortError");
          }
          return { ok: true, json: async () => ({ success: true, message: "ok", data: [] }) };
        }),
      );
      const db = createDatabaseAccess(fx.db);
      expect(await createWrOrderLink("AXV-20260913-T00001", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(1);
      const r1 = await processWrPendingOrders(db);
      expect(posts).toBe(1);
      const link = fx.sql.prepare("SELECT status, request_sent_at FROM wr_order_links").get() as { status: string; request_sent_at: string };
      // Timeout = ambigu: submitted, request tercatat terkirim.
      expect(link.status).toBe("submitted");
      expect(link.request_sent_at).toBeTruthy();
      // Run berikutnya: TIDAK ada POST kedua (reconcile saja, transaksi kosong).
      const r2 = await processWrPendingOrders(createDatabaseAccess(fx.db));
      expect(posts).toBe(1);
      expect(r2.processed).toBe(0);
      const after = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(after.status).toBe("submitted");
      void r1;
    } finally {
      fx.close();
    }
  });
});

describe("regresi #2: D1 gagal setelah respons sukses tidak blind retry", () => {
  it("wr_order_id tetap tersimpan walau tulis saldo gagal", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00002");
      stubEnv();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            success: true, message: "ok",
            data: { order_id: "ORD-D1FAIL", status: "processing", payment_status: "paid", total_amount: 5000, current_balance: 9000 },
          }),
        })),
      );
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260913-T00002", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      // Gagalkan tulis wr_saldo_log (simulasi D1 gagal setelah sukses).
      const origExec = db.execRun;
      let saldoWrites = 0;
      db.execRun = (async (q: string, ...p: unknown[]) => {
        if (q.includes("wr_saldo_log")) {
          saldoWrites++;
          throw new Error("D1 overloaded");
        }
        return origExec(q, ...p);
      }) as typeof db.execRun;
      const result = await processWrPendingOrders(db);
      expect(saldoWrites).toBe(1);
      void result;
      // Hasil sukses TETAP tersimpan (bukan retry buta).
      const link = fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links").get() as { status: string; wr_order_id: string };
      expect(link.status).toBe("processing");
      expect(link.wr_order_id).toBe("ORD-D1FAIL");
    } finally {
      fx.close();
    }
  });
});

describe("regresi #3: stale ordering/claimed direcover dengan fencing", () => {
  it("claimed basi tanpa request keluar kembali ke pending", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00003");
      stubEnv();
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260913-T00003", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      // Simulasi worker crash: claimed + lease basi + request BELUM keluar.
      fx.sql.prepare("UPDATE wr_order_links SET status='claimed', lease_owner='dead-worker', lease_expires_at=datetime('now','-5 minutes'), attempt_count=1").run();
      expect(await recoverStaleClaims(db)).toBe(1);
      const link = fx.sql.prepare("SELECT status, lease_owner FROM wr_order_links").get() as { status: string; lease_owner: string | null };
      expect(link.status).toBe("pending");
      expect(link.lease_owner).toBeNull();
    } finally {
      fx.close();
    }
  });

  it("claimed basi yang request SUDAH keluar tidak direset (tetap ambigu)", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00004");
      stubEnv();
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260913-T00004", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      fx.sql.prepare("UPDATE wr_order_links SET status='claimed', lease_owner='dead-worker', lease_expires_at=datetime('now','-5 minutes'), request_sent_at=datetime('now','-4 minutes'), attempt_count=1").run();
      expect(await recoverStaleClaims(db)).toBe(0);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(link.status).toBe("claimed");
    } finally {
      fx.close();
    }
  });
});

describe("regresi #4: dua concurrent link creation menghasilkan satu kebutuhan", () => {
  it("INSERT OR IGNORE: pemenang satu, qty diagregasi untuk duplikat cart", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00005");
      stubEnv();
      const db = createDatabaseAccess(fx.db);
      // Dua baris cart varian sama (qty 1 + 2) dipanggil bersamaan.
      const items = [
        { product_id: 1, variant_id: 1, qty: 1 },
        { product_id: 1, variant_id: 1, qty: 2 },
      ];
      const [a, b] = await Promise.all([
        createWrOrderLink("AXV-20260913-T00005", items, db),
        createWrOrderLink("AXV-20260913-T00005", items, db),
      ]);
      expect(a + b).toBe(1);
      const rows = fx.sql.prepare("SELECT quantity, wr_cost, idempotency_key FROM wr_order_links").all() as { quantity: number; wr_cost: number; idempotency_key: string }[];
      expect(rows.length).toBe(1);
      expect(Number(rows[0].quantity)).toBe(3);
      expect(Number(rows[0].wr_cost)).toBe(15000);
      expect(rows[0].idempotency_key).toBe("wr:AXV-20260913-T00005:var-1:3");
    } finally {
      fx.close();
    }
  });
});

describe("regresi #5: paid order tanpa link ditemukan reconciler", () => {
  it("order lunas dengan varian WR tanpa link mendapat link via reconcile", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00006");
      stubEnv();
      const db = createDatabaseAccess(fx.db);
      // Simulasi crash: payment durable, link tidak pernah dibuat.
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_order_links").get()).toMatchObject({ n: 0 });
      const out = await reconcileMissingWrLinks(db);
      expect(out.orders).toBe(1);
      expect(out.links).toBe(1);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(link.status).toBe("pending");
    } finally {
      fx.close();
    }
  });

  it("order tanpa varian WR diabaikan reconciler", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at) VALUES('AXV-20260913-T00007','B','628',?,5000,'qris','lunas','paid','web',datetime('now'))`)
        .run(JSON.stringify([{ product_id: 999, variant_id: 999, name: "Manual", price: 5000, qty: 1 }]));
      stubEnv();
      const out = await reconcileMissingWrLinks(createDatabaseAccess(fx.db));
      expect(out).toMatchObject({ orders: 0, links: 0 });
    } finally {
      fx.close();
    }
  });
});

describe("regresi #10: insufficient balance attempt maksimum tetap recoverable", () => {
  it("blocked_balance pulih otomatis setelah top-up tanpa reset manual", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260913-T00008");
      stubEnv();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (String(url).includes("/balance")) {
            return { ok: true, json: async () => ({ success: true, message: "ok", data: { balance: 100000, currency: "IDR" } }) };
          }
          return { ok: true, json: async () => ({ success: false, message: "Saldo tidak mencukupi", data: null }) };
        }),
      );
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260913-T00008", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      // Bekukan next_attempt agar selalu due; proses 5x — tidak boleh failed.
      for (let i = 0; i < WR_MAX_ATTEMPTS + 2; i++) {
        fx.sql.prepare("UPDATE wr_order_links SET next_attempt_at=datetime('now','-1 minute') WHERE status='blocked_balance'").run();
        await processWrPendingOrders(createDatabaseAccess(fx.db));
        fx.sql.prepare("UPDATE wr_order_links SET status='blocked_balance', next_attempt_at=datetime('now','-1 minute') WHERE status='blocked_balance'").run();
      }
      const link = fx.sql.prepare("SELECT status, attempt_count FROM wr_order_links").get() as { status: string; attempt_count: number };
      expect(link.status).toBe("blocked_balance");
      expect(Number(link.attempt_count)).toBe(0);
      // Top-up terjadi (balance 100000 > cost 5000) → pulih otomatis.
      expect(await reconcileBlockedBalance(createDatabaseAccess(fx.db))).toBe(1);
      const revived = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(revived.status).toBe("pending");
    } finally {
      fx.close();
    }
  });
});
