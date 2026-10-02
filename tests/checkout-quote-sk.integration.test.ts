// tests/checkout-quote-sk.integration.test.ts — Quote checkout untuk varian SK.
//
// Regresi 2026-10-02 (laporan owner + screenshot): Prime Video SK auto badge
// PDP "Kirim otomatis" benar, tapi laman checkout menampilkan blok
// "Made By Order — maksimal 12 jam". Akar: quote hanya JOIN wr_variants +
// isQueuedFulfillment hanya melihat fulfillment_mode lokal ('manual' untuk
// semua SK) — SK auto selalu queued=true.
//
// Dikunci di D1 nyata (node:sqlite) lewat POST /api/checkout/quote sungguhan.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

let fixture: ReturnType<typeof createD1Fixture>;

async function quote(variantId: number) {
  const { POST } = await import("@/app/api/checkout/quote/route");
  const res = await POST(new NextRequest("http://localhost/api/checkout/quote", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
    body: JSON.stringify({
      items: [{ slug: "prime-video-sk", variant_id: variantId, qty: 1, expected_price: variantId === 10 ? 3000 : 9000 }],
    }),
  }));
  const body = await res.json() as { ok: boolean; items: { queued_delivery: boolean; name: string }[] };
  return { status: res.status, body };
}

beforeEach(() => {
  fixture = createD1Fixture();
  clearRateLimitBucketsForTest();
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock,source,sk_product_id,sk_auto_managed) VALUES(1,'Prime Video','prime-video-sk',3000,17,'manual','7',1)`);
  fixture.sql.exec(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,sk_auto_managed)
    VALUES(10,1,'SK-701','1 Bulan Sharing',3000,15,'manual','701',1),
          (11,1,'SK-702','1 Bulan Private',9000,2,'manual','702',1)`);
  fixture.sql.exec(`INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price)
    VALUES('701','7','Prime Video','1 Bulan Sharing',2000,15,'auto',1,10,3000),
          ('702','7','Prime Video','1 Bulan Private',6000,2,'manual',1,11,9000)`);
  fixture.sql.exec(`INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)`);
  fixture.sql.exec(`UPDATE payment_methods SET is_active=1 WHERE id='qris'`);
});
afterEach(() => { fixture.close(); clearRateLimitBucketsForTest(); });

describe("POST /api/checkout/quote — flag queued_delivery untuk SK", () => {
  it("SK auto → queued_delivery=false (blok MBO tidak tampil di checkout)", async () => {
    const { status, body } = await quote(10);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].queued_delivery).toBe(false);
  });

  it("SK non-auto → queued_delivery=true (blok MBO tetap tampil jujur)", async () => {
    const { status, body } = await quote(11);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.items[0].queued_delivery).toBe(true);
  });
});
