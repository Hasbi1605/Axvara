// Pesanan admin memuat status link StoreBat/Mirai/AIVault (19 Nov 2026) agar
// masalah supplier panel terlihat tanpa membuka Antrean. Hanya metadata status;
// receipt/invite/idempotency tidak pernah ikut terkirim.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { GET as listOrders } from "@/app/api/admin/orders/route";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql);
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  insertTestOrder(fixture.sql, "AXV-20261119-PANEL001", { status: "lunas" });
  fixture.sql.exec(`
    INSERT INTO storebat_order_links(id,order_code,item_index,variant_id,product_id,storebat_product_id,kind,quantity,cost_usd,fx_idr_per_usd,idempotency_key,provider_order_id,status,attempt_count,last_error,receipt_json)
      VALUES(7,'AXV-20261119-PANEL001',0,1,1,55,'product',1,0.5,16000,'idem-secret','SB-9','needs_admin',1,'attempts_exhausted','{"secret":"x"}');
    INSERT INTO mirai_order_links(id,order_code,item_index,variant_id,product_id,package_code,quantity,cost_usdt,external_order_id,idempotency_key,status)
      VALUES(8,'AXV-20261119-PANEL001',1,1,1,'PKG',1,1,'ext-1','idem-2','processing');
    INSERT INTO aivault_order_links(id,order_code,item_index,variant_id,product_id,service_id,quantity,cost_usd,external_order_id,status,completed_at)
      VALUES(9,'AXV-20261119-PANEL001',2,1,1,'svc',1,1,'ext-2','completed',datetime('now'));`);
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); });

it("lists StoreBat, Mirai and AIVault links with status-only metadata", async () => {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  const response = await listOrders(new NextRequest("https://axvara.tech/api/admin/orders?status=lunas", {
    headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { orders: { code: string; supplier_links: Record<string, unknown>[] }[] };
  const links = body.orders.find(order => order.code === "AXV-20261119-PANEL001")!.supplier_links;
  expect(links).toEqual([
    expect.objectContaining({ supplier: "storebat", id: 7, item_index: 0, status: "needs_admin", last_error: "attempts_exhausted", supplier_order_id: "SB-9" }),
    expect.objectContaining({ supplier: "mirai", id: 8, item_index: 1, status: "processing", supplier_order_id: null }),
    expect.objectContaining({ supplier: "aivault", id: 9, item_index: 2, status: "completed" }),
  ]);
  const serialized = JSON.stringify(links);
  expect(serialized).not.toMatch(/idem-secret|secret|receipt|can_retry|resolved_manually/);
});

it("marks non-completed tunvn/storebat/mirai/aivault links as resolved_manually only when matching fulfillment_items row is delivered", async () => {
  insertTestOrder(fixture.sql, "AXV-20261119-0FC3511A", { status: "lunas" });
  fixture.sql.exec(`
    INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,status,delivered_message_id,last_error) VALUES
      ('AXV-20261119-0FC3511A',0,1,1,10,'manual','delivered','manual','manual_handover:admin'),
      ('AXV-20261119-0FC3511A',1,1,1,1,'manual','delivered','manual','manual_handover:admin'),
      ('AXV-20261119-0FC3511A',2,1,1,1,'manual','delivered','manual','manual_handover:admin'),
      ('AXV-20261119-0FC3511A',3,1,1,1,'manual','delivered','manual','manual_handover:admin'),
      ('AXV-20261119-0FC3511A',4,1,1,1,'manual','delivered','manual','manual_handover:admin'),
      ('AXV-20261119-0FC3511A',5,1,1,1,'manual','manual_required',NULL,'supplier_needs_admin');
    INSERT INTO tunvn_order_links(id,order_code,item_index,variant_id,product_id,kind,quantity,cost_usdt,fx_idr_per_usdt,invite_code,status,attempt_count,last_error,receipt_json) VALUES
      (39,'AXV-20261119-0FC3511A',0,1,1,'buff',10,0.583,18258.44,'INVITE1','needs_admin',1,'unconfirmed_buff_receipt','{"raw":"secret"}'),
      (40,'AXV-20261119-0FC3511A',4,1,1,'account',1,1,18000,NULL,'completed',1,NULL,'{"raw":"secret"}'),
      (41,'AXV-20261119-0FC3511A',5,1,1,'account',1,1,18000,NULL,'needs_admin',1,'dispatch_unconfirmed',NULL);
    INSERT INTO storebat_order_links(id,order_code,item_index,variant_id,product_id,storebat_product_id,kind,quantity,cost_usd,fx_idr_per_usd,idempotency_key,provider_order_id,status,attempt_count,last_error,receipt_json)
      VALUES(17,'AXV-20261119-0FC3511A',1,1,1,55,'product',1,0.5,16000,'idem-sb','SB-17','needs_admin',1,'attempts_exhausted','{"secret":"sb"}');
    INSERT INTO mirai_order_links(id,order_code,item_index,variant_id,product_id,package_code,quantity,cost_usdt,external_order_id,idempotency_key,status,attempt_count,last_error)
      VALUES(18,'AXV-20261119-0FC3511A',2,1,1,'PKG',1,1,'ext-18','idem-mr','needs_admin',1,'attempts_exhausted');
    INSERT INTO aivault_order_links(id,order_code,item_index,variant_id,product_id,service_id,quantity,cost_usd,external_order_id,status,attempt_count,last_error)
      VALUES(19,'AXV-20261119-0FC3511A',3,1,1,'svc',1,1,'ext-19','needs_admin',1,'attempts_exhausted');
  `);
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  const response = await listOrders(new NextRequest("https://axvara.tech/api/admin/orders?status=lunas&limit=25", {
    headers: { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` },
  }));
  expect(response.status).toBe(200);
  const body = await response.json() as { orders: { code: string; supplier_links: Record<string, unknown>[] }[] };
  const links = body.orders.find(order => order.code === "AXV-20261119-0FC3511A")!.supplier_links;
  expect(links).toEqual([
    expect.objectContaining({ supplier: "tunvn", id: 39, item_index: 0, status: "needs_admin", resolved_manually: true }),
    expect.objectContaining({ supplier: "tunvn", id: 40, item_index: 4, status: "completed" }),
    expect.objectContaining({ supplier: "tunvn", id: 41, item_index: 5, status: "needs_admin" }),
    expect.objectContaining({ supplier: "storebat", id: 17, item_index: 1, status: "needs_admin", resolved_manually: true }),
    expect.objectContaining({ supplier: "mirai", id: 18, item_index: 2, status: "needs_admin", resolved_manually: true }),
    expect.objectContaining({ supplier: "aivault", id: 19, item_index: 3, status: "needs_admin", resolved_manually: true }),
  ]);
  expect(links.find(l => l.id === 40)?.resolved_manually).toBeUndefined();
  expect(links.find(l => l.id === 41)?.resolved_manually).toBeUndefined();
  expect(JSON.stringify(links)).not.toMatch(/INVITE1|idem-sb|idem-mr|secret/);
});
