// tests/pedia-admin.test.ts — PEDIA M2: API admin Pedia (auth, seed §7.3, resync, credits).
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { PEDIA_SEED_PRODUCTS, PEDIA_SEED_TIER_COUNT } from "@/lib/pedia/seed";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function authedRequest(url: string, init?: RequestInit): Promise<NextRequest> {
  const auth = await import("@/lib/auth");
  const { token, sid } = await auth.createAdminToken("admin@axvara.tech");
  const idle = await auth.createIdleToken(sid);
  const headers = new Headers(init?.headers);
  headers.set("cookie", `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(idle)}`);
  const { signal: _signal, ...rest } = init ?? {};
  void _signal;
  return new NextRequest(url, { ...rest, headers });
}

function setAdminEnv() {
  process.env.ADMIN_EMAIL = "admin@axvara.tech";
  process.env.ADMIN_JWT_SECRET = "test-pedia-admin-secret-0123456789";
  process.env.ADMIN_PASSWORD_SHA256 = "a".repeat(64);
}

describe("admin Pedia M2", () => {
  it("seed §7.3: 14 produk + 24 tingkat, semua nonaktif", () => {
    expect(PEDIA_SEED_PRODUCTS.length).toBe(14);
    expect(PEDIA_SEED_TIER_COUNT).toBe(24);
    for (const p of PEDIA_SEED_PRODUCTS) {
      expect(p.slug).toBeTruthy();
      expect(p.tiers.length).toBeGreaterThanOrEqual(1);
      // Badge hanya di tingkat yang memang begitu (microcopy jujur §10.3).
      for (const t of p.tiers) {
        expect(["hemat", "standar", "premium"]).toContain(t.tier);
        expect(["G1", "G2", "G3"]).toContain(t.group);
      }
    }
    // Paket dalam rentang min–max API (data live 2026-10-07).
    // Batas serbaguna: min = max(min semua layanan produk), max = min(max).
    const ranges: Record<number, [number, number]> = {
      948: [10, 1000000], 86: [100, 1000], 24: [5, 1000],
      701: [10, 100000], 541: [20, 20000], 802: [100, 250000],
      651: [100, 10000], 82: [100, 1000000], 976: [10, 100000],
      13: [50, 10000], 17: [5, 200], 116: [20, 20000],
      16: [20, 20000], 18: [5, 300], 984: [100, 100000],
      988: [10, 100000], 676: [50, 10000], 958: [100, 1000000],
      959: [100, 1000000], 235: [500, 217545811], 835: [10, 10000],
      93: [5, 300], 512: [100, 500000], 282: [500, 5000000],
    };
    for (const p of PEDIA_SEED_PRODUCTS) {
      const bounds = p.tiers.map((t) => ranges[t.serviceId]).filter(Boolean);
      if (!bounds.length) continue;
      const lo = Math.max(...bounds.map((b) => b[0]));
      const hi = Math.min(...bounds.map((b) => b[1]));
      for (const qty of p.packages) {
        expect(qty >= lo && qty <= hi, `${p.slug} paket ${qty} di luar [${lo},${hi}]`).toBe(true);
      }
    }
  });

  it("401 tanpa sesi admin (overview, products, services, orders, credits, settings)", async () => {
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "x");
    const routes = [
      await import("@/app/api/admin/pedia/overview/route"),
      await import("@/app/api/admin/pedia/products/route"),
      await import("@/app/api/admin/pedia/services/route"),
      await import("@/app/api/admin/pedia/orders/route"),
      await import("@/app/api/admin/pedia/credits/route"),
      await import("@/app/api/admin/pedia/settings/route"),
    ];
    for (const m of routes) {
      const fn = (m as unknown as { GET: (r: NextRequest) => Promise<Response> }).GET;
      const res = await fn(new NextRequest("http://x/"));
      expect(res.status).toBe(401);
    }
  });

  it("POST seed idempoten: dua kali → produk tetap 14", async () => {
    createD1Fixture();
    setAdminEnv();
    const { POST } = await import("@/app/api/admin/pedia/products/route");
    const mk = () => authedRequest("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "seed" }),
    });
    const r1 = await POST(await mk());
    expect(r1.status).toBe(200);
    const d1 = await r1.json();
    expect(d1.seeded_products).toBe(14);
    expect(d1.seeded_tiers).toBe(24);
    const r2 = await POST(await mk());
    const d2 = await r2.json();
    expect(d2.seeded_products).toBe(0);
    expect(d2.seeded_tiers).toBe(0);
    const { GET } = await import("@/app/api/admin/pedia/products/route");
    const g = await GET(await authedRequest("http://x/"));
    const gd = await g.json();
    expect(gd.products.length).toBe(14);
    expect(gd.products.every((p: { is_active: number }) => p.is_active === 0)).toBe(true);
  });

  it("PUT tier aktif manual membuka kunci auto-disabled", async () => {
    createD1Fixture();
    setAdminEnv();
    const { POST, PUT } = await import("@/app/api/admin/pedia/products/route");
    await POST(await authedRequest("http://x/", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "seed" }),
    }));
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const db = createDatabaseAccess();
    const tier = await db.queryFirst(`SELECT id FROM pedia_tiers LIMIT 1`);
    await db.execRun(`UPDATE pedia_tiers SET auto_disabled_reason='margin' WHERE id=?`, Number(tier?.id));
    const r = await PUT(await authedRequest("http://x/", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "tier", id: Number(tier?.id), is_active: 1 }),
    }));
    expect(r.status).toBe(200);
    const after = await db.queryFirst(`SELECT is_active, auto_disabled_reason FROM pedia_tiers WHERE id=?`, Number(tier?.id));
    expect(Number(after?.is_active)).toBe(1);
    expect(after?.auto_disabled_reason).toBeNull();
  });
});
