// tests/admin-saldo-fallback.test.ts — Endpoint saldo fallback cache.
//
// Bug owner 2026-09-30: "gagal memuat saldo WR/SK" sering muncul saat buka
// panel admin / search markup. Akar: endpoint saldo menembak upstream
// (proxy Heroku → supplier, 2–4 dtk, kadang tidur/timeout) dan SATU kegagalan
// = seluruh respons 502 → toast merah menutupi panel.
//
// Kontrak baru: live best-effort + fallback cache D1 (saldo_log terakhir)
// + flag `stale`. Hanya bila cache pun kosong → 502 jujur.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function adminRequest(path: string): Promise<Request> {
  const { createAdminToken, createIdleToken } = await import("@/lib/auth");
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-secret-saldo-fallback");
  const { token, sid } = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(sid);
  const headers = new Headers();
  headers.set("cookie", `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`);
  return new NextRequest(`http://localhost${path}`, { headers });
}

describe("GET /api/admin/warung/saldo — fallback cache", () => {
  it("live gagal + cache ada → 200 stale dengan saldo terakhir", async () => {
    const fx = createD1Fixture();
    try {
      
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      fx.sql.prepare("INSERT INTO wr_saldo_log(balance,source) VALUES(150000,'api_check')").run();
      // Upstream mati (proxy tidur / timeout).
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
      const { GET } = await import("@/app/api/admin/warung/saldo/route");
      const res = await GET(await adminRequest("/api/admin/warung/saldo") as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.stale).toBe(true);
      expect(body.current.balance).toBe(150000);
    } finally { fx.close(); }
  });

  it("live gagal + cache kosong → 502 jujur", async () => {
    const fx = createD1Fixture();
    try {
      
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
      const { GET } = await import("@/app/api/admin/warung/saldo/route");
      const res = await GET(await adminRequest("/api/admin/warung/saldo") as never);
      expect(res.status).toBe(502);
    } finally { fx.close(); }
  });
});

describe("GET /api/admin/sekalipay/saldo — fallback cache", () => {
  it("live gagal + cache ada → 200 stale dengan saldo terakhir", async () => {
    const fx = createD1Fixture();
    try {
      
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      fx.sql.prepare("INSERT INTO sk_saldo_log(balance,source) VALUES(75000,'api_check')").run();
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
      const { GET } = await import("@/app/api/admin/sekalipay/saldo/route");
      const res = await GET(await adminRequest("/api/admin/sekalipay/saldo") as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.stale).toBe(true);
      expect(body.current.balance).toBe(75000);
    } finally { fx.close(); }
  });

  it("live gagal + cache kosong → 502 jujur", async () => {
    const fx = createD1Fixture();
    try {
      
      vi.stubEnv("SEKALIPAY_ENABLED", "true");
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("fetch failed"); }));
      const { GET } = await import("@/app/api/admin/sekalipay/saldo/route");
      const res = await GET(await adminRequest("/api/admin/sekalipay/saldo") as never);
      expect(res.status).toBe(502);
    } finally { fx.close(); }
  });
});
