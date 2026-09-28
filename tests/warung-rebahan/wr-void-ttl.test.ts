import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { createD1Fixture } from "../helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { reconcileBlockedBalance, WR_BLOCKED_MAX_AGE_HOURS } from "@/lib/warung-rebahan/order";
import { seedWrCatalog, seedWrOrder, setupWrFixture } from "./helpers";

// Scope B (2026-09-28, zombie-order fix): route void CAS + TTL auto-revive
// + kabar buyer saat blocked_balance.
async function adminRequest(path: string, init?: RequestInit): Promise<NextRequest> {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  const { NextRequest } = await import("next/server");
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-secret-admin-warung");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(sid);
  const headers = new Headers(init?.headers);
  headers.set("cookie", `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`);
  const { signal: _signal, ...rest } = init ?? {};
  void _signal;
  return new NextRequest(`http://localhost${path}`, { ...rest, headers });
}

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fixture = createD1Fixture();
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
});

afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seedBlockedLink(code: string, opts: { updatedAgo?: string; orderStatus?: string; cost?: number } = {}) {
  const { sql } = fixture;
  sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES(?,?,?,?,?,?,?,?)")
    .run(code, "B", "628000000000", "[]", 100, "qris", opts.orderStatus ?? "lunas", opts.orderStatus === "lunas" || !opts.orderStatus ? "paid" : "pending");
  sql.prepare(`INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,updated_at) VALUES(?,?,?,?, 'blocked_balance',0,3, ${opts.updatedAgo ?? "datetime('now')"})`)
    .run(code, "var-1", 1, opts.cost ?? 5000);
  return Number((sql.prepare("SELECT id FROM wr_order_links WHERE order_code=?").get(code) as { id: number }).id);
}

function stubBalance(balance: number) {
  // Mode langsung (tanpa proxy) butuh API key, kalau tidak wrFetch melempar
  // sebelum fetch tersentuh (lihat client.ts getWrApiKey).
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/balance")) {
        return { ok: true, json: async () => ({ success: true, message: "ok", data: { balance, currency: "IDR" } }) };
      }
      return { ok: true, json: async () => ({ success: false, message: "Saldo tidak mencukupi", data: null }) };
    }),
  );
}

describe("B: POST void CAS", () => {
  it("void sukses: pending → failed + cancelled_by_admin, lease dibersihkan", async () => {
    fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-VOID-1','B','628','[]',100,'qris','lunas','paid')").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,lease_owner,lease_expires_at,request_sent_at) VALUES('AXV-VOID-1','var-1',1,5000,'pending',0,3,'w','x','y')").run();
    const linkId = Number((fixture.sql.prepare("SELECT id FROM wr_order_links").get() as { id: number }).id);
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/void/route");
    const res = await POST(
      await adminRequest(`/api/admin/warung/orders/${linkId}/void`, { method: "POST" }),
      { params: Promise.resolve({ id: String(linkId) }) },
    );
    expect(res.status).toBe(200);
    const row = fixture.sql.prepare("SELECT status, last_error, lease_owner, request_sent_at FROM wr_order_links WHERE id=?").get(linkId) as Record<string, unknown>;
    expect(row.status).toBe("failed");
    expect(row.last_error).toBe("cancelled_by_admin");
    expect(row.lease_owner).toBeNull();
    expect(row.request_sent_at).toBeNull();
  });

  it("void link blocked_balance sukses; terminal (completed/failed) ditolak 409", async () => {
    fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-VOID-2','B','628','[]',100,'qris','lunas','paid')").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-VOID-2','var-1',1,5000,'blocked_balance')").run();
    const blockedId = Number((fixture.sql.prepare("SELECT id FROM wr_order_links WHERE order_code='AXV-VOID-2'").get() as { id: number }).id);
    fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-VOID-3','B','628','[]',100,'qris','lunas','paid')").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-VOID-3','var-1',1,5000,'completed')").run();
    const doneId = Number((fixture.sql.prepare("SELECT id FROM wr_order_links WHERE order_code='AXV-VOID-3'").get() as { id: number }).id);
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/void/route");
    const ok = await POST(
      await adminRequest(`/api/admin/warung/orders/${blockedId}/void`, { method: "POST" }),
      { params: Promise.resolve({ id: String(blockedId) }) },
    );
    expect(ok.status).toBe(200);
    const denied = await POST(
      await adminRequest(`/api/admin/warung/orders/${doneId}/void`, { method: "POST" }),
      { params: Promise.resolve({ id: String(doneId) }) },
    );
    expect(denied.status).toBe(409);
    const body = await denied.json() as { error: string };
    expect(body.error).toBe("not_voidable");
  });

  it("void race: dua void bersamaan → satu 200, satu 409; id tak valid 400/404", async () => {
    fixture.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status) VALUES('AXV-VOID-4','B','628','[]',100,'qris','lunas','paid')").run();
    fixture.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts) VALUES('AXV-VOID-4','var-1',1,5000,'retry',1,3)").run();
    const linkId = Number((fixture.sql.prepare("SELECT id FROM wr_order_links").get() as { id: number }).id);
    const { POST } = await import("@/app/api/admin/warung/orders/[id]/void/route");
    const params = { params: Promise.resolve({ id: String(linkId) }) };
    const [a, b] = await Promise.all([
      POST(await adminRequest(`/api/admin/warung/orders/${linkId}/void`, { method: "POST" }), params),
      POST(await adminRequest(`/api/admin/warung/orders/${linkId}/void`, { method: "POST" }), params),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const count = Number((fixture.sql.prepare("SELECT COUNT(*) n FROM wr_order_links").get() as { n: number }).n);
    expect(count).toBe(1);
    const bad = await POST(await adminRequest("/api/admin/warung/orders/abc/void", { method: "POST" }), { params: Promise.resolve({ id: "abc" }) });
    expect(bad.status).toBe(400);
    const missing = await POST(await adminRequest("/api/admin/warung/orders/99999/void", { method: "POST" }), { params: Promise.resolve({ id: "99999" }) });
    expect(missing.status).toBe(404);
  });
});

describe("B: TTL reconcileBlockedBalance", () => {
  it(`link muda (<${WR_BLOCKED_MAX_AGE_HOURS} jam) + lunas → revive`, async () => {
    expect(WR_BLOCKED_MAX_AGE_HOURS).toBe(24);
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-TTL-YOUNG");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      stubBalance(100000);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,updated_at) VALUES('AXV-TTL-YOUNG','var-1',1,5000,'blocked_balance',0,3,datetime('now','-1 hour'))").run();
      const db = createDatabaseAccess(fx.db);
      expect(await reconcileBlockedBalance(db)).toBe(1);
      const row = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(row.status).toBe("pending");
    } finally {
      fx.close();
    }
  });

  it("link tua (>24 jam) TIDAK revive walau saldo cukup", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-TTL-OLD");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      stubBalance(100000);
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_variant_id,quantity,wr_cost,status,attempt_count,max_attempts,updated_at) VALUES('AXV-TTL-OLD','var-1',1,5000,'blocked_balance',0,3,datetime('now','-25 hours'))").run();
      const db = createDatabaseAccess(fx.db);
      expect(await reconcileBlockedBalance(db)).toBe(0);
      const row = fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string };
      expect(row.status).toBe("blocked_balance");
    } finally {
      fx.close();
    }
  });

  it("order non-lunas TIDAK revive walau link muda + saldo cukup", async () => {
    const linkId = seedBlockedLink("AXV-TTL-NONLUNAS", { orderStatus: "dibatalkan" });
    stubBalance(100000);
    const db = createDatabaseAccess(fixture.db);
    expect(await reconcileBlockedBalance(db)).toBe(0);
    const row = fixture.sql.prepare("SELECT status FROM wr_order_links WHERE id=?").get(linkId) as { status: string };
    expect(row.status).toBe("blocked_balance");
  });

  it("saldo kurang → tidak revive (perilaku lama tetap)", async () => {
    const linkId = seedBlockedLink("AXV-TTL-POOR");
    stubBalance(100);
    const db = createDatabaseAccess(fixture.db);
    expect(await reconcileBlockedBalance(db)).toBe(0);
    const row = fixture.sql.prepare("SELECT status FROM wr_order_links WHERE id=?").get(linkId) as { status: string };
    expect(row.status).toBe("blocked_balance");
  });
});

describe("B: kabar buyer saat blocked_balance", () => {
  it("masuk blocked → satu pesan outbox idempoten, tidak spam", async () => {
    const fx = await setupWrFixture();
    try {
      seedWrCatalog(fx);
      seedWrOrder(fx, "AXV-BLOCKED-NOTICE");
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (String(url).includes("/balance")) {
            return { ok: true, json: async () => ({ success: true, message: "ok", data: { balance: 100000, currency: "IDR" } }) };
          }
          return { ok: true, json: async () => ({ success: false, message: "Saldo tidak mencukupi", data: null }) };
        }),
      );
      const { createWrOrderLink, processWrPendingOrders } = await import("@/lib/warung-rebahan/order");
      const db = createDatabaseAccess(fx.db);
      await createWrOrderLink("AXV-BLOCKED-NOTICE", [{ product_id: 1, variant_id: 1, qty: 1 }], db);
      const result = await processWrPendingOrders(createDatabaseAccess(fx.db));
      expect(result.blocked).toBe(1);
      const key = "wa:text:wr-blocked:AXV-BLOCKED-NOTICE";
      const msg = fx.sql.prepare("SELECT destination, status FROM whatsapp_outbox WHERE idempotency_key=?").get(key) as { destination: string; status: string } | undefined;
      expect(msg).toBeTruthy();
      expect(String(msg?.destination)).toContain("628");
      // Panggil lagi → tidak duplikat.
      const { notifyBuyerWrBlocked } = await import("@/lib/notify-buyer");
      await notifyBuyerWrBlocked("AXV-BLOCKED-NOTICE", createDatabaseAccess(fx.db));
      const count = Number((fx.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox WHERE idempotency_key=?").get(key) as { n: number }).n);
      expect(count).toBe(1);
    } finally {
      fx.close();
    }
  });
});
