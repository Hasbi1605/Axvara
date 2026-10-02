// tests/sk-order-flags-credential.test.ts — Flag pesanan SK + email kredensial SK.
//
// Laporan owner 2026-10-02 (uji belanja Sekalipay, Remini Pro + HideMyAss VPN):
// 1. Order SK auto lunas menampilkan "Made By Order — maksimal 12 jam" padahal
//    lisensinya kirim otomatis hitungan detik (badge katalog "Kirim otomatis"
//    benar, flag halaman salah). Akar: query flag GET /api/orders?code= masih
//    WR-only — varian SK (fulfillment_mode lokal 'manual', wr_variant_id NULL)
//    selalu jatuh ke queued=true + instant=false.
// 2. Buyer SK hanya menerima email "Pembayaran Diterima", tidak pernah menerima
//    email kredensial berisi lisensi (jalur WR/non-WR punya, SK tidak —
//    handleSkOrderCompleted tidak memanggil pengiriman email apa pun).
// 3. QRIS pending blank: tidak ada indikator polling / tombol cek manual.
//
// Test ini mengunci ketiganya di D1 nyata (node:sqlite) + render halaman.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

let fixture: ReturnType<typeof createD1Fixture>;

const line = (variantId: number | null, qty = 1) =>
  variantId === null
    ? { product_id: 1, name: "Produk lama tanpa varian", price: 2000, qty }
    : { product_id: 1, variant_id: variantId, name: `Varian ${variantId}`, price: 2000, qty };

function insertOrder(code: string, items: unknown[], status = "lunas") {
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, "Rani", "6281234567890", "rani@example.test", JSON.stringify(items), 2000, "qris", "DANA Business",
      status, status === "lunas" ? "paid" : "pending", "web");
}

async function flags(code: string) {
  const { GET } = await import("@/app/api/orders/route");
  const res = await GET(new NextRequest(`http://localhost/api/orders?code=${code}`, { headers: { "cf-connecting-ip": "203.0.113.7" } }));
  expect(res.status).toBe(200);
  const { order } = await res.json() as { order: Record<string, unknown> };
  return { instant: order.instant_delivery, queued: order.queued_delivery, creds: order.credentials_ready };
}

function seedSkCatalog() {
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Remini Pro','remini-pro-sk',3500,10,'manual','9',1)`);
  const variant = fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed)
    VALUES(?,1,?,?,2000,100,'manual',?,1)`);
  // Varian SK selalu fulfillment_mode lokal 'manual' (kontrak fulfillment hanya
  // manual/shared/unique) — pembeda auto vs antrean ada di sk_products.
  variant.run(10, "SKU-SK-AUTO", "7 Hari Sharing", "101");
  variant.run(11, "SKU-SK-MANUAL", "Private Manual", "102");
  fixture.sql.exec(`INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price)
    VALUES('101','9','Remini Pro','7 Hari Sharing',2225,10,'auto',1,10,3500),
          ('102','9','Remini Pro','Private Manual',2000,5,'manual',1,11,3000)`);
}

beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  clearRateLimitBucketsForTest();
  seedSkCatalog();
});
afterEach(() => {
  fixture.close();
  clearRateLimitBucketsForTest();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/orders?code= — flag SK auto vs antrean", () => {
  it("varian SK auto → instan (bukan Made By Order), halaman bisa spinner", async () => {
    insertOrder("AXV-20261002-SKAUTO01", [line(10)]);
    expect(await flags("AXV-20261002-SKAUTO01")).toEqual({ instant: true, queued: false, creds: false });
  });

  it("varian SK non-auto → antrean (tetap Made By Order)", async () => {
    insertOrder("AXV-20261002-SKMANU01", [line(11)]);
    expect(await flags("AXV-20261002-SKMANU01")).toMatchObject({ instant: false, queued: true });
  });

  it("campuran SK auto + manual → bukan instan, ikut antrean", async () => {
    insertOrder("AXV-20261002-SKMIX001", [line(10), line(11)]);
    expect(await flags("AXV-20261002-SKMIX001")).toMatchObject({ instant: false, queued: true });
  });

  it("varian hilang (id tak dikenal) → bukan instan palsu", async () => {
    insertOrder("AXV-20261002-SKGONE01", [line(99)]);
    expect(await flags("AXV-20261002-SKGONE01")).toMatchObject({ instant: false, queued: false });
  });
});

describe("SK completed → email kredensial Axvara (template Pesanan Siap)", () => {
  function seedSkLink(code: string) {
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES(?,0,1,10,1,'manual','web','rani@example.test','queued',0,datetime('now'))`).run(code);
    const itemId = Number((fixture.sql.prepare("SELECT id FROM fulfillment_items WHERE order_code=?").get(code) as { id: number }).id);
    fixture.sql.prepare(`INSERT INTO sk_order_links
      (order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,fulfillment_item_id,idempotency_key)
      VALUES(?,'101',1,2225,'processing',1,3,datetime('now'),?,'sk:link:1')`).run(code, itemId);
    const linkId = Number((fixture.sql.prepare("SELECT id FROM sk_order_links WHERE order_code=?").get(code) as { id: number }).id);
    return { itemId, linkId };
  }

  it("handleSkOrderCompleted menulis ciphertext + mengirim SATU email kredensial template Axvara", async () => {
    const code = "AXV-20261002-SKMAIL01";
    insertOrder(code, [line(10)]);
    const { linkId, itemId } = seedSkLink(code);
    // Bind link supaya settle tepat sasaran (webhook prod: link dibuat tanpa item).
    const { bindSkLinkToFulfillmentItem } = await import("@/lib/sekalipay/deliver");
    await bindSkLinkToFulfillmentItem(linkId, createDatabaseAccess(fixture.db));

    const sent: { to: string; subject: string; html: string; text: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.resend.com")) {
        sent.push(JSON.parse(String(init?.body)) as { to: string; subject: string; html: string; text: string });
        return { ok: true, json: async () => ({ id: "re_test" }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
    vi.stubEnv("SITE_URL", "https://axvara.tech");

    const { handleSkOrderCompleted } = await import("@/lib/sekalipay/deliver");
    const skInvoice = "SPY1790929768ANND";
    fixture.sql.prepare("UPDATE sk_order_links SET sk_invoice=? WHERE id=?").run(skInvoice, linkId);
    expect(await handleSkOrderCompleted(skInvoice, {
      id: 1, ref_id: `sk:${code}:101:1`, invoice: skInvoice, payment_method: "saldo", status: "completed",
      price: 2225, fees: 0, amount: 2225,
      items: [{
        variant_id: 101, variant_name: "7 Hari Sharing", product_name: "Remini Pro",
        product_license: "user@mail.com|pass123", seller_note: "Login memakai akun yang diberikan.",
        price: 2225, qty: 1, note: null, order_process: "auto" as const,
      }],
      h2h_results: [], smm_results: [],
    }, createDatabaseAccess(fixture.db))).toBe(true);

    // Panel: item delivered + ciphertext terisi.
    const item = fixture.sql.prepare("SELECT status, delivered_ciphertext, delivered_iv, sk_link_id FROM fulfillment_items WHERE id=?").get(itemId) as Record<string, unknown>;
    expect(String(item.status)).toBe("delivered");
    expect(String(item.delivered_ciphertext || "")).not.toBe("");
    expect(Number(item.sk_link_id)).toBe(linkId);
    // Flag halaman menyala.
    expect(await flags(code)).toMatchObject({ creds: true });
    // Email: SATU, template Axvara yang sama dengan WR/non-WR.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["rani@example.test"]);
    expect(sent[0].subject).toContain(code);
    expect(sent[0].subject.startsWith("Pesanan siap, ")).toBe(true);
    expect(sent[0].html).toContain("AXVARA");
    expect(sent[0].html).toContain("Lihat Pesanan");
    expect(sent[0].html).toContain("user@mail.com");
    expect(sent[0].html).toContain("pesananmu sudah siap.");
    expect(sent[0].html).toContain("PEMBAYARAN DITERIMA");
  });

  it("retry webhook tidak mengirim email kedua (idempoten per item)", async () => {
    const code = "AXV-20261002-SKMAIL02";
    insertOrder(code, [line(10)]);
    const { linkId } = seedSkLink(code);
    const { handleSkOrderCompleted } = await import("@/lib/sekalipay/deliver");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("api.resend.com")) { calls++; return { ok: true, json: async () => ({ id: "re_x" }) }; }
      throw new Error(`unexpected fetch ${url}`);
    }));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
    const skInvoice = "SPY1790929768BNNX";
    fixture.sql.prepare("UPDATE sk_order_links SET sk_invoice=? WHERE id=?").run(skInvoice, linkId);
    const detail = {
      id: 2, ref_id: `sk:${code}:101:1`, invoice: skInvoice, payment_method: "saldo", status: "completed",
      price: 2225, fees: 0, amount: 2225,
      items: [{ variant_id: 101, variant_name: "7 Hari Sharing", product_name: "Remini Pro", product_license: "LIC-1", seller_note: null, price: 2225, qty: 1, note: null, order_process: "auto" as const }],
      h2h_results: [], smm_results: [],
    } as never;
    const db = createDatabaseAccess(fixture.db);
    expect(await handleSkOrderCompleted(skInvoice, detail, db)).toBe(true);
    expect(await handleSkOrderCompleted(skInvoice, detail, db)).toBe(true);
    expect(calls).toBe(1);
  });

  it("buyer tanpa email = skip diam (panel tetap jalan), bukan throw", async () => {
    const code = "AXV-20261002-SKMAIL03";
    insertOrder(code, [line(10)]);
    fixture.sql.prepare("UPDATE orders SET customer_email='' WHERE code=?").run(code);
    const { linkId } = seedSkLink(code);
    const { handleSkOrderCompleted, sendSkCredentialEmail } = await import("@/lib/sekalipay/deliver");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("must not call resend"); }));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
    const skInvoice = "SPY1790929768CNNX";
    fixture.sql.prepare("UPDATE sk_order_links SET sk_invoice=? WHERE id=?").run(skInvoice, linkId);
    const db = createDatabaseAccess(fixture.db);
    expect(await handleSkOrderCompleted(skInvoice, {
      id: 3, ref_id: `sk:${code}:101:1`, invoice: skInvoice, payment_method: "saldo", status: "completed",
      price: 2225, fees: 0, amount: 2225,
      items: [{ variant_id: 101, variant_name: "7 Hari Sharing", product_name: "Remini Pro", product_license: "LIC-1", seller_note: null, price: 2225, qty: 1, note: null, order_process: "auto" as const }],
      h2h_results: [], smm_results: [],
    }, db)).toBe(true);
    expect(await flags(code)).toMatchObject({ creds: true });
    const itemId = Number((fixture.sql.prepare("SELECT id FROM fulfillment_items WHERE order_code=?").get(code) as { id: number }).id);
    expect(await sendSkCredentialEmail(code, itemId, db)).toBe(false);
  });
});

describe("notif buyer SK: diproses + saldo habis", () => {
  function seedBlockedOrder(code: string) {
    insertOrder(code, [line(10)]);
    fixture.sql.prepare(`INSERT INTO sk_order_links
      (order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key)
      VALUES(?,'101',1,2225,'blocked_balance',0,3,datetime('now'),?)`).run(code, `sk:${code}:101:1`);
  }

  it("notifyBuyerSkBlocked mengirim email branded Axvara (tanpa jejak supplier)", async () => {
    const code = "AXV-20261002-SKBLOK01";
    seedBlockedOrder(code);
    const sent: { subject: string; html: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.resend.com")) {
        sent.push(JSON.parse(String(init?.body)) as { subject: string; html: string });
        return { ok: true, json: async () => ({ id: "re_b" }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
    const { notifyBuyerSkBlocked } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerSkBlocked(code, createDatabaseAccess(fixture.db))).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(code);
    expect(sent[0].html).toContain("AXVARA");
    expect(sent[0].html.toLowerCase()).not.toContain("sekalipay");
  });

  it("notifyBuyerSkProcessing idempoten per invoice + copy tanpa ambiguitas", async () => {
    const code = "AXV-20261002-SKPROC01";
    insertOrder(code, [line(10)]);
    const bodies: string[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.resend.com")) {
        calls++;
        bodies.push(String(init?.body ?? ""));
        return { ok: true, json: async () => ({ id: "re_p" }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }));
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
    const { notifyBuyerSkProcessing } = await import("@/lib/notify-buyer");
    const db = createDatabaseAccess(fixture.db);
    expect(await notifyBuyerSkProcessing(code, "SPY-INV-1", db)).toBe(true);
    expect(await notifyBuyerSkProcessing(code, "SPY-INV-1", db)).toBe(true);
    expect(calls).toBe(1);
    expect(bodies).toHaveLength(1);
    const payload = JSON.parse(bodies[0]) as { html: string; text: string };
    expect(payload.html).toContain("Detail produk akan segera tersedia di email ini dan juga di halaman pesanan.");
    expect(payload.html).toContain("Tidak perlu menunggu — begitu siap, kami kabari lewat email ini.");
    expect(payload.html).not.toContain("Tidak perlu menunggu halaman ini terbuka");
  });
});

describe("webOrderAutoDelivered menghitung item SK sebagai auto", () => {
  it("order SK delivered tidak memicu email tanda terima kedua", async () => {
    const code = "AXV-20261002-SKAUTO02";
    insertOrder(code, [line(10)]);
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_message_id,delivered_ciphertext,delivered_iv)
      VALUES(?,0,1,10,1,'manual','web','delivered',?,?,?)`).run(code, "sk:9", "ct", "iv");
    const { webOrderAutoDelivered } = await import("@/lib/fulfillment/delivery/buyer-email");
    expect(await webOrderAutoDelivered(code, createDatabaseAccess(fixture.db))).toBe(true);
  });
});
