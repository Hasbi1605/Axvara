// Regresi temuan review read-only Jaspay (2 November 2026): cap atomik,
// completed koheren, bukti parsial monotonik, failed/refunded nyata,
// recovery ber-lease, polling adil, SKU tanpa remap.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { createOrderWithStock } from "@/lib/db";
import { decryptSecret } from "@/lib/fulfillment/crypto";
import { handleJaspayTerminal } from "@/lib/warung-rebahan/deliver";
import { reconcileJaspayAmbiguous, recoverJaspayByExactRef } from "@/lib/warung-rebahan/order";
import { syncJaspayCatalog } from "@/lib/warung-rebahan/sync";
import { setupWrFixture } from "./helpers";

type Fx = Awaited<ReturnType<typeof setupWrFixture>>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const CODE = "AXV-20261102-JSPFIX";

function seed(fx: Fx, opts: { maxQty?: number | null; linkQty?: number } = {}) {
  const max = opts.maxQty === undefined ? 5 : opts.maxQty;
  const qty = opts.linkQty ?? 2;
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed,is_active) VALUES(10,'Jaspay Prod','jaspay-prod',30000,-1,'warung_rebahan','jaspay:PROD',1,1)").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed,is_active) VALUES(10,10,'JSP-1','Paket A',30000,-1,'manual','jaspay:PROD:PKG-A',1,1)").run();
  fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('jaspay:PROD','Jaspay Prod',10)").run();
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source,wr_delivery_mode,wr_max_quantity) VALUES('jaspay:PROD:PKG-A','jaspay:PROD','Paket A',20000,-1,10,30000,'made_by_order','api','manual',?)").run(max);
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at) VALUES(?,'Buyer','628000000000',?,30000,'qris','lunas','paid','web','queued',10,datetime('now'))`)
    .run(CODE, JSON.stringify([{ product_id: 10, variant_id: 10, name: "Jaspay Prod — Paket A", price: 30000, qty }]));
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count,next_attempt_at) VALUES(?,0,10,10,?,'manual','web','queued',0,datetime('now'))`).run(CODE, qty);
}

function seedLink(fx: Fx, opts: { status: string; invoice?: string | null; qty?: number; id?: number }) {
  const id = opts.id ?? 1;
  fx.sql.prepare(`INSERT INTO wr_order_links(id,order_code,wr_variant_id,quantity,wr_cost,status,wr_order_id,idempotency_key,request_sent_at,attempt_count,max_attempts,created_at,updated_at)
    VALUES(?,?,?,?,20000,?,?,?,datetime('now','-5 minutes'),1,5,datetime('now','-5 minutes'),datetime('now','-5 minutes'))`)
    .run(id, CODE, "jaspay:PROD:PKG-A", opts.qty ?? 2, opts.status, opts.invoice ?? null, `wr:${CODE}:jaspay:PROD:PKG-A:${opts.qty ?? 2}:${id}`);
  return id;
}

function link(fx: Fx, id = 1) {
  return fx.sql.prepare("SELECT * FROM wr_order_links WHERE id=?").get(id) as Record<string, unknown>;
}

function enableWr() {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
}

function stubFetch(handler: (url: string, body: Record<string, unknown>) => Record<string, unknown>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    return { ok: true, json: async () => handler(String(url), body) };
  }));
  return calls;
}

describe("cap Jaspay ditegakkan atomik saat reservasi", () => {
  const order = (items: { qty: number }[]) => createOrderWithStock({
    code: `AXV-CAP-${items.map((i) => i.qty).join("-")}`, quoteId: `cap-${items.map((i) => i.qty).join("-")}`,
    customerName: "Buyer", customerWa: "6281234567890", customerEmail: null,
    items: items.map((i) => ({ product_id: 10, variant_id: 10, name: "Jaspay", price: 30000, qty: i.qty })),
    subtotal: 30000 * items.reduce((s, i) => s + i.qty, 0), paymentMethod: "qris", paymentAccount: "Fixture", proofUrl: null,
  });

  it("qty melebihi cap => batch ditolak tanpa order; qty = cap lolos", async () => {
    const fx = await setupWrFixture();
    try {
      seed(fx, { maxQty: 3 });
      await expect(order([{ qty: 4 }])).rejects.toThrow();
      // Baris ganda varian sama tetap ditolak guard existing (operation_id unik).
      await expect(order([{ qty: 1 }, { qty: 1 }])).rejects.toThrow();
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders WHERE code LIKE 'AXV-CAP-%'").get()).toMatchObject({ n: 0 });
      await order([{ qty: 3 }]);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders WHERE code LIKE 'AXV-CAP-%'").get()).toMatchObject({ n: 1 });
    } finally {
      fx.close();
    }
  });

  it("cap hilang (NULL) => ditolak (fail-closed, bukan unlimited)", async () => {
    const fx = await setupWrFixture();
    try {
      seed(fx, { maxQty: null });
      await expect(order([{ qty: 1 }])).rejects.toThrow();
    } finally {
      fx.close();
    }
  });
});

describe("terminal Jaspay", () => {
  it("completed dengan akun null/kosong TIDAK diselesaikan; bukti mentah utuh tersimpan", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      seedLink(fx, { status: "processing", invoice: "JSP-1" });
      const db = createDatabaseAccess(fx.db);
      const long = "x".repeat(6000);
      await handleJaspayTerminal("JSP-1", {
        invoice: "JSP-1", status: "completed", product: "PROD", quantity: 2, success_count: 2,
        accounts: [null, { email: "", password: "" }] as never, raw: { note: long },
      }, db);
      const row = link(fx);
      expect(row.status).toBe("processing");
      expect(String(row.last_error)).toBe("jaspay_completed_manual:0/2");
      const evidence = await decryptSecret(String(row.wr_account_details), String(row.wr_account_iv));
      expect(evidence).toContain(long);
      expect(fx.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code=?").get(CODE)).toMatchObject({ status: "queued" });
    } finally {
      fx.close();
    }
  });

  it("partial replay dengan akun lebih sedikit tidak menimpa bukti lebih lengkap", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx, { linkQty: 3 });
      seedLink(fx, { status: "processing", invoice: "JSP-2", qty: 3 });
      const db = createDatabaseAccess(fx.db);
      await handleJaspayTerminal("JSP-2", {
        invoice: "JSP-2", status: "partial", product: "PROD", quantity: 3, success_count: 2,
        accounts: [{ email: "a@x", password: "p1" }, { email: "b@x", password: "p2" }],
      }, db);
      const first = link(fx);
      await handleJaspayTerminal("JSP-2", {
        invoice: "JSP-2", status: "partial", product: "PROD", quantity: 3, success_count: 0, accounts: [],
      }, db);
      const second = link(fx);
      expect(second.wr_account_details).toBe(first.wr_account_details);
      expect(String(second.last_error)).toBe("jaspay_partial_manual:2/3");
      const evidence = await decryptSecret(String(second.wr_account_details), String(second.wr_account_iv));
      expect(evidence).toContain("b@x");
    } finally {
      fx.close();
    }
  });

  it.each(["failed", "refunded"])("%s benar-benar menggagalkan link + item (tanpa refund otomatis)", async (kind) => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      seedLink(fx, { status: "processing", invoice: "JSP-3" });
      const db = createDatabaseAccess(fx.db);
      const ok = await handleJaspayTerminal("JSP-3", {
        invoice: "JSP-3", status: kind === "failed" ? "failed" : "processing", refunded_event: kind === "refunded",
        product: "PROD", quantity: 2, success_count: 0, accounts: [],
      }, db);
      expect(ok).toBe(true);
      expect(link(fx).status).toBe("failed");
      expect(fx.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code=?").get(CODE)).toMatchObject({ status: "failed" });
      expect(fx.sql.prepare("SELECT status, payment_status FROM orders WHERE code=?").get(CODE)).toMatchObject({ status: "lunas", payment_status: "paid" });
    } finally {
      fx.close();
    }
  });

  it("failed telat tidak meregresi link completed", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      seedLink(fx, { status: "completed", invoice: "JSP-4" });
      const db = createDatabaseAccess(fx.db);
      await handleJaspayTerminal("JSP-4", { invoice: "JSP-4", status: "failed", product: "PROD", quantity: 2, success_count: 0, accounts: [] }, db);
      expect(link(fx).status).toBe("completed");
    } finally {
      fx.close();
    }
  });
});

describe("recovery exact-ref ber-lease + CAS", () => {
  it("claimed terkirim dengan lease kedaluwarsa dipulihkan lewat ref yang sama", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr(); seed(fx); seedLink(fx, { status: "claimed" });
      fx.sql.prepare("UPDATE wr_order_links SET lease_owner='dead', lease_expires_at=datetime('now','-1 minutes') WHERE id=1").run();
      const calls = stubFetch(() => ({ success: true, message: "ok", data: { invoice: "JSP-CRASH", status: "processing" } }));
      expect((await reconcileJaspayAmbiguous(createDatabaseAccess(fx.db))).exactRef).toBe(1);
      expect(calls).toHaveLength(1);
      expect(link(fx)).toMatchObject({ status: "processing", wr_order_id: "JSP-CRASH" });
    } finally { fx.close(); }
  });

  it.each(["disabled", "unpaid", "manual", "manual_remapped"])("replay tidak berjalan bila %s", async (reason) => {
    const fx = await setupWrFixture();
    try {
      enableWr(); seed(fx); seedLink(fx, { status: "submitted" });
      if (reason === "disabled") vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "false");
      if (reason === "unpaid") fx.sql.prepare("UPDATE orders SET payment_status='unpaid' WHERE code=?").run(CODE);
      if (reason === "manual") fx.sql.prepare("UPDATE fulfillment_items SET status='delivered', delivered_message_id='manual' WHERE order_code=?").run(CODE);
      if (reason === "manual_remapped") {
        fx.sql.prepare("UPDATE fulfillment_items SET wr_link_id=1,status='delivered',delivered_message_id='manual' WHERE order_code=?").run(CODE);
        fx.sql.exec("UPDATE product_variants SET wr_variant_id=NULL");
      }
      const calls = stubFetch(() => ({ success: true, data: { invoice: "JSP-NO", status: "processing" } }));
      expect(await recoverJaspayByExactRef(1, createDatabaseAccess(fx.db))).toBe(false);
      expect(calls).toHaveLength(0);
    } finally { fx.close(); }
  });
  it("lease aktif milik worker lain => tidak POST", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      seedLink(fx, { status: "submitted" });
      fx.sql.prepare("UPDATE wr_order_links SET lease_owner='other', lease_expires_at=datetime('now','+5 minutes') WHERE id=1").run();
      const calls = stubFetch(() => ({ success: true, message: "ok", data: { invoice: "JSP-9", status: "processing" } }));
      expect(await recoverJaspayByExactRef(1, createDatabaseAccess(fx.db))).toBe(false);
      expect(calls.length).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("status berubah selama POST => hasil telat tidak di-bind", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      seedLink(fx, { status: "submitted" });
      stubFetch(() => {
        // Admin/worker lain memindahkan link saat request berjalan.
        fx.sql.prepare("UPDATE wr_order_links SET status='failed' WHERE id=1").run();
        return { success: true, message: "ok", data: { invoice: "JSP-10", status: "processing" } };
      });
      expect(await recoverJaspayByExactRef(1, createDatabaseAccess(fx.db))).toBe(false);
      expect(link(fx)).toMatchObject({ status: "failed", wr_order_id: null });
    } finally {
      fx.close();
    }
  });

  it("claimed (dispatcher aktif) tidak pernah diambil alih recovery", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      seedLink(fx, { status: "claimed" });
      const calls = stubFetch(() => ({ success: true, message: "ok", data: { invoice: "JSP-11", status: "processing" } }));
      expect(await recoverJaspayByExactRef(1, createDatabaseAccess(fx.db))).toBe(false);
      expect(calls.length).toBe(0);
    } finally {
      fx.close();
    }
  });
});

describe("polling invoice dikenal adil + tanpa hilang setelah 24 jam", () => {
  it("putaran kedua memproses link yang belum kebagian; link >24 jam tetap dipoll", async () => {
    const fx = await setupWrFixture();
    try {
      enableWr();
      seed(fx);
      for (let id = 1; id <= 5; id++) seedLink(fx, { id, status: "processing", invoice: `JSP-P${id}` });
      fx.sql.prepare("UPDATE wr_order_links SET request_sent_at=datetime('now','-3 days'), created_at=datetime('now','-3 days') WHERE id=5").run();
      const polled: string[] = [];
      stubFetch((url, body) => {
        polled.push(String(body.invoice));
        return { success: true, message: "ok", data: { invoice: body.invoice, status: "processing" } };
      });
      const db = createDatabaseAccess(fx.db);
      await reconcileJaspayAmbiguous(db, 4);
      await reconcileJaspayAmbiguous(db, 4);
      expect(new Set(polled)).toEqual(new Set(["JSP-P1", "JSP-P2", "JSP-P3", "JSP-P4", "JSP-P5"]));
      expect(polled.slice(0, 4)).not.toContain("JSP-P5");
      expect(polled.slice(4)).toEqual(["JSP-P5"]);
    } finally {
      fx.close();
    }
  });
});

describe("sync katalog Jaspay", () => {
  it("varian baru tersimpan dengan cap; SKU varian lain tidak pernah di-remap", async () => {
    const fx = await setupWrFixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      const feed = async () => [
        { product: "PR", name: "Produk", max_quantity: 4, available: true, packages: [{ id: "K1", name: "Satu", price: 10000, available: true }] },
      ];
      await syncJaspayCatalog(db, feed);
      const row = fx.sql.prepare("SELECT wr_max_quantity, axvara_variant_id FROM wr_variants WHERE wr_variant_id='jaspay:PR:K1'").get() as { wr_max_quantity: number; axvara_variant_id: number };
      expect(row.wr_max_quantity).toBe(4);
      const sku = (fx.sql.prepare("SELECT sku FROM product_variants WHERE id=?").get(row.axvara_variant_id) as { sku: string }).sku;
      expect(sku).toMatch(/^WR-J[0-9A-F]{28}$/);
      // Baris lain sudah memakai SKU yang akan dihasilkan untuk paket K2.
      const { createHash } = await import("node:crypto");
      const k2Sku = `WR-J${createHash("sha256").update("jaspay:PR:K2").digest("hex").slice(0, 28).toUpperCase()}`;
      const pr = fx.sql.prepare("SELECT id FROM products WHERE wr_product_id='jaspay:PR'").get() as { id: number };
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id) VALUES(77,?,?,'Lain',1,1,'manual','var-lain')").run(pr.id, k2Sku);
      const res = await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Produk", max_quantity: 4, available: true, packages: [
          { id: "K1", name: "Satu", price: 10000, available: true },
          { id: "K2", name: "Dua", price: 10000, available: true },
        ] },
      ]);
      expect(res.errors.join(" ")).toContain("jaspay_sku_identity_conflict");
      expect(fx.sql.prepare("SELECT wr_variant_id FROM product_variants WHERE id=77").get()).toMatchObject({ wr_variant_id: "var-lain" });
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM wr_variants WHERE wr_variant_id='jaspay:PR:K2'").get()).toMatchObject({ n: 0 });
    } finally {
      fx.close();
    }
  });

  it("cap invalid pada varian lama => stok 0 (tidak bisa dijual), cap lama dipertahankan", async () => {
    const fx = await setupWrFixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Produk", max_quantity: 4, available: true, packages: [{ id: "K1", name: "Satu", price: 10000, available: true }] },
      ]);
      await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Produk", max_quantity: "rusak", available: true, packages: [{ id: "K1", name: "Satu", price: 10000, available: true }] },
      ]);
      const row = fx.sql.prepare("SELECT wr_stock, wr_max_quantity, axvara_variant_id FROM wr_variants WHERE wr_variant_id='jaspay:PR:K1'").get() as { wr_stock: number; wr_max_quantity: number; axvara_variant_id: number };
      expect(row).toMatchObject({ wr_stock: 0, wr_max_quantity: 4 });
      expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=?").get(row.axvara_variant_id)).toMatchObject({ stock: 0 });
    } finally {
      fx.close();
    }
  });

  it("feed gagal di tengah (error produk) => zero-missing tidak dijalankan", async () => {
    const fx = await setupWrFixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Produk", max_quantity: 4, available: true, packages: [{ id: "K1", name: "Satu", price: 10000, available: true }] },
      ]);
      // Feed kosong (bukan array valid) => tidak boleh me-nol-kan katalog.
      const res = await syncJaspayCatalog(db, async () => "rusak" as never);
      expect(res.errors).toContain("catalog_malformed_not_array");
      expect(fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='jaspay:PR:K1'").get()).toMatchObject({ wr_stock: -1 });
    } finally {
      fx.close();
    }
  });
});
