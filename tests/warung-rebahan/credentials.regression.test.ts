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

// Lease pengiriman kredensial: baris 'sending' yang ditinggalkan run yang
// dibunuh platform harus bisa dipulihkan. Sebelum 2026-09-18 lease dihitung
// lalu dibuang dan recovery hanya memungut ('queued','failed'), sehingga
// link AXV-20260917-0D35043E terjebak di 'sending' sejak 17 Sep dan pembeli
// tidak pernah menerima detail akun.
describe("delivery kredensial — pemulihan lease 'sending' basi", () => {
  it("lease disimpan saat klaim, dan 'sending' basi dipulihkan lalu terkirim", async () => {
    const code = "AXV-20260918-CC000007";
    const fx = await seedCompletedWeb(code);
    try {
      const { processDueCredentialDeliveries, recoverStaleCredentialDeliveries } = await import(
        "@/lib/warung-rebahan/deliver"
      );
      const db = createDatabaseAccess(fx.db);
      const row = () =>
        fx.sql
          .prepare("SELECT delivery_status, delivery_next_attempt_at, delivery_attempt_count FROM wr_order_links WHERE order_code=?")
          .get(code) as Record<string, unknown>;

      // handleWrOrderCompleted sudah mengirim (web → capability token).
      expect(String(row().delivery_status)).toBe("delivered");

      // Simulasikan run yang dibunuh di tengah pengiriman: 'sending' dengan
      // lease yang sudah lewat.
      fx.sql
        .prepare(
          `UPDATE wr_order_links SET delivery_status='sending',
             delivery_next_attempt_at=datetime('now','-5 minutes') WHERE order_code=?`,
        )
        .run(code);

      // Lease basi → dikembalikan ke 'failed' agar masuk antrean lagi.
      expect(await recoverStaleCredentialDeliveries(db)).toBe(1);
      expect(String(row().delivery_status)).toBe("failed");

      // Cron memungutnya pada run yang sama dengan recovery.
      fx.sql
        .prepare(
          `UPDATE wr_order_links SET delivery_status='sending',
             delivery_next_attempt_at=datetime('now','-5 minutes') WHERE order_code=?`,
        )
        .run(code);
      const out = await processDueCredentialDeliveries(db);
      expect(out.recovered).toBe(1);
      expect(out.delivered).toBe(1);
      expect(String(row().delivery_status)).toBe("delivered");
      // Sukses membersihkan lease agar tidak dianggap due lagi.
      expect(row().delivery_next_attempt_at).toBeNull();
    } finally {
      fx.close();
    }
  });

  it("lease yang MASIH hidup tidak dirampas (tidak ada kirim ganda)", async () => {
    const code = "AXV-20260918-CC000008";
    const fx = await seedCompletedWeb(code);
    try {
      const { recoverStaleCredentialDeliveries } = await import("@/lib/warung-rebahan/deliver");
      const db = createDatabaseAccess(fx.db);
      fx.sql
        .prepare(
          `UPDATE wr_order_links SET delivery_status='sending',
             delivery_next_attempt_at=datetime('now','+2 minutes') WHERE order_code=?`,
        )
        .run(code);
      expect(await recoverStaleCredentialDeliveries(db)).toBe(0);
      const after = fx.sql
        .prepare("SELECT delivery_status FROM wr_order_links WHERE order_code=?")
        .get(code) as Record<string, unknown>;
      expect(String(after.delivery_status)).toBe("sending");
    } finally {
      fx.close();
    }
  });
});

// Panel "Detail Akun Digital" hanya untuk order yang detailnya benar-benar
// ada. Sebelum ini panel tampil untuk SEMUA order lunas (termasuk fulfillment
// manual yang tidak pernah punya wr_order_links) sehingga pembeli melihat form
// verifikasi WA yang pasti berakhir "not_ready" tepat setelah membayar.
describe("GET /api/orders?code= — flag credentials_ready", () => {
  const lookup = async (code: string) => {
    const { GET } = await import("@/app/api/orders/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest(`http://localhost/api/orders?code=${code}`) as never);
    return (await res.json()) as { order: { credentials_ready: boolean; status: string } };
  };

  it("order lunas dengan detail akun WR siap → true", async () => {
    const code = "AXV-20260918-CC000003";
    const fx = await seedCompletedWeb(code);
    try {
      const body = await lookup(code);
      expect(body.order.status).toBe("lunas");
      expect(body.order.credentials_ready).toBe(true);
    } finally {
      fx.close();
    }
  });

  it("order lunas fulfillment manual (tanpa link WR) → false", async () => {
    const code = "AXV-20260918-CC000004";
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, code, "web");
      const body = await lookup(code);
      expect(body.order.status).toBe("lunas");
      expect(body.order.credentials_ready).toBe(false);
    } finally {
      fx.close();
    }
  });

  it("order pending tidak memicu query WR sama sekali → false", async () => {
    const code = "AXV-20260918-CC000005";
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, code, "web");
      fx.sql.prepare("UPDATE orders SET status='pending',payment_status='unpaid' WHERE code=?").run(code);
      fx.control.fail = (query) => query.includes("wr_order_links");
      const body = await lookup(code);
      expect(body.order.credentials_ready).toBe(false);
    } finally {
      fx.control.fail = null;
      fx.close();
    }
  });

  it("D1 lama tanpa tabel WR → false, bukan 500", async () => {
    const code = "AXV-20260918-CC000006";
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, code, "web");
      fx.sql.exec("DROP TABLE wr_order_links");
      const body = await lookup(code);
      expect(body.order.credentials_ready).toBe(false);
    } finally {
      fx.close();
    }
  });
});
