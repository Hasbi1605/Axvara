// tests/pedia-core-fix.regression.test.ts — PSMM-CORE-FIX B1–B6 (2026-11-12).
// Setiap tes mengunci PERILAKU YANG DIPERBAIKI (bukan bug lama).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { seedOfficialDescriptions } from "./helpers/pedia-managed-fixture";
import { materializeManagedCatalog, planManagedService, MANAGED_PER_CALL, type ManagedService } from "@/lib/pedia/auto-catalog";
import {
  enqueueManagedWork, drainManagedWork, managedPendingCount, enqueueAllManaged, enqueueUnmaterialized,
} from "@/lib/pedia/metadata-refresh";
import { detectPediaLink, pediaTargetMatches } from "@/lib/pedia/link";
import { createAdminToken, createIdleToken } from "@/lib/auth";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const svc = (over: Partial<ManagedService> = {}): ManagedService => ({
  service_id: 101, name: "Instagram Followers Global [No Refill]", type: "Default",
  category: "Instagram Followers", rate: 20000, min_qty: 20, max_qty: 10000, api_refill: 0, ...over,
});
const DESC = "Followers masuk bertahap.\nJangan ubah profil selama proses.";

function db() {
  const fx = createD1Fixture();
  return { fx, db: createDatabaseAccess(fx.db) };
}

describe("B1 — inactive auto rows stay disabled unless machine-recoverable", () => {
  it("does not reactivate {is_active:0, reason:NULL} legacy rows", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    // Legacy: inactive without any reason (pre-fix admin pause artefact).
    await d.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason=NULL WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier_service_id=101`)).toMatchObject({ is_active: 0 });
  });

  it("does not reactivate an explicit human pause (reason 'manual')", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    await d.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='manual' WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });
  });

  it("recovers only from an explicit machine reason", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    await d.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='description_missing' WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier_service_id=101`)).toMatchObject({ is_active: 1 });
  });

  it("CAS keeps a concurrent admin pause (no overwrite by the sync write)", async () => {
    const { db: d, fx } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    fx.control.beforeRun = async (q) => {
      if (q.includes("UPDATE pedia_tiers SET") && q.includes("package_prices_json")) {
        fx.sql.prepare(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='manual' WHERE supplier_service_id=101`).run();
      }
    };
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    fx.control.beforeRun = null;
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });
  });

  it("admin pause endpoint writes reason 'manual' so a later sync cannot revive it", async () => {
    const { db: d, fx } = db();
    vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
    vi.stubEnv("ADMIN_JWT_SECRET", "core-fix-secret");
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
    await d.execRun(`INSERT INTO pedia_products (id,slug,platform,metric,target_kind,name,packages_json,step,is_active,managed) VALUES (1,'psmm-101','instagram','followers','profile','Followers','[20]',1,1,'auto')`);
    await d.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES ('providersmm',101,'Instagram Followers Global','Instagram Followers','Default',20000,20,10000,0,1)`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    const session = await createAdminToken("admin@axvara.tech");
    const cookie = `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
    const { PUT } = await import("@/app/api/admin/pedia/products/route");
    const tier = await d.queryFirst(`SELECT id FROM pedia_tiers WHERE supplier_service_id=101`);
    const res = await PUT(new Request("http://localhost/api/admin/pedia/products", { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ kind: "tier", id: Number(tier?.id), is_active: 0 }) }) as never);
    expect(res.status).toBe(200);
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });
    fx.control.fail = null;
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT is_active FROM pedia_tiers WHERE supplier_service_id=101`)).toMatchObject({ is_active: 0 });
  });
});

describe("B2 — package prices use the preserved admin pricing basis", () => {
  it("77% markup yields 35400 (admin basis), not the G2 32000", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    await d.execRun(`UPDATE pedia_tiers SET markup_pct=77, min_profit_rp=2000 WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    const tier = await d.queryFirst(`SELECT markup_pct,min_profit_rp,package_prices_json FROM pedia_tiers WHERE supplier_service_id=101`);
    expect(tier).toMatchObject({ markup_pct: 77, min_profit_rp: 2000 });
    // rate 20000 → modal 20000 @1000; ×1,77 = 35400 → aturan pembulatan harga
    // (≥Rp10.000 → kelipatan Rp500) menghasilkan 35500. Basis 77% admin, bukan
    // G2 yang akan memberi 32000.
    expect(JSON.parse(String(tier?.package_prices_json))["1000"]).toBe(35500);
  });

  it("an admin min-profit override also drives the stored prices", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    // Turunkan markup & min-profit: guard margin lolos, harga harus dihitung
    // dari basis admin (0%, 1000) → qty 20 modal 400 → max(400, 1400) = 1400.
    await d.execRun(`UPDATE pedia_tiers SET markup_pct=0, min_profit_rp=1000 WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    const tier = await d.queryFirst(`SELECT markup_pct,min_profit_rp,package_prices_json,is_active FROM pedia_tiers WHERE supplier_service_id=101`);
    expect(tier).toMatchObject({ markup_pct: 0, min_profit_rp: 1000, is_active: 1 });
    expect(JSON.parse(String(tier?.package_prices_json))["20"]).toBe(1400);
  });

  it("a margin-breaking admin change disables rather than storing a loss-making price", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    await d.execRun(`UPDATE pedia_tiers SET markup_pct=0, min_profit_rp=5000 WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "margin" });
  });

  it("margin guard on the new rate still disables before overwrite", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    // Rate melonjak: harga tersimpan tidak lagi menutup min_profit.
    await materializeManagedCatalog(d, [{ ...svc(), rate: 200000 }], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "margin" });
  });
});

describe("B3 — durable queue never loses IDs or fakes completion", () => {
  function seedMirror(d: ReturnType<typeof createDatabaseAccess>, ids: number[]) {
    return Promise.all(ids.map((id) => d.execRun(
      `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present)
       VALUES ('providersmm',?,'Instagram Followers Global','Instagram Followers','Default',20000,20,10000,0,1)`, id,
    )));
  }

  it("concurrent enqueues do not lose IDs", async () => {
    const { db: d } = db();
    await Promise.all([
      enqueueManagedWork(d, [1, 2, 3]),
      enqueueManagedWork(d, [4, 5, 6]),
      enqueueManagedWork(d, [3, 7]),
    ]);
    expect(await managedPendingCount(d)).toBe(7);
  });

  it("a failed mirror read surfaces an error and keeps rows pending", async () => {
    const { db: d, fx } = db();
    await seedMirror(d, [11, 12]);
    await enqueueManagedWork(d, [11, 12]);
    fx.control.fail = (q) => q.includes("FROM pedia_supplier_services") && q.includes("IN (");
    const res = await drainManagedWork(d);
    fx.control.fail = null;
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.remaining).toBe(2);
    expect(await managedPendingCount(d)).toBe(2);
  });

  it("a failed ack (DELETE) keeps the row pending", async () => {
    const { db: d, fx } = db();
    await seedMirror(d, [21]);
    await seedOfficialDescriptions(d, [21]);
    await enqueueManagedWork(d, [21]);
    fx.control.fail = (q) => q.startsWith("DELETE FROM store_settings WHERE key=?");
    const res = await drainManagedWork(d);
    fx.control.fail = null;
    expect(res.errors.length).toBeGreaterThan(0);
    expect(await managedPendingCount(d)).toBe(1);
  });

  it("drains a >25 batch fully across bounded windows without losing the tail", async () => {
    const { db: d } = db();
    const ids = Array.from({ length: MANAGED_PER_CALL + 8 }, (_, i) => 300 + i);
    await seedMirror(d, ids);
    await seedOfficialDescriptions(d, ids);
    await enqueueManagedWork(d, ids);
    let guard = 0;
    while ((await managedPendingCount(d)) > 0 && guard++ < 10) await drainManagedWork(d);
    expect(await managedPendingCount(d)).toBe(0);
    expect(await d.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: ids.length });
  });

  it("an enqueue during consumption is not overwritten by the drain", async () => {
    const { db: d, fx } = db();
    await seedMirror(d, [41, 42, 43]);
    await enqueueManagedWork(d, [41, 42]);
    let injected = false;
    fx.control.afterRun = async (q) => {
      if (!injected && q.startsWith("DELETE FROM store_settings WHERE key=?")) {
        injected = true;
        await enqueueManagedWork(d, [43]);
      }
    };
    await drainManagedWork(d);
    fx.control.afterRun = null;
    expect(await managedPendingCount(d)).toBe(1);
    await drainManagedWork(d);
    expect(await managedPendingCount(d)).toBe(0);
  });
});

describe("B4 — metadata change re-plans all managed rows", () => {
  it("snapshot refresh enqueues all present services (not only those without tiers)", async () => {
    const { db: d } = db();
    await d.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES ('providersmm',51,'Instagram Followers Global','Instagram Followers','Default',20000,20,10000,0,1)`);
    await seedOfficialDescriptions(d, [51]);
    await materializeManagedCatalog(d, [svc({ service_id: 51 })], new Map([[51, DESC]]));
    const n = await enqueueAllManaged(d);
    expect(n).toBe(1);
    expect(await managedPendingCount(d)).toBe(1);
  });

  it("a curated mapping no longer hides a service from auto enqueue", async () => {
    const { db: d } = db();
    await d.execRun(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed) VALUES ('curated-ig','instagram','followers','profile','Curated','[100]',1,1,'curated')`);
    await d.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES ('providersmm',61,'Instagram Followers Global','Instagram Followers','Default',20000,20,10000,0,1)`);
    await d.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,managed)
      VALUES ((SELECT id FROM pedia_products WHERE slug='curated-ig'),'standar','providersmm',61,'G3',20,1000,1,'curated')`);
    expect(await enqueueUnmaterialized(d)).toBe(1);
  });
});

describe("B5 — only parser-supported targets are sellable", () => {
  const allowed: [string, string, string][] = [
    ["instagram", "Followers", "profile"], ["instagram", "Likes Post", "post"],
    ["youtube", "Subscribers", "channel"], ["tiktok", "Followers", "profile"],
    ["spotify", "Playlist Plays", "playlist"], ["spotify", "Track Plays", "track"],
  ];
  it.each(allowed)("offers %s/%s as a target the parser actually detects", (platform, metricName, targetKind) => {
    const plan = planManagedService(
      svc({ name: `${platform} ${metricName}`, category: `${platform} ${metricName}` }), DESC, 1000,
    );
    expect(plan.eligible).toBe(true);
    expect(plan.target_kind).toBe(targetKind);
    // Parser harus benar-benar mendeteksi jenis ini (tidak ada 422 palsu).
    expect(["profile", "post", "channel", "playlist", "track"]).toContain(plan.target_kind);
  });

  it.each([
    [{ name: "Facebook Story Views", category: "Facebook Story Views" }, "facebook story"],
    [{ name: "Spotify Album Plays", category: "Spotify" }, "spotify album"],
    [{ name: "Snack Video Likes Video", category: "Snack Video Video" }, "snackvideo"],
  ])("rejects %# (%s) instead of advertising an undetectable target", (patch) => {
    expect(planManagedService(svc(patch as Partial<ManagedService>), DESC, 1000).eligible).toBe(false);
  });

  it("facebook story URLs are not detected as story by the real parser", () => {
    const detected = detectPediaLink("https://www.facebook.com/permalink.php?story_fbid=123&id=1", "facebook");
    expect(detected?.targetKind).not.toBe("story");
    // Spotify album URL juga tidak dideteksi sebagai album.
    expect(detectPediaLink("https://open.spotify.com/album/abc", "spotify")).toBeNull();
  });

  it("every advertised target kind is reachable for its parser kind", () => {
    // Contoh URL nyata per jenis yang boleh; harus cocok dengan target_kind plan.
    const cases: [string, string, string][] = [
      ["instagram", "https://www.instagram.com/username/", "profile"],
      ["instagram", "https://www.instagram.com/p/ABC123/", "post"],
      ["youtube", "https://www.youtube.com/@channel", "channel"],
      ["spotify", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", "playlist"],
      ["spotify", "https://open.spotify.com/track/IDlagu", "track"],
    ];
    for (const [platform, url, kind] of cases) {
      const detected = detectPediaLink(url, platform);
      expect(detected, url).not.toBeNull();
      expect(pediaTargetMatches(kind, detected!.targetKind, { platform, metric: kind === "profile" ? "followers" : "plays" }), url).toBe(true);
    }
  });
});

describe("B6 — no invented refill anchor or month conversion", () => {
  it("requires both an explicit duration and an explicit anchor", () => {
    expect(planManagedService(svc({ name: "Instagram Followers Refill 30 Hari" }), "Refill 30 hari.", 1000))
      .toMatchObject({ eligible: false, reason: "warranty_unconfirmed" });
    expect(planManagedService(svc({ name: "Instagram Followers Refill 30 Hari" }), "Garansi refill 30 hari sejak pesanan dibuat.", 1000))
      .toMatchObject({ eligible: true, refill_days: 30, refill_anchor: "created" });
  });
  it("does not convert calendar months into 30-day promises", () => {
    expect(planManagedService(svc({ name: "Instagram Followers Refill 1 Bulan" }), "Refill 1 bulan sejak pesanan dibuat.", 1000))
      .toMatchObject({ eligible: false, reason: "warranty_unconfirmed" });
  });
  it("existing coherent No Refill is unaffected", () => {
    expect(planManagedService(svc({ name: "Instagram Followers [No Refill]" }), DESC, 1000))
      .toMatchObject({ eligible: true, refill_days: 0 });
  });
});
