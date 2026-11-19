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
  expect(serialized).not.toMatch(/idem-secret|secret|receipt|can_retry/);
});
