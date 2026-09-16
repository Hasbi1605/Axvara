import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  createWrOrderLink,
  processWrPendingOrders,
  retryFailedWrOrders,
  WR_MAX_ATTEMPTS,
} from "@/lib/warung-rebahan/order";
import {
  formatWrAccountDetails,
  getDecryptedAccountDetails,
  handleWrOrderCompleted,
  handleWrOrderFailed,
} from "@/lib/warung-rebahan/deliver";
import {
  seedWrCatalog as seedCatalog,
  seedWrFulfillmentItem as seedFulfillmentItem,
  seedWrOrder as seedOrder,
  setupWrFixture as setup,
} from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Warung Rebahan auto-order links", () => {
  it("membuat link pending idempoten per (order, varian)", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAABBBB");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      const created = await createWrOrderLink(
        "AXV-20260911-AAAABBBB",
        [{ product_id: 1, variant_id: 1, qty: 1 }],
        db,
      );
      expect(created).toBe(1);
      const again = await createWrOrderLink(
        "AXV-20260911-AAAABBBB",
        [{ product_id: 1, variant_id: 1, qty: 1 }],
        db,
      );
      expect(again).toBe(0);
      const row = fx.sql.prepare("SELECT status, wr_cost FROM wr_order_links").get() as { status: string; wr_cost: number };
      expect(row.status).toBe("pending");
      expect(Number(row.wr_cost)).toBe(5000);
    } finally {
      fx.close();
    }
  });

  it("melewati item non-WR dan nonaktif saat disabled", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAACCCC");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
      const db = createDatabaseAccess(fx.db);
      expect(await createWrOrderLink("AXV-20260911-AAAACCCC", [{ product_id: 1, variant_id: 1, qty: 1 }], db)).toBe(0);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      expect(await createWrOrderLink("AXV-20260911-AAAACCCC", [{ product_id: 1, qty: 1 }], db)).toBe(0);
    } finally {
      fx.close();
    }
  });
});

describe("Warung Rebahan process pending orders", () => {
  function stubWrApi(handler: (url: string, body: Record<string, unknown>) => Record<string, unknown>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => ({
        ok: true,
        json: async () => handler(url, JSON.parse(String(init.body)) as Record<string, unknown>),
      })),
    );
  }

  it("gate per kelas: made_by_order TIDAK auto-order, tetap pending (2026-09-16)", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      fx.sql.prepare(`UPDATE wr_variants SET wr_delivery_class='made_by_order', wr_delivery_source='screenshot' WHERE wr_variant_id='var-1'`).run();
      seedOrder(fx, "AXV-20260911-AAAMBO01");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      let calls = 0;
      stubWrApi(() => { calls++; return { success: true, message: "ok", data: null }; });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAAMBO01", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      // Link dibuat (butuh dibayar→dicatat) tapi TIDAK diproses ke WR.
      expect(calls).toBe(0);
      expect(result.processed).toBe(0);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(link.status).toBe("pending");
    } finally {
      fx.close();
    }
  });

  it("NULL (belum dikunci) juga TIDAK auto-order — default aman manual", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      fx.sql.prepare(`UPDATE wr_variants SET wr_delivery_class=NULL, wr_delivery_source=NULL WHERE wr_variant_id='var-1'`).run();
      seedOrder(fx, "AXV-20260911-AAANULL1");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      let calls = 0;
      stubWrApi(() => { calls++; return { success: true, message: "ok", data: null }; });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAANULL1", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      expect(calls).toBe(0);
      expect(result.processed).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("success: pending → processing + saldo tercatat", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAADDDD");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      // 2026-09-16: email_invite diteruskan dari customer_email order
      // (uji live: WR 422 untuk produk Invite tanpa email).
      fx.sql.prepare(`UPDATE orders SET customer_email='buyer@contoh.id' WHERE code='AXV-20260911-AAAADDDD'`).run();
      let seenInvite: unknown = null;
      stubWrApi((_url, body) => {
        seenInvite = (body as Record<string, unknown>).email_invite ?? null;
        return {
          success: true,
          message: "ok",
          data: { order_id: "ORD-1", status: "processing", payment_status: "paid", total_amount: 5000, current_balance: 240000 },
        };
      });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAAADDDD", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      expect(result).toMatchObject({ processed: 1, succeeded: 1 });
      expect(seenInvite).toBe("buyer@contoh.id");
      const link = fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links").get() as { status: string; wr_order_id: string };
      expect(link.status).toBe("processing");
      expect(link.wr_order_id).toBe("ORD-1");
      const saldo = fx.sql.prepare("SELECT balance, source FROM wr_saldo_log ORDER BY id DESC LIMIT 1").get() as { balance: number; source: string };
      expect(Number(saldo.balance)).toBe(240000);
      expect(saldo.source).toBe("order_deduct");
    } finally {
      fx.close();
    }
  });

  it("saldo habis: blocked_balance 1 jam + tidak makan retry transport", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAAEEEE");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      stubWrApi(() => ({ success: false, message: "Saldo tidak mencukupi", data: null }));
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAAAEEEE", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      expect(result.blocked).toBe(1);
      const link = fx.sql.prepare("SELECT status, attempt_count, next_attempt_at, last_error FROM wr_order_links").get() as { status: string; attempt_count: number; next_attempt_at: string; last_error: string };
      expect(link.status).toBe("blocked_balance");
      // attempt_count TIDAK naik (slot retry transport tidak terbuang).
      expect(Number(link.attempt_count)).toBe(0);
      expect(String(link.last_error)).toContain("saldo_wr_habis");
      // Format spasi SQLite dibaca sebagai UTC via parseExpiry (lihat
      // src/lib/expiry.ts) — Date.parse mentah menggeser zona waktu.
      const { parseExpiry } = await import("@/lib/expiry");
      const parsed = parseExpiry(link.next_attempt_at);
      expect(parsed).not.toBeNull();
      const deltaMin = (Number(parsed) - Date.now()) / 60000;
      expect(deltaMin).toBeGreaterThan(50);
    } finally {
      fx.close();
    }
  });

  it("gagal 3x menjadi failed (WR_MAX_ATTEMPTS)", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAAFFFF");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      stubWrApi(() => {
        throw new Error("boom");
      });
      expect(WR_MAX_ATTEMPTS).toBe(3);
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAAAFFFF", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      vi.stubGlobal("fetch", vi.fn(async () => {
        throw new Error("boom");
      }));
      // Paksa due berkali-kali dengan memajukan next_attempt_at.
      for (let i = 0; i < 3; i++) {
        fx.sql.prepare("UPDATE wr_order_links SET next_attempt_at=datetime('now','-1 minute')").run();
        await processWrPendingOrders(createDatabaseAccess(fx.db));
      }
      const link = fx.sql.prepare("SELECT status, attempt_count FROM wr_order_links").get() as { status: string; attempt_count: number };
      expect(link.status).toBe("failed");
      expect(Number(link.attempt_count)).toBe(3);
      expect(await retryFailedWrOrders(createDatabaseAccess(fx.db))).toBe(0);
    } finally {
      fx.close();
    }
  });
});

describe("Warung Rebahan webhook completion", () => {
  it("completed: akun terenkripsi + item WR delivered + agregat jujur", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAAGGGG", "telegram");
      seedFulfillmentItem(fx, "AXV-20260911-AAAAGGGG");
      fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id) VALUES('100','12345')").run();
      fx.sql.prepare("UPDATE orders SET telegram_user_id='100', telegram_chat_id='12345' WHERE code='AXV-20260911-AAAAGGGG'").run();
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,fulfillment_item_id) VALUES('AXV-20260911-AAAAGGGG','ORD-9','var-1',1,5000,'processing',1)").run();
      fx.sql.prepare("UPDATE fulfillment_items SET wr_link_id=1 WHERE order_code='AXV-20260911-AAAAGGGG'").run();
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
      const sent: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
        sent.push(String(init.body));
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }));
      const db = createDatabaseAccess(fx.db);
      const ok = await handleWrOrderCompleted(
        "ORD-9",
        { account_details: [{ email: "akun@example.com", password: "rahasia-123" }] },
        db,
      );
      expect(ok).toBe(true);
      const link = fx.sql.prepare("SELECT status, wr_account_details, completed_at, delivery_status FROM wr_order_links WHERE wr_order_id='ORD-9'").get() as { status: string; wr_account_details: string; completed_at: string; delivery_status: string };
      expect(link.status).toBe("completed");
      expect(String(link.wr_account_details)).not.toContain("rahasia-123");
      expect(link.completed_at).toBeTruthy();
      // Delivery durable: telegram terkirim (mock ok) → delivered.
      expect(link.delivery_status).toBe("delivered");
      // HANYA item WR yang delivered; agregat dari seluruh item.
      const item = fx.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20260911-AAAAGGGG'").get() as { status: string };
      expect(item.status).toBe("delivered");
      const order = fx.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20260911-AAAAGGGG'").get() as { fulfillment_status: string };
      expect(order.fulfillment_status).toBe("delivered");
      // Retrieval WAJIB capability: tanpa token → kosong (regresi #8).
      expect(await getDecryptedAccountDetails("AXV-20260911-AAAAGGGG", db)).toEqual([]);
      // Dengan capability admin → dekripsi round-trip valid.
      const decrypted = await getDecryptedAccountDetails("AXV-20260911-AAAAGGGG", db, { admin: true });
      expect(decrypted.length).toBe(1);
      expect(decrypted[0].details).toContain("akun@example.com");
      // Idempoten: completed kedua tetap true tanpa duplikat kirim.
      expect(await handleWrOrderCompleted("ORD-9", {}, db)).toBe(true);
    } finally {
      fx.close();
    }
  });

  it("failed: monotonik + item WR failed + agregat jujur tanpa auto-refund", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20260911-AAAAHHHH");
      seedFulfillmentItem(fx, "AXV-20260911-AAAAHHHH");
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,fulfillment_item_id) VALUES('AXV-20260911-AAAAHHHH','ORD-8','var-1',1,5000,'processing',1)").run();
      fx.sql.prepare("UPDATE fulfillment_items SET wr_link_id=1 WHERE order_code='AXV-20260911-AAAAHHHH'").run();
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const db = createDatabaseAccess(fx.db);
      expect(await handleWrOrderFailed("ORD-8", "stok WR habis", db)).toBe(true);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='ORD-8'").get() as { status: string };
      expect(link.status).toBe("failed");
      const order = fx.sql.prepare("SELECT status, fulfillment_status FROM orders WHERE code='AXV-20260911-AAAAHHHH'").get() as { status: string; fulfillment_status: string };
      expect(order.status).toBe("lunas");
      expect(order.fulfillment_status).toBe("failed");
      // Regresi terlarang (regresi #9): failed yang datang SETELAH completed
      // tidak boleh mengubah completed.
      fx.sql.prepare("UPDATE wr_order_links SET status='completed' WHERE wr_order_id='ORD-8'").run();
      expect(await handleWrOrderFailed("ORD-8", "terlambat", db)).toBe(true);
      const after = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='ORD-8'").get() as { status: string };
      expect(after.status).toBe("completed");
    } finally {
      fx.close();
    }
  });

  it("format detail akun menangani array/string/object", () => {
    expect(formatWrAccountDetails("user:pass")).toBe("user:pass");
    expect(formatWrAccountDetails([{ email: "a@b.c", password: "p" }])).toContain("a@b.c");
    expect(formatWrAccountDetails({ email: "x@y.z", password: "q" })).toContain("x@y.z");
    expect(formatWrAccountDetails(null)).toBe("");
  });
});
