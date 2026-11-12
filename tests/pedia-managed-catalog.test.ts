// tests/pedia-managed-catalog.test.ts — PSMM-P2 (2026-11-12; revisi review-1).
// Mengunci: plan deterministik + mapping yang benar-benar didukung parser,
// fail-closed, precedence "Tidak Bergaransi", badge pembersihan nama, kepemilikan
// sebelum mutasi, CAS/larangan manusia, override admin tidak di-reset, dan
// idempotensi/repeat-sync.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { planManagedService, materializeManagedCatalog, MANAGED_PER_CALL, type ManagedService } from "@/lib/pedia/auto-catalog";
import { applyProvidersmmDiff } from "@/lib/pedia/sync";

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

describe("planManagedService (deterministik, fail-closed)", () => {
  it("maps a Default IG followers service to a profile target with G2 prices", () => {
    const plan = planManagedService(svc(), DESC, 1000);
    expect(plan).toMatchObject({ eligible: true, reason: null, slug: "psmm-101", platform: "instagram", metric: "followers", target_kind: "profile", input_kind: null });
    expect(plan.packages[0]).toBe(20);
    expect(plan.packages).toContain(1000);
    expect(plan.prices["1000"]).toBe(32000);
  });

  it("strips supplier superscript badge and status emoji from the public name", () => {
    const plan = planManagedService(
      svc({ name: "Instagram Likes Indonesia [REAL] [No Refill] ⭐ ᴾʳᵒᵛᶦᵈᵉʳ" }), DESC, 1000,
    );
    expect(plan.product_name).not.toMatch(/[ᴾʳᵒᵛᶦᵈᵉʳ]/);
    expect(plan.product_name).not.toContain("⭐");
    expect(plan.product_name).toContain("Instagram Likes Indonesia");
  });

  it("maps Custom Comments only when the source names comments", () => {
    expect(planManagedService(svc({ category: "Instagram Komentar Custom", type: "Custom Comments" }), DESC, 1000))
      .toMatchObject({ eligible: true, input_kind: "comments", metric: "comments" });
    expect(planManagedService(svc({ category: "Instagram Followers", type: "Custom Comments" }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "type_unsupported" });
  });

  it.each([
    [{ type: "Package" }, "type_unsupported"],
    [{ category: "Layanan Aneh", name: "Sesuatu" }, "platform_unmapped"],
    [{ category: "Instagram TikTok" }, "platform_ambiguous"],
    [{ category: "Instagram", name: "Instagram Mantap" }, "metric_unmapped"],
    [{ name: "Instagram Followers Canva Pro" }, "premium_tool_excluded"],
    [{ max_qty: 0 }, "invalid_service"],
  ])("rejects %j as %s", (patch, reason) => {
    expect(planManagedService(svc(patch as Partial<ManagedService>), DESC, 1000).reason).toBe(reason);
  });

  it("never grants a refill duration from the name or API boolean alone", () => {
    // Klaim garansi tanpa durasi tertulis → belum pasti (tidak dijual bergaransi).
    expect(planManagedService(svc({ name: "Instagram Likes Global R30 Garansi", category: "Instagram Likes" }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "warranty_unconfirmed" });
    // API refill bool saja juga bukan durasi.
    expect(planManagedService(svc({ name: "Instagram Followers Global", api_refill: 1 }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "warranty_unconfirmed" });
    // Tanpa klaim sama sekali & API refill mati = koheren No Refill (valid).
    expect(planManagedService(svc({ name: "Instagram Followers Global [No Refill]" }), DESC, 1000))
      .toMatchObject({ eligible: true, refill_days: 0 });
  });

  it("does not declare unsafe targets: IG likes→profile, SnackVideo likes without video", () => {
    expect(planManagedService(svc({ name: "Instagram Likes Profil", category: "Instagram Likes" }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "target_unmapped" });
    expect(planManagedService(svc({ name: "Snack Video Likes", category: "Snack Video" }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "target_unmapped" });
    // "Snack Video" adalah nama platform, bukan bukti target video.
    // PSMM-CORE-FIX B5: SnackVideo tidak punya target terverifikasi di parser
    // (hanya profil, bukan likes-video) → tetap ditahan, bukan dijual salah target.
    expect(planManagedService(svc({ name: "Snack Video Likes Video", category: "Snack Video Video" }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "target_unmapped" });
  });

  it("distinguishes Reels, Story, and feed posts on Instagram", () => {
    expect(planManagedService(svc({ name: "Instagram Likes Reels", category: "Instagram Likes" }), DESC, 1000))
      .toMatchObject({ eligible: true, target_kind: "reel" });
    expect(planManagedService(svc({ name: "Instagram Story Views", category: "Instagram Story Views" }), DESC, 1000))
      .toMatchObject({ eligible: true, metric: "views", target_kind: "story" });
    expect(planManagedService(svc({ name: "Instagram Likes Post", category: "Instagram Likes" }), DESC, 1000))
      .toMatchObject({ eligible: true, target_kind: "post" });
  });

  it("maps Spotify plays by explicit source scope, never blanket playlist", () => {
    expect(planManagedService(svc({ name: "Spotify Track Plays", category: "Spotify" }), DESC, 1000))
      .toMatchObject({ eligible: true, platform: "spotify", metric: "plays", target_kind: "track" });
    expect(planManagedService(svc({ name: "Spotify Playlist Plays", category: "Spotify" }), DESC, 1000))
      .toMatchObject({ eligible: true, target_kind: "playlist" });
    expect(planManagedService(svc({ name: "Spotify Artist Followers", category: "Spotify Followers" }), DESC, 1000))
      .toMatchObject({ eligible: true, metric: "followers", target_kind: "artist" });
    // Plays tanpa scope eksplisit = ambigu → tidak dijual.
    expect(planManagedService(svc({ name: "Spotify Plays", category: "Spotify" }), DESC, 1000))
      .toMatchObject({ eligible: false, reason: "target_unmapped" });
  });

  it("fails closed without a usable description and refuses oversize text", () => {
    expect(planManagedService(svc(), null, 1000, "missing").reason).toBe("description_missing");
    expect(planManagedService(svc(), "   \n ", 1000).reason).toBe("description_missing");
    expect(planManagedService(svc(), "x".repeat(3500), 1000, "oversize").reason).toBe("description_oversize");
  });

  it("prefers explicit no-refill over accidental claim words and conflicts on real ones", () => {
    // "Tidak Bergaransi" tidak boleh terbaca sebagai klaim "garansi".
    expect(planManagedService(svc({ name: "Instagram Followers Global [Tidak Bergaransi]" }), DESC, 1000))
      .toMatchObject({ eligible: true, refill_days: 0 });
    // Nama menjanjikan 30 hari, deskripsi menyebut Refill: Tidak → konflik.
    expect(planManagedService(
      svc({ name: "Instagram Followers [Garansi Refill 30 Hari]", service_id: 1068 }),
      "Garansi Refill : Tidak\nProses 1-6 jam.", 1000,
    )).toMatchObject({ eligible: false, reason: "terms_conflict" });
    // Nama vs deskripsi durasi berbeda → konflik.
    expect(planManagedService(
      svc({ name: "Instagram Followers Garansi Refill 30 Hari" }),
      "Garansi refill 90 hari.", 1000,
    )).toMatchObject({ eligible: false, reason: "terms_conflict" });
    // Klaim tanpa durasi / API bool saja = belum pasti, bukan No Refill.
    expect(planManagedService(svc({ name: "Instagram Followers Garansi" }), DESC, 1000).reason).toBe("warranty_unconfirmed");
    expect(planManagedService(svc({ name: "Instagram Followers Global", api_refill: 1 }), DESC, 1000).reason).toBe("warranty_unconfirmed");
  });

  // PSMM-CORE-FIX B6: anchor WAJIB eksplisit dari sumber; skema bukan bukti.
  it("requires an explicit source-duration AND explicit anchor before promising warranty", () => {
    // Durasi eksplisit tanpa anchor di sumber → belum pasti (tidak dijual bergaransi).
    expect(planManagedService(svc({ name: "Instagram Followers Garansi Refill 30 Hari" }), "Proses 1-6 jam.\nRefill 30 hari.", 1000))
      .toMatchObject({ eligible: false, reason: "warranty_unconfirmed" });
    // Anchor "dibuat" eksplisit → diterima.
    expect(planManagedService(
      svc({ name: "Instagram Followers Refill 30 Hari" }),
      "Garansi refill 30 hari sejak pesanan dibuat.", 1000,
    )).toMatchObject({ eligible: true, refill_days: 30, refill_anchor: "created" });
    // Anchor "selesai" eksplisit → diterima.
    expect(planManagedService(
      svc({ name: "Instagram Followers Refill 30 Hari" }),
      "Garansi refill 30 hari setelah pesanan selesai.", 1000,
    )).toMatchObject({ eligible: true, refill_days: 30, refill_anchor: "completed" });
    // Durasi dalam BULAN tidak dikonversi paksa ke 30 hari → belum pasti.
    expect(planManagedService(
      svc({ name: "Instagram Followers Garansi Refill 1 Bulan" }),
      "Garansi refill 1 bulan sejak pesanan dibuat.", 1000,
    )).toMatchObject({ eligible: false, reason: "warranty_unconfirmed" });
  });

  it("keeps the API min/max authoritative", () => {
    expect(planManagedService(svc({ min_qty: 500, max_qty: 800 }), DESC, 1000).packages).toEqual([500]);
  });
});

describe("materializeManagedCatalog", () => {
  it("creates one managed product/tier and is idempotent across repeats", async () => {
    const { db: d } = db();
    const descs = new Map([[101, DESC]]);
    expect(await materializeManagedCatalog(d, [svc()], descs)).toMatchObject({ created: 1 });
    const product = await d.queryFirst(`SELECT * FROM pedia_products WHERE slug='psmm-101'`);
    expect(product).toMatchObject({ platform: "instagram", metric: "followers", target_kind: "profile", managed: "auto" });
    const tier = await d.queryFirst(`SELECT * FROM pedia_tiers WHERE supplier='providersmm' AND supplier_service_id=101`);
    expect(tier).toMatchObject({ managed: "auto", price_group: "G2", refill_days: 0, is_active: 1, auto_disabled_reason: null });

    const second = await materializeManagedCatalog(d, [svc()], descs);
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(await d.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE supplier_service_id=101`)).toMatchObject({ n: 1 });
  });

  it("never mutates a colliding curated product or tier, and never remaps legacy rows", async () => {
    const { db: d } = db();
    // Slug psmm-101 sudah dipakai produk KURASI.
    await d.execRun(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed) VALUES ('psmm-101','tiktok','likes','video','Kurasi Manual','[100]',10,1,'curated')`);
    const p = await d.queryFirst(`SELECT id FROM pedia_products WHERE slug='psmm-101'`);
    const beforeProduct = await d.queryFirst(`SELECT * FROM pedia_products WHERE slug='psmm-101'`);
    await d.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,is_active,managed) VALUES (?,'standar','providersmm',101,'G3',55,4000,30,1,'curated')`, Number(p?.id));
    await d.execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES ('AXP-LEGACY','','6281234567890','x@y.com','[]',5000,'qris','lunas','pedia')`);
    const curatedId = Number((await d.queryFirst(`SELECT id FROM pedia_tiers WHERE managed='curated'`))?.id);
    await d.execRun(`INSERT INTO pedia_order_items (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status) VALUES ('AXP-LEGACY',?,?,'{"supplier":"providersmm","refill_days":30}','x','x',100,50,5000,'providersmm',101,20000,'completed')`, Number(p?.id), curatedId);
    const beforeOrder = await d.queryFirst(`SELECT * FROM pedia_order_items WHERE order_code='AXP-LEGACY'`);

    const r = await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(r.skipped).toBe(1);
    // Produk kurasi tidak dimutasi.
    expect(await d.queryFirst(`SELECT * FROM pedia_products WHERE slug='psmm-101'`)).toEqual(beforeProduct);
    expect(await d.queryFirst(`SELECT markup_pct,refill_days,managed FROM pedia_tiers WHERE id=?`, curatedId))
      .toMatchObject({ markup_pct: 55, refill_days: 30, managed: "curated" });
    expect(await d.queryFirst(`SELECT * FROM pedia_order_items WHERE order_code='AXP-LEGACY'`)).toEqual(beforeOrder);
  });

  it("preserves admin overrides and human disables while recovering machine reasons", async () => {
    const { db: d } = db();
    const descs = new Map([[101, DESC]]);
    await materializeManagedCatalog(d, [svc()], descs);
    // Admin mengubah markup/min-profit (bukan default G2).
    await d.execRun(`UPDATE pedia_tiers SET markup_pct=77, min_profit_rp=3210 WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], descs);
    expect(await d.queryFirst(`SELECT markup_pct,min_profit_rp FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ markup_pct: 77, min_profit_rp: 3210 });

    // Nonaktif manual (alasan manusia) tidak boleh dihidupkan mesin.
    await d.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='manual' WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], descs);
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });

    // Nonaktif margin (larangan manusia) juga dominan.
    await d.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='margin' WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], descs);
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "margin" });

    // Alasan mesin pulih ketika data kembali.
    await d.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='description_missing' WHERE supplier_service_id=101`);
    await materializeManagedCatalog(d, [svc()], descs);
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 1, auto_disabled_reason: null });
  });

  it("CAS prevents a concurrent admin disable from being reactivated", async () => {
    const { db: d, fx } = db();
    const descs = new Map([[101, DESC]]);
    await materializeManagedCatalog(d, [svc()], descs);
    // Admin menonaktifkan tepat sebelum UPDATE materializer.
    fx.control.beforeRun = async (q) => {
      if (q.includes("UPDATE pedia_tiers SET") && q.includes("package_prices_json")) {
        fx.sql.prepare(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='manual' WHERE supplier_service_id=101`).run();
      }
    };
    await materializeManagedCatalog(d, [svc()], descs);
    fx.control.beforeRun = null;
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });
  });

  it("marks ineligible rows unavailable with a visible reason and keeps the mirror", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc({ service_id: 202 })], new Map());
    expect(await d.queryFirst(`SELECT managed,is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=202`))
      .toMatchObject({ managed: "auto", is_active: 0, auto_disabled_reason: "description_missing" });
    expect(await d.queryFirst(`SELECT COUNT(*) n FROM pedia_products WHERE slug='psmm-202'`)).toMatchObject({ n: 1 });
  });

  it("retires only managed rows for explicit removed IDs and bounds per call", async () => {
    const { db: d } = db();
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    await materializeManagedCatalog(d, [], new Map(), [101]);
    expect(await d.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=101`))
      .toMatchObject({ is_active: 0, auto_disabled_reason: "service_missing" });

    const many = Array.from({ length: 60 }, (_, i) => svc({ service_id: 1000 + i }));
    const r = await materializeManagedCatalog(d, many, new Map(many.map((s) => [s.service_id, DESC])));
    expect(r.created).toBe(MANAGED_PER_CALL);
  });

  it("does not duplicate when the supplier delta is applied twice", async () => {
    const { db: d } = db();
    const row = { service_id: 101, name: svc().name, type: "Default", category: "Instagram Followers", rate: 20000, min_qty: 20, max_qty: 10000, api_refill: 0, api_cancel: 0, api_dripfeed: 0 };
    await applyProvidersmmDiff(d, [row], []);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    await applyProvidersmmDiff(d, [row], []);
    await materializeManagedCatalog(d, [svc()], new Map([[101, DESC]]));
    expect(await d.queryFirst(`SELECT COUNT(*) n FROM pedia_products WHERE slug LIKE 'psmm-%'`)).toMatchObject({ n: 1 });
    expect(await d.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: 1 });
  });
});
