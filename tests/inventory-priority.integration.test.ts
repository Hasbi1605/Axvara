import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { importInventory, reorderInventory, reserveInventory, releaseInventory } from "@/lib/fulfillment/inventory";
import { createDatabaseAccess } from "@/lib/db-access";
import { createOrderWithStock } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "admin@example.com" })) }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function setup() {
  const fx = createD1Fixture(); stubFulfillmentKey();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Private','private',10000,10);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(1,1,'ONE','One',10000,10,'unique'),(2,1,'TWO','Two',10000,10,'unique')`);
  await importInventory(1, ["FIRST-SECRET", "SECOND-SECRET", "LAST-SECRET"], 1);
  await importInventory(1, ["OTHER-VARIANT"], 2);
  return fx;
}
function ids(fx: ReturnType<typeof createD1Fixture>) {
  return fx.sql.prepare("SELECT id FROM fulfillment_inventory WHERE variant_id=1 AND status='available' ORDER BY COALESCE(sort_order,id),id").all().map(row => Number(row.id));
}

describe("unique credential priority", () => {
  it("persists last-to-first priority and web checkout reserves the new first credential", async () => {
    const fx = await setup();
    try {
      expect(await reorderInventory(1, 1, [3, 1, 2])).toBe(true);
      expect(ids(fx)).toEqual([3, 1, 2]);
      const { GET } = await import("@/app/api/admin/fulfillment/route");
      const response = await GET(new NextRequest("http://localhost/api/admin/fulfillment?product_id=1&variant_id=1"));
      expect((await response.json()).inventory.map((row: { secret: string }) => row.secret)).toEqual(["LAST-SECRET", "FIRST-SECRET", "SECOND-SECRET"]);
      await createOrderWithStock({ code: "AXV-PRIORITY", quoteId: "priority", customerName: "Buyer", customerWa: "6281234567890", customerEmail: null,
        items: [{ product_id: 1, variant_id: 1, name: "Private", price: 10000, qty: 1 }], subtotal: 10000,
        paymentMethod: "qris", paymentAccount: "Fixture", proofUrl: null });
      expect(fx.sql.prepare("SELECT id FROM fulfillment_inventory WHERE status='reserved'").get()?.id).toBe(3);
    } finally { fx.close(); }
  });

  it("reserve/release preserves priority, and new imports append after the reordered queue", async () => {
    const fx = await setup();
    try {
      await reorderInventory(1, 1, [3, 2, 1]);
      expect(await reserveInventory(1, "ORDER", 1)).toBe(3);
      expect(await reorderInventory(1, 1, [3, 2, 1])).toBe(false);
      await releaseInventory(3);
      await importInventory(1, ["APPENDED-SECRET"], 1);
      expect(ids(fx)).toEqual([3, 2, 1, 5]);
      expect(await reserveInventory(1, "NEXT", 1)).toBe(3);
      expect(await reserveInventory(1, "THIRD", 1)).toBe(2);
    } finally { fx.close(); }
  });

  it.each([[1, 1, 2], [1, 2, 4], [1, 2], [1, 2, 999]])("rejects duplicate, cross-variant, incomplete and missing IDs: %j", async (...order) => {
    const fx = await setup();
    try { expect(await reorderInventory(1, 1, order)).toBe(false); expect(ids(fx)).toEqual([1, 2, 3]); }
    finally { fx.close(); }
  });

  it("does not partially reorder if checkout reserves a credential between the read and write", async () => {
    const fx = await setup();
    try {
      const db = createDatabaseAccess(fx.db);
      const exec = db.execRun;
      db.execRun = async (sql, ...params) => {
        fx.sql.exec("UPDATE fulfillment_inventory SET status='reserved',order_code='RACE' WHERE id=2");
        return exec(sql, ...params);
      };
      expect(await reorderInventory(1, 1, [3, 1, 2], db)).toBe(false);
      expect(fx.sql.prepare("SELECT sort_order FROM fulfillment_inventory WHERE variant_id=1").all().every(row => row.sort_order === null)).toBe(true);
    } finally { fx.close(); }
  });

  it("admin API validates payload, authenticates and returns conflict for changed stock", async () => {
    const fx = await setup();
    try {
      const { POST } = await import("@/app/api/admin/fulfillment/route");
      const request = (order: unknown) => new NextRequest("http://localhost/api/admin/fulfillment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reorder", product_id: 1, variant_id: 1, inventory_ids: order }) });
      expect((await POST(request([3, 1, 2]))).status).toBe(200);
      expect((await POST(request([1, 1, 2]))).status).toBe(400);
      expect((await POST(request([1, 2, 4]))).status).toBe(409);
      vi.mocked(requireAdmin).mockResolvedValueOnce(null);
      expect((await POST(request([1, 2, 3]))).status).toBe(401);
    } finally { fx.close(); }
  });

  it("bulk delete revokes only available credentials of the requested variant and syncs stock", async () => {
    const fx = await setup();
    try {
      await reserveInventory(1, "HELD", 1); // id 1 keburu dipesan
      const { DELETE } = await import("@/app/api/admin/fulfillment/route");
      const request = (body: unknown) => new NextRequest("http://localhost/api/admin/fulfillment", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      // id 4 milik varian lain: tidak boleh ikut terhapus walau dikirim.
      const response = await DELETE(request({ product_id: 1, variant_id: 1, inventory_ids: [1, 2, 4] }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, revoked: 1, skipped: 2 });
      const status = (id: number) => fx.sql.prepare("SELECT status FROM fulfillment_inventory WHERE id=?").get(id)?.status;
      expect([status(1), status(2), status(3), status(4)]).toEqual(["reserved", "revoked", "available", "available"]);
      expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(1);
      expect(await (await DELETE(request({ product_id: 1, variant_id: 1, inventory_ids: [3] }))).json()).toMatchObject({ revoked: 1, skipped: 0 });
      expect(status(3)).toBe("revoked");
    } finally { fx.close(); }
  });

  it.each([
    [{ product_id: 1, variant_id: 1, inventory_ids: [] }],
    [{ product_id: 1, variant_id: 1, inventory_ids: [2, 2] }],
    [{ product_id: 1, variant_id: 1, inventory_ids: [0] }],
    [{ product_id: 1, variant_id: 1, inventory_ids: Array.from({ length: 101 }, (_, i) => i + 1) }],
    [{ variant_id: 1, inventory_ids: [2] }],
    [{ product_id: 1, variant_id: 1, inventory_ids: "2" }],
  ])("bulk delete rejects invalid payload %j without touching stock", async body => {
    const fx = await setup();
    try {
      const { DELETE } = await import("@/app/api/admin/fulfillment/route");
      const response = await DELETE(new NextRequest("http://localhost/api/admin/fulfillment", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect(response.status).toBe(400);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM fulfillment_inventory WHERE status='revoked'").get()?.n).toBe(0);
    } finally { fx.close(); }
  });

  it("bulk delete requires an admin session", async () => {
    const fx = await setup();
    try {
      const { DELETE } = await import("@/app/api/admin/fulfillment/route");
      vi.mocked(requireAdmin).mockResolvedValueOnce(null);
      const response = await DELETE(new NextRequest("http://localhost/api/admin/fulfillment", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ product_id: 1, variant_id: 1, inventory_ids: [2] }) }));
      expect(response.status).toBe(401);
      expect(fx.sql.prepare("SELECT status FROM fulfillment_inventory WHERE id=2").get()?.status).toBe("available");
    } finally { fx.close(); }
  });
});
