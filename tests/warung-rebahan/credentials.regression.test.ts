import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { handleWrOrderCompleted } from "@/lib/warung-rebahan/deliver";
import {
  seedWrCatalog,
  seedWrFulfillmentItem,
  seedWrOrder,
  setupWrFixture,
} from "./helpers";

// Test regresi: retrieval kredensial web butuh verifikasi (bukan kode saja).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedCompletedWeb(code: string) {
  const fx = await setupWrFixture();
  seedWrCatalog(fx);
  seedWrOrder(fx, code, "web");
  seedWrFulfillmentItem(fx, code);
  fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES(?,?, 'var-1',1,5000,'processing')").run(code, `ORD-${code.slice(-4)}`);
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
  const db = createDatabaseAccess(fx.db);
  expect(await handleWrOrderCompleted(`ORD-${code.slice(-4)}`, "EMAIL:u@x.id PASS:s3cret", db)).toBe(true);
  return fx;
}

describe("POST /api/orders/[code]/credentials", () => {
  it("tanpa WA / WA salah → 403; WA benar → details + token", async () => {
    const fx = await seedCompletedWeb("AXV-20260913-CC000001");
    try {
      const { POST } = await import("@/app/api/orders/[code]/credentials/route");
      const params = { params: Promise.resolve({ code: "AXV-20260913-CC000001" }) };
      const mkReq = (body: unknown) =>
        new Request("http://localhost/api/orders/AXV-20260913-CC000001/credentials", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const noWa = await POST(mkReq({}) as never, params);
      expect(noWa.status).toBe(403);
      const wrong = await POST(mkReq({ wa: "081111111111" }) as never, params);
      expect(wrong.status).toBe(403);
      // Nomor saat checkout: 628000000000 (lihat helpers seedWrOrder).
      // Token capability sudah diterbitkan otomatis saat completed (idempoten
      // → POST tidak memberi raw baru). Revoke dulu agar alur penuh teruji.
      fx.sql.prepare("UPDATE wr_credential_tokens SET revoked=1 WHERE order_code='AXV-20260913-CC000001'").run();
      const ok = await POST(mkReq({ wa: "080000000000" }) as never, params);
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { credentials: { details: string }[]; capability_token: string | null };
      expect(body.credentials.length).toBe(1);
      expect(body.credentials[0].details).toContain("s3cret");
      expect(body.capability_token).toBeTruthy();
      // Akses ulang via token.
      const { GET } = await import("@/app/api/orders/[code]/credentials/route");
      const { NextRequest } = await import("next/server");
      const reuse = await GET(
        new NextRequest(`http://localhost/api/orders/AXV-20260913-CC000001/credentials?token=${body.capability_token}`) as never,
        params,
      );
      expect(reuse.status).toBe(200);
      const bad = await GET(
        new NextRequest("http://localhost/api/orders/AXV-20260913-CC000001/credentials?token=salah0000000000000000000000000000000000000000000000000000") as never,
        params,
      );
      expect(bad.status).toBe(403);
    } finally {
      fx.close();
    }
  });

  it("order belum lunas / belum ready → ditolak", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260913-CC000002','B','628000000000','[]',100,'qris','pending','unpaid','web')`).run();
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      const { POST } = await import("@/app/api/orders/[code]/credentials/route");
      const res = await POST(
        new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wa: "628000000000" }) }) as never,
        { params: Promise.resolve({ code: "AXV-20260913-CC000002" }) },
      );
      expect(res.status).toBe(403);
    } finally {
      fx.close();
    }
  });
});
