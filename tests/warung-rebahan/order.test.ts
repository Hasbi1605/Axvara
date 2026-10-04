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

  it("kelas antrean (made_by_order) IKUT auto-order sejak 2026-09-18", async () => {
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
      stubWrApi(() => { calls++; return { success: true, message: "ok", data: { order_id: "RBHN-MBO-1", status: "processing", current_balance: 90000 } }; });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAAMBO01", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      // Dulu: 0 call, link diam 'pending' selamanya sampai admin sadar.
      expect(calls).toBe(1);
      expect(result.processed).toBe(1);
      expect(result.succeeded).toBe(1);
      const link = fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links").get() as { status: string; wr_order_id: string };
      expect(link.status).toBe("processing");
      expect(link.wr_order_id).toBe("RBHN-MBO-1");
    } finally {
      fx.close();
    }
  });

  it("saklar mundur WARUNG_REBAHAN_AUTO_ORDER_MBO='false' menahan kelas antrean seperti perilaku lama", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      fx.sql.prepare(`UPDATE wr_variants SET wr_delivery_class='made_by_order', wr_delivery_source='screenshot' WHERE wr_variant_id='var-1'`).run();
      seedOrder(fx, "AXV-20260911-AAAMBO02");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_MBO", "false");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      let calls = 0;
      stubWrApi(() => { calls++; return { success: true, message: "ok", data: null }; });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAAMBO02", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      expect(calls).toBe(0);
      expect(result.processed).toBe(0);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(link.status).toBe("pending");
    } finally {
      fx.close();
    }
  });

  it("kelas NULL (belum dikunci) juga ikut auto-order", async () => {
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
      stubWrApi(() => { calls++; return { success: true, message: "ok", data: { order_id: "RBHN-NULL-1", status: "processing", current_balance: 80000 } }; });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-AAANULL1", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      expect(calls).toBe(1);
      expect(result.succeeded).toBe(1);
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

  it("completed TANPA bind awal (kasus F111FD64): bind otomatis + ciphertext ke item paritas SK", async () => {
    // Regresi 2026-10-03: link completed tetapi fulfillment_item_id NULL +
    // wr_link_id NULL (bindWrLinkToFulfillmentItem tidak pernah dipanggil) dan
    // settleWrFulfillmentItem hanya flip status — panel /pesanan yang membaca
    // fulfillment_items.delivered_ciphertext tidak pernah melihat kredensial WR.
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20261003-F111AA11");
      seedFulfillmentItem(fx, "AXV-20261003-F111AA11");
      // Link processing TANPA bind (persis kondisi prod link id 12).
      const info = fx.sql.prepare(
        "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20261003-F111AA11','ORD-FRESH','var-1',1,5000,'processing') RETURNING id",
      ).get() as { id: number };
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) })));
      const db = createDatabaseAccess(fx.db);
      expect(
        await handleWrOrderCompleted("ORD-FRESH", { account_details: [{ email: "wr@example.com", password: "wr-pass" }] }, db),
      ).toBe(true);
      // Link ter-bind otomatis.
      const link = fx.sql.prepare("SELECT status, fulfillment_item_id FROM wr_order_links WHERE id=?").get(info.id) as { status: string; fulfillment_item_id: number };
      expect(link.status).toBe("completed");
      expect(Number(link.fulfillment_item_id)).toBeGreaterThan(0);
      // Item: delivered + ciphertext terisi + wr_link_id terisi (paritas SK).
      const item = fx.sql.prepare(
        "SELECT status, wr_link_id, delivered_message_id, delivered_ciphertext IS NOT NULL AS has_cred FROM fulfillment_items WHERE order_code='AXV-20261003-F111AA11'",
      ).get() as { status: string; wr_link_id: number; delivered_message_id: string; has_cred: number };
      expect(item.status).toBe("delivered");
      expect(Number(item.wr_link_id)).toBe(info.id);
      expect(String(item.delivered_message_id)).toMatch(/^wr:/);
      expect(Number(item.has_cred)).toBe(1);
      // Panel bisa dekripsi (admin) — kredensial WR sampai ke pembeli.
      const decrypted = await getDecryptedAccountDetails("AXV-20261003-F111AA11", db, { admin: true });
      expect(decrypted.length).toBe(1);
      expect(decrypted[0].details).toContain("wr@example.com");
    } finally {
      fx.close();
    }
  });

  it("reconcileFreshWrLinks: link processing fresh yang upstream-nya completed langsung settle (tanpa tunggu 1 jam)", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20261003-F111BB22");
      seedFulfillmentItem(fx, "AXV-20261003-F111BB22");
      const info = fx.sql.prepare(
        "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at) VALUES('AXV-20261003-F111BB22','ORD-FRESH2','var-1',1,5000,'processing',datetime('now','-5 minutes')) RETURNING id",
      ).get() as { id: number };
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "proxy-secret");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
      // Upstream: order sudah completed + kredensial — webhook tidak sampai.
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (String(url).includes("/wr/transactions") || String(url).includes("/transactions")) {
          return {
            ok: true,
            json: async () => ({
              success: true, message: "ok",
              data: [{
                order_id: "ORD-FRESH2", status: "completed", total_amount: 5000,
                payment_status: "paid", products: [], created_at: new Date().toISOString(),
                account_details: [{ email: "fresh@example.com", password: "fresh-pass" }],
              }],
            }),
          };
        }
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }));
      const { reconcileFreshWrLinks } = await import("@/lib/warung-rebahan/order");
      const db = createDatabaseAccess(fx.db);
      const n = await reconcileFreshWrLinks(
        [{ id: info.id, wr_order_id: "ORD-FRESH2", order_code: "AXV-20261003-F111BB22" }],
        db,
      );
      expect(n).toBe(1);
      const link = fx.sql.prepare("SELECT status, wr_account_details IS NOT NULL AS has_cred FROM wr_order_links WHERE id=?").get(info.id) as { status: string; has_cred: number };
      expect(link.status).toBe("completed");
      expect(Number(link.has_cred)).toBe(1);
      const item = fx.sql.prepare("SELECT status, delivered_ciphertext IS NOT NULL AS has_cred FROM fulfillment_items WHERE order_code='AXV-20261003-F111BB22'").get() as { status: string; has_cred: number };
      expect(item.status).toBe("delivered");
      expect(Number(item.has_cred)).toBe(1);
      // SK tidak tersentuh: tidak ada baris SK untuk order ini.
      const sk = fx.sql.prepare("SELECT * FROM sk_order_links").all();
      expect(sk.length).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("repairUnboundCompletedWrLinks: link completed lama (teks rusak, belum terikat) ditulis ulang tanpa kirim ulang", async () => {
    const fx = await setup();
    try {
      seedCatalog(fx);
      seedOrder(fx, "AXV-20261003-F111CC33");
      seedFulfillmentItem(fx, "AXV-20261003-F111CC33");
      const { encryptSecret } = await import("@/lib/fulfillment/crypto");
      const bad = await encryptSecret("Product: Spotify · Details: [object Object]");
      const info = fx.sql.prepare(
        "INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,wr_account_details,wr_account_iv,completed_at,delivery_status) VALUES('AXV-20261003-F111CC33','ORD-OLD','var-1',1,5000,'completed',?,?,datetime('now','-1 day'),'delivered') RETURNING id",
      ).get(bad.ciphertext, bad.iv) as { id: number };
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "proxy-secret");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const sends: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        if (String(url).includes("/transactions")) {
          return { ok: true, json: async () => ({ success: true, message: "ok", data: [{
            order_id: "ORD-OLD", status: "completed", total_amount: 5000, payment_status: "paid", products: [],
            account_details: { product: "Spotify Premium", details: [{ email: "old@example.com" }, { password: "pw1" }] },
          }] }) };
        }
        sends.push(String(url));
        return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }));
      const { repairUnboundCompletedWrLinks } = await import("@/lib/warung-rebahan/order");
      const db = createDatabaseAccess(fx.db);
      expect(await repairUnboundCompletedWrLinks(db)).toBe(1);
      const decrypted = await getDecryptedAccountDetails("AXV-20261003-F111CC33", db, { admin: true });
      expect(decrypted[0].details).toContain("old@example.com");
      expect(decrypted[0].details).not.toContain("[object Object]");
      const link = fx.sql.prepare("SELECT fulfillment_item_id, delivery_status FROM wr_order_links WHERE id=?").get(info.id) as { fulfillment_item_id: number; delivery_status: string };
      expect(Number(link.fulfillment_item_id)).toBeGreaterThan(0);
      expect(link.delivery_status).toBe("delivered");
      expect(sends).toHaveLength(0); // tidak ada pengiriman ulang ke pembeli
      // Sudah terikat → tidak dipungut lagi.
      expect(await repairUnboundCompletedWrLinks(db)).toBe(0);
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

  it("format detail akun: JSON {product,details} + \\r\\n + envelope (bukti prod 95FC8669)", async () => {
    // BUKTI PROD 2026-09-18 sore: panel menampilkan mentah
    // {"product":"Meitu Premium - Meitu VIP+","details":"email: a@x.id\r\npassword: p\r\nakses otp: https://..."}
    // karena cabang `typeof raw === "string"` mengembalikan string apa pun
    // mentah. Sekarang: normalizeAccountDetailsForDisplay (dipakai SEMUA
    // kanal: panel, WA, email, Telegram) mengupas envelope + menormalkan
    // \r\n + merapikan label. formatWrAccountDetails tetap untuk simpan.
    const { normalizeAccountDetailsForDisplay } = await import("@/lib/warung-rebahan/deliver");
    const prodRaw = `{"product":"Meitu Premium - Meitu VIP+","details":"email:  angelolvedner5912@gsmail.id\\r\\npassword:  @Masuk123\\r\\nakses otp:  https://gomail.id/angeloledner5912@gsmail.id"}`;
    const out = normalizeAccountDetailsForDisplay(prodRaw);
    expect(out).not.toContain("{");
    expect(out).not.toContain("Meitu Premium - Meitu VIP+");
    expect(out).not.toContain("\r");
    expect(out).toContain("Email: angelolvedner5912@gsmail.id");
    expect(out).toContain("Password: @Masuk123");
    expect(out).toContain("Akses OTP: https://gomail.id/angeloledner5912@gsmail.id");
    expect(out).not.toContain("{");
    expect(out).not.toContain("Meitu Premium - Meitu VIP+");
    expect(out).not.toContain("\r");
    expect(out).toContain("Email: angelolvedner5912@gsmail.id");
    expect(out).toContain("Password: @Masuk123");
    expect(out).toContain("Akses OTP: https://gomail.id/angeloledner5912@gsmail.id");
    // format lama tetap didukung (tidak regresi).
    expect(formatWrAccountDetails("user:pass")).toBe("user:pass");
    expect(formatWrAccountDetails([{ email: "a@b.c", password: "p" }])).toContain("a@b.c");
    expect(formatWrAccountDetails({ email: "x@y.z", password: "q" })).toContain("x@y.z");
    // envelope account_details + label ganda tidak bocor (jalur display).
    expect(normalizeAccountDetailsForDisplay({ account_details: [{ email: "e@x.id" }] })).toContain("Email: e@x.id");
    // Regresi 2026-10-04 (kasus F111FD64): /transactions mengirim
    // {product, details: [{...}×4]} (details = ARRAY OBJEK, bukan string) —
    // String(v) menghasilkan "[object Object]" ×4 di panel.
    const arrPayload = {
      product: "Spotify Premium - Premium",
      details: [
        { email: "qavzeli583@gmail.com" },
        { password: "Revacantik1" },
        { penting: "Nogar, jangan komplain kalo kena razia/banned" },
        { info: "Jangan login lebih dari 1 device" },
      ],
    };
    const arrOut = normalizeAccountDetailsForDisplay(arrPayload);
    expect(arrOut).not.toContain("[object Object]");
    expect(arrOut).toContain("qavzeli583@gmail.com");
    expect(arrOut).toContain("Revacantik1");
    // formatWrAccountDetails (jalur simpan) ikut rapi untuk bentuk yang sama.
    const saved = formatWrAccountDetails(arrPayload);
    expect(saved).not.toContain("[object Object]");
    expect(saved).toContain("qavzeli583@gmail.com");
    expect(normalizeAccountDetailsForDisplay("Email: Email: a@b.c")).toBe("Email: a@b.c");
    expect(normalizeAccountDetailsForDisplay(null)).toBe("");
  });

  it("order LAMA tampil shortlink go/* retroaktif tanpa migrasi data (screenshot owner AXV-20261003-BD58F7ED)", async () => {
    // Order 3 Okt 2026 15.19 menyimpan ciphertext berisi link supplier
    // PANJANG (era pra-shortlink). Panel menampilkan mentah — kini
    // normalizeAccountDetailsForDisplay membungkus SAAT TAMPIL.
    const { normalizeAccountDetailsForDisplay } = await import("@/lib/warung-rebahan/deliver");
    const storedLama = [
      "Netflix — 1 Profile 2 User:",
      "Email: krutehkhan@gmail.com | PASSWORD : Nengflix222@@ | PROFILE : UCIHA |",
      "CARA LOGIN = https://sekalipay.com/docs/tutorial-login-netflix",
      "AKSES BOT / KODE = https://netflix-codes.sekalipay.com/mailbox",
      "- https://www.netflix.com/clearcookies",
      "- lalu https://www.netflix.com/youraccount",
    ].join("\n");
    const out = normalizeAccountDetailsForDisplay(storedLama);
    // Link supplier → go/* (tanpa ubah ciphertext tersimpan).
    expect(out).toContain("axvara.tech/go/netflix-login");
    expect(out).toContain("axvara.tech/go/otp");
    expect(out).not.toContain("sekalipay.com/docs/");
    expect(out).not.toContain("netflix-codes.sekalipay.com/mailbox");
    // Yang dikecualikan owner tetap mentah.
    expect(out).toContain("https://www.netflix.com/clearcookies");
    expect(out).toContain("https://www.netflix.com/youraccount");
    // Kredensial utuh tidak rusak.
    expect(out).toContain("krutehkhan@gmail.com");
    expect(out).toContain("Nengflix222@@");
  });
});
