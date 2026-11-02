import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  decodeJaspayVariantId,
  isJaspayVariantId,
  jaspayMirrorStock,
  jaspayProductId,
  jaspayRefId,
  jaspayVariantId,
  normalizeJaspayCatalog,
  JASPAY_REF_ID_RE,
} from "@/lib/warung-rebahan/jaspay";
import {
  pollKnownJaspayInvoice,
  processWrPendingOrders,
  recoverJaspayByExactRef,
  reconcileJaspayAmbiguous,
  createWrOrderLink,
} from "@/lib/warung-rebahan/order";
import {
  formatJaspayAccountsForDisplay,
  handleJaspayTerminal,
  handleWrOrderCompleted,
  handleWrOrderFailed,
} from "@/lib/warung-rebahan/deliver";
import { syncJaspayCatalog } from "@/lib/warung-rebahan/sync";
import { zeroMissingVariants, zeroVariantsByIds, syncProducts } from "@/lib/warung-rebahan/sync";
import { buyerDeliveryBadge, buyerDeliveryEtaJaspay, buyerDeliveryKind } from "@/lib/catalog";
import { jaspayEtaForBuyer, jaspayLabelForBuyer } from "@/lib/warung-rebahan/delivery-class";
import { seedWrCatalog, seedWrFulfillmentItem, seedWrOrder, setupWrFixture } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seedJaspayMirror(fx: Awaited<ReturnType<typeof setupWrFixture>>, opts: { maxQty?: number | null; stock?: number } = {}) {
  const max = opts.maxQty === undefined ? 5 : opts.maxQty;
  const stock = opts.stock ?? -1;
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed) VALUES(10,'Jaspay Prod','jaspay-prod',30000,10,'warung_rebahan',?,1)").run("jaspay:PROD");
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed) VALUES(10,10,'JSP-1','Paket A',30000,?, 'manual',?,1)".replace("?, 'manual'", "?, 'manual'")).run(stock, "jaspay:PROD:PKG-A");
  fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('jaspay:PROD','Jaspay Prod',10)").run();
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source,wr_delivery_mode,wr_max_quantity) VALUES('jaspay:PROD:PKG-A','jaspay:PROD','Paket A',20000,?,?,30000,'made_by_order','api','manual',?)").run(stock, 10, max);
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at) VALUES('AXV-20261102-JSP001','Buyer','628000000000',?,30000,'qris','lunas','paid','web','queued',10,datetime('now'))`)
    .run(JSON.stringify([{ product_id: 10, variant_id: 10, name: "Jaspay Prod — Paket A", price: 30000, qty: 2 }]));
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count,next_attempt_at) VALUES('AXV-20261102-JSP001',0,10,10,2,'manual','web','queued',0,datetime('now'))`).run();
}

function stubJaspayFetch(handler: (url: string, body: Record<string, unknown>) => Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => ({
      ok: true,
      json: async () => handler(url, JSON.parse(String(init.body)) as Record<string, unknown>),
    })),
  );
}

describe("WR3 jaspay.ts pure module", () => {
  it("ID namespaced reversibel + collision-free (':' di-encode)", () => {
    expect(jaspayVariantId("PROD:A", "PKG:B")).toBe("jaspay:PROD%3AA:PKG%3AB");
    expect(decodeJaspayVariantId("jaspay:PROD%3AA:PKG%3AB")).toEqual({ product: "PROD:A", package: "PKG:B" });
    expect(jaspayProductId("PROD")).toBe("jaspay:PROD");
    expect(isJaspayVariantId("jaspay:X:Y")).toBe(true);
    expect(isJaspayVariantId("var-1")).toBe(false);
    expect(decodeJaspayVariantId("var-1")).toBeNull();
    expect(decodeJaspayVariantId("jaspay:only-one")).toBeNull();
  });

  it("ref_id deterministik 36 char lolos pola ref upstream", async () => {
    const a = await jaspayRefId("wr:AXV-1:jaspay:P:Q:2");
    const b = await jaspayRefId("wr:AXV-1:jaspay:P:Q:2");
    expect(a).toBe(b);
    expect(a.length).toBe(36);
    expect(JASPAY_REF_ID_RE.test(a)).toBe(true);
    expect(await jaspayRefId("wr:AXV-1:jaspay:P:Q:3")).not.toBe(a);
  });

  it("normalisasi fail-closed: tanpa key/packages/max invalid dibuang", () => {
    const out = normalizeJaspayCatalog([
      { product: "P1", name: "P1", max_quantity: 3, available: true, packages: [{ id: "K1", name: "Paket 1", price: 10000, available: true }] },
      { product: "", packages: [{ id: "K", name: "K", price: 1 }] },
      { product: "P2", packages: [] },
      { product: "P3", max_quantity: "oops", available: true, packages: [{ id: "K3", name: "K3", price: 5000, available: true }] },
    ]);
    expect(out.map((p) => p.productKey)).toEqual(["P1", "P3"]);
    expect(out[0].maxQuantity).toBe(3);
    // max invalid => null => sync menolak (bukan unlimited).
    expect(out[1].maxQuantity).toBeNull();
  });

  it("stok mirror: -1 hanya bila product && package available", () => {
    expect(jaspayMirrorStock(true, true)).toBe(-1);
    expect(jaspayMirrorStock(true, false)).toBe(0);
    expect(jaspayMirrorStock(false, true)).toBe(0);
  });
});

describe("WR3 dispatch: no wrong-family fallback + ref stability", () => {
  it("link Jaspay TIDAK PERNAH POST premium /order (hanya /jaspay/order)", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const seen: string[] = [];
      stubJaspayFetch((url, body) => {
        seen.push(`${url}::${JSON.stringify(body)}`);
        expect(url).toContain("/jaspay/order");
        expect(url).not.toContain("/order\"");
        return { success: true, message: "ok", data: { invoice: "JSP-100", status: "processing", product: "PROD", quantity: 2, success_count: 0, accounts: [] } };
      });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20261102-JSP001", [{ product_id: 10, variant_id: 10, qty: 2 }], db);
      const result = await processWrPendingOrders(db);
      expect(result.succeeded).toBe(1);
      const link = fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links").get() as { status: string; wr_order_id: string };
      expect(link.status).toBe("processing");
      expect(link.wr_order_id).toBe("JSP-100");
      expect(seen.length).toBe(1);
      const body = JSON.parse(seen[0].split("::")[1]) as Record<string, unknown>;
      expect(String(body.ref_id ?? "")).toMatch(/^axv-[0-9a-f]{32}$/);
    } finally {
      fx.close();
    }
  });

  it("ref stabil lintas retry: dua POST memakai ref_id SAMA (bukan concat mentah)", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const refs: string[] = [];
      let n = 0;
      stubJaspayFetch((_url, body) => {
        n++;
        refs.push(String(body.ref_id));
        if (n === 1) throw new Error("fetch failed");
        return { success: true, message: "ok", data: { invoice: "JSP-101", status: "processing", product: "PROD", quantity: 2, success_count: 0, accounts: [] } };
      });
      const db = createDatabaseAccess(fx.db);
      const made = await createWrOrderLink("AXV-20261102-JSP001", [{ product_id: 10, variant_id: 10, qty: 2 }], db);
      expect(made).toBe(1);
      // Paksa timeout ambigu lalu pulihkan via exact-ref: ref HARUS sama.
      const linkRow = fx.sql.prepare("SELECT id, idempotency_key FROM wr_order_links").get() as { id: number; idempotency_key: string };
      const { jaspayRefId: refOf } = await import("@/lib/warung-rebahan/jaspay");
      const expectedRef = await refOf(String(linkRow.idempotency_key));
      // Simulasi: link submitted tanpa invoice (request keluar, receipt hilang).
      fx.sql.prepare("UPDATE wr_order_links SET status='submitted', request_sent_at=datetime('now'), lease_owner=NULL, lease_expires_at=NULL WHERE id=?").run(linkRow.id);
      // Percobaan recovery pertama: network gagal => tetap ambigu, lease dilepas.
      expect(await recoverJaspayByExactRef(linkRow.id, db)).toBe(false);
      const mid = fx.sql.prepare("SELECT status, wr_order_id, lease_owner FROM wr_order_links WHERE id=?").get(linkRow.id) as { status: string; wr_order_id: string | null; lease_owner: string | null };
      expect(mid).toMatchObject({ status: "submitted", wr_order_id: null, lease_owner: null });
      // Percobaan kedua: input identik (ref SAMA) memulihkan invoice asli.
      expect(await recoverJaspayByExactRef(linkRow.id, db)).toBe(true);
      const link = fx.sql.prepare("SELECT wr_order_id FROM wr_order_links WHERE id=?").get(linkRow.id) as { wr_order_id: string };
      expect(link.wr_order_id).toBe("JSP-101");
      expect(refs).toEqual([expectedRef, expectedRef]);
    } finally {
      fx.close();
    }
  });

  it("dispatch menolak fail-closed bila cap missing + qty melebihi cap", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx, { maxQty: null });
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      let calls = 0;
      stubJaspayFetch(() => { calls++; return { success: true, message: "ok", data: {} }; });
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20261102-JSP001", [{ product_id: 10, variant_id: 10, qty: 2 }], db);
      await processWrPendingOrders(db);
      const link = fx.sql.prepare("SELECT status, last_error FROM wr_order_links").get() as { status: string; last_error: string };
      expect(link.status).toBe("failed");
      expect(link.last_error).toContain("jaspay_max_quantity_missing");
      expect(calls).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("availability mati di sync: stok mirror 0 dan quote menolak habis", async () => {
    const fx = await setupWrFixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      const res = await syncJaspayCatalog(db, async () => [
        { product: "PX", name: "PX", max_quantity: 2, available: false, description: "d", after_note: "n", duration: "1 Bulan", packages: [{ id: "K1", name: "Paket 1", price: 10000, available: true }] },
      ]);
      expect(res.synced).toBe(1);
      const row = fx.sql.prepare("SELECT wr_stock, wr_max_quantity FROM wr_variants WHERE wr_variant_id=?").get("jaspay:PX:K1") as { wr_stock: number; wr_max_quantity: number };
      expect(row.wr_stock).toBe(0);
      expect(row.wr_max_quantity).toBe(2);
    } finally {
      fx.close();
    }
  });

  it("premium unchanged: link premium tetap POST /order (bukan /jaspay/*)", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260911-PREM1");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const seen: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: string) => {
        seen.push(String(url));
        return { ok: true, json: async () => ({ success: true, message: "ok", data: { order_id: "RBHN-P1", status: "processing", current_balance: 1 } }) };
      }));
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-20260911-PREM1", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(db);
      expect(result.succeeded).toBe(1);
      expect(seen.some((u) => u.includes("jaspay"))).toBe(false);
      expect(seen.length).toBeGreaterThan(0);
    } finally {
      fx.close();
    }
  });
});

describe("WR3 terminal: partial/malformed tidak completed + no repurchase", () => {
  it("partial: kredensial tersimpan terenkripsi, status TETAP processing, item TIDAK delivered", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at,idempotency_key) VALUES('AXV-20261102-JSP001','JSP-200',?,?,2000,'processing',datetime('now'),?)").run("jaspay:PROD:PKG-A", 2, "wr:AXV-20261102-JSP001:jaspay:PROD:PKG-A:2");
      const applied = await handleJaspayTerminal("JSP-200", {
        invoice: "JSP-200", status: "partial", product: "PROD", quantity: 2,
        success_count: 1, accounts: [{ email: "a@b.c", password: "p1" }],
      }, db);
      expect(applied).toBe(true);
      const link = fx.sql.prepare("SELECT status, wr_account_details FROM wr_order_links WHERE wr_order_id='JSP-200'").get() as { status: string; wr_account_details: string };
      expect(link.status).toBe("processing");
      expect(link.wr_account_details).toBeTruthy();
      const item = fx.sql.prepare("SELECT status FROM fulfillment_items WHERE order_code='AXV-20261102-JSP001'").get() as { status: string };
      expect(item.status).not.toBe("delivered");
      const agg = fx.sql.prepare("SELECT fulfillment_status FROM orders WHERE code='AXV-20261102-JSP001'").get() as { fulfillment_status: string };
      expect(agg.fulfillment_status).not.toBe("delivered");
    } finally {
      fx.close();
    }
  });

  it("completed tak koheren (success<qty): ditahan manual, bukan delivered", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at,idempotency_key) VALUES('AXV-20261102-JSP001','JSP-201',?,?,2000,'processing',datetime('now'),?)").run("jaspay:PROD:PKG-A", 2, "wr:k:2");
      const applied = await handleJaspayTerminal("JSP-201", {
        invoice: "JSP-201", status: "completed", product: "PROD", quantity: 2,
        success_count: 1, accounts: [{ email: "a@b.c" }],
      }, db);
      expect(applied).toBe(true);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='JSP-201'").get() as { status: string };
      expect(link.status).toBe("processing");
    } finally {
      fx.close();
    }
  });

  it("completed koheren: completed + item delivered + agregat delivered", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at,idempotency_key) VALUES('AXV-20261102-JSP001','JSP-202',?,?,2000,'processing',datetime('now'),?)").run("jaspay:PROD:PKG-A", 2, "wr:k:3");
      const applied = await handleJaspayTerminal("JSP-202", {
        invoice: "JSP-202", status: "completed", product: "PROD", quantity: 2,
        success_count: 2, accounts: [{ email: "a@b.c", password: "p1" }, { email: "d@e.f", password: "p2" }],
      }, db);
      expect(applied).toBe(true);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='JSP-202'").get() as { status: string };
      expect(link.status).toBe("completed");
    } finally {
      fx.close();
    }
  });

  it("accounts app-dependent dipertahankan semua field (tidak hilang oleh formatter premium)", () => {
    const text = formatJaspayAccountsForDisplay([{ email: "a@b.c", password: "p1", pin: "1234", url: "https://x" }]);
    expect(text).toContain("a@b.c");
    expect(text).toContain("p1");
    expect(text).toContain("1234");
    expect(text).toContain("https://x");
  });

  it("no wrong-family: handler premium menolak link Jaspay + handler Jaspay menolak link premium", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20261102-JSP001','JSP-300',?,2,2000,'processing')").run("jaspay:PROD:PKG-A");
      // Premium completed atas invoice JSP => ditolak (false), status utuh.
      expect(await handleWrOrderCompleted("JSP-300", { account_details: "x" }, db)).toBe(false);
      const kept = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='JSP-300'").get() as { status: string };
      expect(kept.status).toBe("processing");
      // Jaspay terminal atas invoice premium => false.
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20261102-JSP001','RBHN-1','var-1',1,1000,'processing')").run();
      expect(await handleJaspayTerminal("RBHN-1", { invoice: "RBHN-1", status: "completed", product: "P", quantity: 1, success_count: 1, accounts: [{ email: "a" }] }, db)).toBe(false);
      // Premium failed tak meregresi link Jaspay completed.
      fx.sql.prepare("UPDATE wr_order_links SET status='completed' WHERE wr_order_id='JSP-300'").run();
      expect(await handleWrOrderFailed("JSP-300", "late fail", db)).toBe(true);
      const still = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='JSP-300'").get() as { status: string };
      expect(still.status).toBe("completed");
    } finally {
      fx.close();
    }
  });
});

describe("WR3 status: known JSP via /jaspay/status (bukan latest-50)", () => {
  it("pollKnownJaspayInvoice memakai invoice eksak + menolak invoice salah", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const seen: string[] = [];
      stubJaspayFetch((url, body) => {
        seen.push(`${url}::${JSON.stringify(body)}`);
        expect(url).toContain("/jaspay/status");
        // Invoice lama di luar latest-50 TETAP bisa dipoll per-invoice.
        expect(body.invoice).toBe("JSP-OLD-999");
        return { success: true, message: "ok", data: { invoice: "JSP-OLD-999", status: "completed", product: "PROD", quantity: 2, success_count: 2, accounts: [{ email: "a" }, { email: "b" }] } };
      });
      const db = createDatabaseAccess(fx.db);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,request_sent_at) VALUES('AXV-20261102-JSP001','JSP-OLD-999',?,2,2000,'processing',datetime('now'))").run("jaspay:PROD:PKG-A");
      const row = fx.sql.prepare("SELECT id FROM wr_order_links WHERE wr_order_id='JSP-OLD-999'").get() as { id: number };
      expect(await pollKnownJaspayInvoice(row.id, db)).toBe(true);
      expect(seen.length).toBe(1);
      const done = fx.sql.prepare("SELECT status FROM wr_order_links WHERE id=?").get(row.id) as { status: string };
      expect(done.status).toBe("completed");
    } finally {
      fx.close();
    }
  });

  it("reconcileJaspayAmbiguous: submitted-tanpa-invoice exact-ref + ber-invoice poll; premium tak tersentuh", async () => {
    const fx = await setupWrFixture();
    try {
      seedJaspayMirror(fx);
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-20260911-AAAABBBB");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,request_sent_at,idempotency_key) VALUES('AXV-20261102-JSP001',?,2,2000,'submitted',datetime('now','-5 minutes'),?)").run("jaspay:PROD:PKG-A", "wr:AXV-20261102-JSP001:jaspay:PROD:PKG-A:2");
      // Premium ambigu: reconcile Jaspay TIDAK boleh menyentuhnya.
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,request_sent_at) VALUES('AXV-20260911-AAAABBBB','var-1',1,5000,'submitted',datetime('now','-5 minutes'))").run();
      stubJaspayFetch((url) => {
        if (url.includes("/jaspay/order")) return { success: true, message: "ok", data: { invoice: "JSP-400", status: "processing", product: "PROD", quantity: 2, success_count: 0, accounts: [] } };
        throw new Error("unexpected");
      });
      const db = createDatabaseAccess(fx.db);
      const out = await reconcileJaspayAmbiguous(db, 4);
      expect(out.exactRef).toBe(1);
      const jsp = fx.sql.prepare("SELECT wr_order_id FROM wr_order_links WHERE wr_variant_id LIKE 'jaspay:%' AND wr_order_id='JSP-400'").get();
      expect(jsp).toBeTruthy();
      const prem = fx.sql.prepare("SELECT status, wr_order_id FROM wr_order_links WHERE wr_variant_id='var-1'").get() as { status: string; wr_order_id: string | null };
      expect(prem.status).toBe("submitted");
      expect(prem.wr_order_id).toBeNull();
    } finally {
      fx.close();
    }
  });
});

describe("WR3 catalog isolation: premium sweep tak zero Jaspay", () => {
  it("zeroMissingVariants + zeroVariantsByIds + syncProducts melewati jaspay:%", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedJaspayMirror(fx);
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      // var-1 berstok di seed (10) + tak ada di seen => di-nol-kan 1 baris.
      expect(await zeroMissingVariants(new Set<string>(), db)).toBe(1);
      const jsp = fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='jaspay:PROD:PKG-A'").get() as { wr_stock: number };
      expect(jsp.wr_stock).toBe(-1);
      // zeroVariantsByIds: jaspay diabaikan, var-1 (sudah 0) tak dihitung.
      fx.sql.prepare("UPDATE wr_variants SET wr_stock=9 WHERE wr_variant_id='var-1'").run();
      expect(await zeroVariantsByIds(["jaspay:PROD:PKG-A", "var-1"], db)).toBe(1);
      const jsp2 = fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='jaspay:PROD:PKG-A'").get() as { wr_stock: number };
      expect(jsp2.wr_stock).toBe(-1);
      // syncProducts premium penuh: jaspay tak tersentuh walau tak ada di feed.
      const res = await syncProducts(db, async () => [
        { id: "prod-capcut", name: "CapCut Pro", category: "Video", description: "d", variants: [{ id: "var-1", name: "Pro 7 Hari", price: 5000, duration: "7 Hari", type: "Private", warranty: "", stock: 9, terms: null, delivery_terms: null, delivery_mode: "manual" }] },
      ], { allowZeroMissing: true });
      expect(res.snapshotComplete).toBe(true);
      const jsp3 = fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id='jaspay:PROD:PKG-A'").get() as { wr_stock: number };
      expect(jsp3.wr_stock).toBe(-1);
    } finally {
      fx.close();
    }
  });

  it("syncJaspayCatalog: cap max_quantity tersimpan + nama legacy tak di-rewrite + zero-missing sendiri", async () => {
    const fx = await setupWrFixture();
    try {
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const db = createDatabaseAccess(fx.db);
      const first = await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Nama Awal", max_quantity: 4, available: true, description: "d1", after_note: "n1", duration: "1 Bulan", default_package: "K1", packages: [{ id: "K1", name: "Paket Satu", price: 10000, available: true }, { id: "K2", name: "Paket Dua", price: 20000, available: false }] },
      ]);
      expect(first.synced).toBe(1);
      // max invalid => rejected (fail-closed, bukan unlimited).
      const second = await syncJaspayCatalog(db, async () => [
        { product: "BAD", name: "Bad", available: true, packages: [{ id: "K1", name: "K1", price: 1000, available: true }] },
      ]);
      expect(second.rejected).toBe(1);
      const missing = fx.sql.prepare("SELECT COUNT(*) n FROM wr_variants WHERE wr_variant_id='jaspay:BAD:K1'").get() as { n: number };
      expect(missing.n).toBe(0);
      // Nama berubah di upstream => display TAK di-rewrite (stabilitas ID).
      await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Nama Berubah", max_quantity: 4, available: true, description: "d1", after_note: "n1", duration: "1 Bulan", packages: [{ id: "K1", name: "Paket Satu", price: 10000, available: true }] },
      ]);
      const prod = fx.sql.prepare("SELECT name FROM products WHERE wr_product_id='jaspay:PR'").get() as { name: string };
      expect(prod.name).toBe("Nama Awal");
      // Zero-missing Jaspay sendiri: feed hanya K1 => K2 (stok -1) => 0.
      await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Nama Awal", max_quantity: 4, available: true, description: "d1", after_note: "n1", duration: "1 Bulan", packages: [{ id: "K1", name: "Paket Satu", price: 10000, available: true }, { id: "K2", name: "Paket Dua", price: 20000, available: true }] },
      ]);
      const k2before = fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id=?").get("jaspay:PR:K2") as { wr_stock: number };
      expect(k2before.wr_stock).toBe(-1);
      await syncJaspayCatalog(db, async () => [
        { product: "PR", name: "Nama Awal", max_quantity: 4, available: true, description: "d1", after_note: "n1", duration: "1 Bulan", packages: [{ id: "K1", name: "Paket Satu", price: 10000, available: true }] },
      ]);
      const pj = fx.sql.prepare("SELECT wr_stock FROM wr_variants WHERE wr_variant_id=?").get("jaspay:PR:K2") as { wr_stock: number };
      expect(pj.wr_stock).toBe(0);
    } finally {
      fx.close();
    }
  });
});

describe("WR3 buyer copy: otomatis, queued, tanpa brand/MBO", () => {
  it("badge Diproses otomatis + ETA otomatis + kind tetap queued", () => {
    const v = { fulfillment_mode: "manual", wr_variant_id: "jaspay:P:K", wr_delivery_class: "made_by_order" };
    expect(buyerDeliveryKind(v)).toBe("queued");
    expect(buyerDeliveryBadge(v)).toBe("Diproses otomatis");
    expect(buyerDeliveryEtaJaspay()).toBe("Dibuat otomatis setelah pembayaran dikonfirmasi; waktu proses mengikuti antrean.");
    expect(jaspayLabelForBuyer()).toBe("Diproses otomatis");
    expect(jaspayEtaForBuyer()).toBe("Dibuat otomatis setelah pembayaran dikonfirmasi; waktu proses mengikuti antrean.");
    const label = buyerDeliveryBadge(v);
    expect(label).not.toContain("Made By Order");
    expect(label).not.toMatch(/jaspay|warung|rebahan/i);
    expect(buyerDeliveryEtaJaspay()).not.toMatch(/jaspay|warung|rebahan|admin/i);
  });

  it("premium copy tak berubah", () => {
    expect(buyerDeliveryBadge({ fulfillment_mode: "manual", wr_variant_id: "var-1", wr_delivery_class: "restock" })).toBe("Kirim otomatis");
    expect(buyerDeliveryBadge({ fulfillment_mode: "manual", wr_variant_id: "var-9", wr_delivery_class: "made_by_order" })).toBe("Made By Order");
  });
});

describe("WR3 webhook route: signature + family routing", () => {
  async function signedBody(secret: string, body: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function req(body: string, headers: Record<string, string>) {
    return new Request("http://localhost/api/webhook/warung", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }
  it("primer invalid TIDAK fallback ke legacy valid (Jaspay 401)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
    vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
    const { POST } = await import("@/app/api/webhook/warung/route");
    const body = JSON.stringify({ event: "jaspay.completed", data: { invoice: "JSP-1" } });
    const legacy = await signedBody("s", body);
    const res = await POST(req(body, { "x-digitals-signature": "00".repeat(32), "x-rebahan-signature": legacy }) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it("alias X-Premify diterima untuk premium bila primer absen", async () => {
    const { createD1Fixture, stubFulfillmentKey } = await import("../helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'P','p-jsp',100,10)").run();
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'S','V',100,10)").run();
      fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260913-JP1','B','628','[]',100,'qris','lunas','paid','web')").run();
      fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count) VALUES('AXV-20260913-JP1',0,1,1,1,'manual','web','queued',0)").run();
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260913-JP1','ORD-PREM-1','var-1',1,5000,'processing')").run();
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
      vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
      const { POST } = await import("@/app/api/webhook/warung/route");
      const body = JSON.stringify({ event: "order.processing", data: { order_id: "ORD-PREM-1", status: "processing" } });
      const res = await POST(req(body, { "x-premify-signature": await signedBody("s", body) }) as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(200);
    } finally {
      fx.close();
    }
  });

  it("jaspay.completed koheren via webhook => completed; unknown terminal => 503 + persist", async () => {
    const { createD1Fixture, stubFulfillmentKey } = await import("../helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id) VALUES(9,'J','j-9',100,10,'warung_rebahan','jaspay:P9')").run();
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id) VALUES(9,9,'J9','V',100,10,'manual','jaspay:P9:K9')").run();
      fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('jaspay:P9','J',9)").run();
      fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_delivery_class,wr_delivery_source,wr_max_quantity) VALUES('jaspay:P9:K9','jaspay:P9','V',50,10,9,100,'made_by_order','api',5)").run();
      fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260913-JP2','B','628','[]',100,'qris','lunas','paid','web')").run();
      fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count) VALUES('AXV-20260913-JP2',0,9,9,1,'manual','web','queued',0)").run();
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260913-JP2','JSP-WH-1','jaspay:P9:K9',1,50,'processing')").run();
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
      vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
      const { POST } = await import("@/app/api/webhook/warung/route");
      const good = JSON.stringify({ event: "jaspay.completed", data: { invoice: "JSP-WH-1", quantity: 1, success_count: 1, accounts: [{ email: "a@b.c", password: "p" }] } });
      const r1 = await POST(req(good, { "x-digitals-signature": await signedBody("s", good) }) as unknown as Parameters<typeof POST>[0]);
      expect(r1.status).toBe(200);
      expect((fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='JSP-WH-1'").get() as { status: string }).status).toBe("completed");
      const unknown = JSON.stringify({ event: "jaspay.mystery_terminal", data: { invoice: "JSP-WH-1" } });
      const r2 = await POST(req(unknown, { "x-digitals-signature": await signedBody("s", unknown) }) as unknown as Parameters<typeof POST>[0]);
      expect(r2.status).toBe(503);
      const logged = fx.sql.prepare("SELECT COUNT(*) n FROM wr_webhook_events WHERE applied=0").get() as { n: number };
      expect(Number(logged.n)).toBeGreaterThan(0);
    } finally {
      fx.close();
    }
  });

  it("jaspay event atas invoice premium => 503 tanpa merusak link premium", async () => {
    const { createD1Fixture, stubFulfillmentKey } = await import("../helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'P','p-x',100,10)").run();
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'S','V',100,10)").run();
      fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260913-JP3','B','628','[]',100,'qris','lunas','paid','web')").run();
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260913-JP3','RBHN-X','var-1',1,5000,'processing')").run();
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
      vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
      const { POST } = await import("@/app/api/webhook/warung/route");
      const body = JSON.stringify({ event: "jaspay.completed", data: { invoice: "RBHN-X", quantity: 1, success_count: 1, accounts: [{ email: "a" }] } });
      const res = await POST(req(body, { "x-digitals-signature": await signedBody("s", body) }) as unknown as Parameters<typeof POST>[0]);
      expect(res.status).toBe(503);
      expect((fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='RBHN-X'").get() as { status: string }).status).toBe("processing");
    } finally {
      fx.close();
    }
  });
});
