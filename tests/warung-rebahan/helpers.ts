import { createD1Fixture, stubFulfillmentKey } from "../helpers/d1-fixture";

/** Setup standar test WR: schema.sql sudah final (0027+0028+0029 inline),
 * jadi cukup fixture + kunci enkripsi. Migrasi manual hanya untuk test
 * migrasi khusus (lihat wr-migrations.regression.test.ts). */
export async function setupWrFixture() {
  const fx = createD1Fixture();
  stubFulfillmentKey();
  return fx;
}

export function seedWrCatalog(fx: ReturnType<typeof createD1Fixture>) {
  fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock,source,wr_product_id,wr_auto_managed) VALUES(1,'CapCut Pro','capcut-pro',7500,10,'warung_rebahan','prod-capcut',1)").run();
  fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,wr_variant_id,wr_auto_managed) VALUES(1,1,'WR-VAR1','Pro 7 Hari',7500,10,'manual','var-1',1)").run();
  fx.sql.prepare("INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-capcut','CapCut Pro',1)").run();
  fx.sql.prepare("INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price) VALUES('var-1','prod-capcut','Pro 7 Hari',5000,10,1,7500)").run();
}

export function seedWrOrder(fx: ReturnType<typeof createD1Fixture>, code: string, channel = "web") {
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at) VALUES(?,?,?,?,?,?,'lunas','paid',?,'queued',1,datetime('now'))`)
    .run(code, "Buyer", "628000000000", JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro — Pro 7 Hari", price: 7500, qty: 1 }]), 7500, "qris", channel);
}

export function seedWrFulfillmentItem(fx: ReturnType<typeof createD1Fixture>, code: string) {
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count,next_attempt_at) VALUES(?,0,1,1,1,'manual','web','queued',0,datetime('now'))`).run(code);
}
