// tests/order-instant-delivery.integration.test.ts — Flag `instant_delivery`
// di GET /api/orders?code= (laporan owner 2026-09-25: order Canva kirim
// otomatis menampilkan "Estimasi 5–15 menit" dan detailnya baru muncul setelah
// refresh). Flag ini memberi tahu halaman pesanan bahwa SEMUA baris dikirim dari
// stok sendiri (varian non-WR shared/unique), jadi halaman memeriksa rapat dan
// tidak memakai estimasi milik produk WR. Dikunci di D1 nyata (node:sqlite).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
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

beforeEach(() => {
  fixture = createD1Fixture();
  clearRateLimitBucketsForTest();
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Canva Pro','canva-pro',2000,100)`);
  fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wr-p','Netflix Premium')`);
  fixture.sql.exec(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class,wr_delivery_source)
    VALUES('wr-restock','wr-p','Netflix 1 Bulan',8000,'restock','admin'),('wr-mbo','wr-p','Netflix Private',9000,'made_by_order','admin')`);
  const variant = fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id)
    VALUES(?,1,?,?,2000,100,?,?)`);
  variant.run(1, "SKU-1", "Invite 1 Bulan", "shared", null);
  variant.run(2, "SKU-2", "Lisensi", "unique", null);
  variant.run(3, "SKU-3", "Head 1 Bulan", "manual", null);
  // Mode lokal varian WR sengaja `shared`: baris WR tidak pernah instan apa pun modenya.
  variant.run(4, "SKU-4", "Netflix 1 Bulan", "shared", "wr-restock");
  variant.run(5, "SKU-5", "Netflix Private", "shared", "wr-mbo");
});
afterEach(() => { fixture.close(); clearRateLimitBucketsForTest(); });

describe("GET /api/orders?code= — flag instant_delivery", () => {
  it("semua baris dari stok sendiri (shared/unique non-WR) → instan", async () => {
    insertOrder("AXV-20260925-INSTANT1", [line(1)]);
    insertOrder("AXV-20260925-INSTANT2", [line(1), line(2, 2)]);
    expect(await flags("AXV-20260925-INSTANT1")).toEqual({ instant: true, queued: false, creds: false });
    expect(await flags("AXV-20260925-INSTANT2")).toMatchObject({ instant: true, queued: false });
  });

  it("baris WR (restock maupun antrean), Made By Order, tanpa varian, atau varian hilang → bukan instan", async () => {
    insertOrder("AXV-20260925-WRSTOCK1", [line(4)]);
    insertOrder("AXV-20260925-MIXEDWR1", [line(1), line(4)]);
    insertOrder("AXV-20260925-MANUAL01", [line(3)]);
    insertOrder("AXV-20260925-WRMBO001", [line(5)]);
    insertOrder("AXV-20260925-NOVARIAN", [line(null)]);
    insertOrder("AXV-20260925-GONEVAR1", [line(99)]);
    expect(await flags("AXV-20260925-WRSTOCK1")).toMatchObject({ instant: false, queued: false });
    expect(await flags("AXV-20260925-MIXEDWR1")).toMatchObject({ instant: false, queued: false });
    expect(await flags("AXV-20260925-MANUAL01")).toMatchObject({ instant: false, queued: true });
    expect(await flags("AXV-20260925-WRMBO001")).toMatchObject({ instant: false, queued: true });
    expect(await flags("AXV-20260925-NOVARIAN")).toMatchObject({ instant: false, queued: false });
    expect(await flags("AXV-20260925-GONEVAR1")).toMatchObject({ instant: false, queued: false });
  });

  it("items kosong dan order belum lunas → false, bukan instan palsu", async () => {
    insertOrder("AXV-20260925-EMPTYITM", []);
    insertOrder("AXV-20260925-PENDING1", [line(1)], "pending");
    expect((await flags("AXV-20260925-EMPTYITM")).instant).toBe(false);
    expect((await flags("AXV-20260925-PENDING1")).instant).toBe(false);
  });

  it("tetap satu query flag: detail siap dan instan terbaca bersama", async () => {
    insertOrder("AXV-20260925-READYNOW", [line(1)]);
    fixture.sql.prepare(`INSERT INTO fulfillment_items (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_message_id,delivered_ciphertext,delivered_iv)
      VALUES (?,0,1,1,1,'shared','web','delivered','item:1','ciphertext','iv')`).run("AXV-20260925-READYNOW");
    fixture.control.queries = 0;
    expect(await flags("AXV-20260925-READYNOW")).toEqual({ instant: true, queued: false, creds: true });
    // Baris order + satu query gabungan flag (batas D1 per invocation).
    expect(fixture.control.queries).toBe(2);
  });
});
