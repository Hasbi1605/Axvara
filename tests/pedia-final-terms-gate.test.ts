// tests/pedia-final-terms-gate.test.ts — PSMM-FINAL-PATCH C (2026-11-12).
// Mengunci gate konsistensi syarat material: bila snapshot resmi berubah
// (mis. garansi positif → "No Refill"/kontradiksi) dan baris auto BELUM
// direkonsiliasi, katalog/quote/order baru menolak syarat lama; setelah drain
// merekonsiliasi, penjualan mengikuti syarat baru. Persisted order retry tetap
// dilayani sebelum gate. Tidak ada fetch upstream / N+1.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { createPediaQuoteToken } from "@/lib/pedia/quote";
import { enqueueManagedWork, drainManagedWork } from "@/lib/pedia/metadata-refresh";
import * as qris from "@/lib/payments/dana-qris";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const request = (body: unknown) => new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never;
const V1 = "2026-11-12T10:00:00.000Z";
const V2 = "2026-11-12T17:00:00.000Z";

/** Snapshot resmi dengan teks per ID; versi = `fetched_at`. */
async function writeSnapshot(db: ReturnType<typeof createDatabaseAccess>, version: string, entries: Record<number, { status: "ok" | "empty"; text: string }>) {
  const snapshot = JSON.stringify({
    fetched_at: version, source_url: "https://providersmm.id/services",
    entries: Object.fromEntries(Object.entries(entries).map(([id, e]) => [id, e])),
  });
  await db.execRun(
    `INSERT INTO store_settings (key,value,updated_at) VALUES ('pedia_psmm_desc_snapshot',?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, snapshot,
  );
  await db.execRun(
    `INSERT INTO store_settings (key,value,updated_at) VALUES ('pedia_psmm_desc_last_at',?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, version,
  );
}

async function seed(opts: { stampedVersion?: string | null } = {}) {
  const fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "pedia-final-terms-secret");
  await db.execRun(
    `INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed)
     VALUES ('psmm-501','instagram','followers','profile','Followers Instagram','[100,250]',10,1,'auto')`,
  );
  await db.execRun(
    `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
     VALUES ('providersmm',501,'Instagram Followers Garansi 30 Hari','Instagram Followers','Default',20000,20,10000,1)`,
  );
  // Baris auto dengan janji garansi 30 hari yang sudah direkonsiliasi ke V1.
  await db.execRun(
    `INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,refill_anchor,package_prices_json,is_active,managed,managed_snapshot_at)
     VALUES (1,'standar','providersmm',501,'G2',60,2000,30,'created','{"100":4000,"250":9000}',1,'auto',?)`,
    opts.stampedVersion === undefined ? V1 : opts.stampedVersion,
  );
  await writeSnapshot(db, V1, { 501: { status: "ok", text: "Garansi refill 30 hari sejak pesanan dibuat." } });
  return { db, fx };
}

describe("stale material terms are not sold until reconciled", () => {
  it("hides the row from the public catalog while its terms stamp is behind the active snapshot", async () => {
    const { db, fx } = await seed();
    try {
      const { GET } = await import("@/app/api/pedia/catalog/route");
      // V1: baris segar → tayang.
      expect((await (await GET()).json()).products).toHaveLength(1);
      // Snapshot V2 berubah menjadi kontradiksi ("No Refill"), antrean BELUM dikuras.
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "Refill: Tidak. Tanpa garansi." } });
      expect((await (await GET()).json()).products).toEqual([]);
      // Baris yang sudah direkonsiliasi ke V2 kembali tayang dengan syarat baru.
      await db.execRun(`UPDATE pedia_tiers SET managed_snapshot_at=? WHERE supplier_service_id=501`, V2);
      expect((await (await GET()).json()).products).toHaveLength(1);
    } finally { fx.close(); }
  });

  it("rejects a NEW quote for unreconciled terms and allows it after reconciliation", async () => {
    const { db, fx } = await seed();
    try {
      const { POST } = await import("@/app/api/pedia/quote/route");
      const base = { product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" };
      expect((await POST(request(base))).status).toBe(200);
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "No Refill sejak sekarang." } });
      const stale = await POST(request(base));
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toBe("service_unavailable");
      // Setelah rekonsiliasi V2, quote baru boleh dan tidak membawa janji garansi lama.
      await db.execRun(`UPDATE pedia_tiers SET refill_days=0, managed_snapshot_at=? WHERE supplier_service_id=501`, V2);
      const fresh = await POST(request(base));
      expect(fresh.status).toBe(200);
    } finally { fx.close(); }
  });

  it("rejects a V1 quote that outlives a V2 reconciliation; a fresh V2 quote succeeds; persisted retry still 200", async () => {
    const { db, fx } = await seed();
    try {
      vi.spyOn(qris, "createActiveQrisInvoice").mockImplementation(async (code, amount) => ({ orderCode: code, requestedAmount: amount, payableAmount: amount, uniqueCode: 1, qrisPayload: "t", qrisUrl: "/qr.png", expires_at: "2099-01-01", expiresAt: "2099-01-01", isExisting: false }) as never);
      const { POST: quotePost } = await import("@/app/api/pedia/quote/route");
      const base = { product_id: 1, tier_id: 1, quantity: 250, target: "https://instagram.com/buyer" };
      // V1 quote sah (syarat garansi 30 hari, versi V1 tertanam).
      const v1 = await quotePost(request(base));
      expect(v1.status).toBe(200);
      const v1Token = (await v1.json()).quote_token as string;

      const { POST } = await import("@/app/api/pedia/orders/route");
      const order = (token: string) => POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "a@b.com" }));

      // V2 tiba + baris direkonsiliasi ke syarat NON-KONFLIK yang berbeda
      // (No Refill, nama tanpa klaim garansi) — quote V1 kini basi.
      await db.execRun(`UPDATE pedia_supplier_services SET name='Instagram Followers Global' WHERE service_id=501`);
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "Proses 0-6 jam. No Refill." } });
      await db.execRun(`UPDATE pedia_tiers SET refill_days=0, managed_snapshot_at=? WHERE supplier_service_id=501`, V2);

      // Quote LAMA setelah drain TETAP ditolak: tidak ada order/invoice baru.
      const stale = await order(v1Token);
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toBe("service_unavailable");
      expect(await db.queryFirst(`SELECT COUNT(*) n FROM orders`)).toMatchObject({ n: 0 });
      expect(qris.createActiveQrisInvoice).not.toHaveBeenCalled();

      // Quote BARU di versi V2 diterima.
      const v2 = await quotePost(request(base));
      expect(v2.status).toBe(200);
      const v2Token = (await v2.json()).quote_token as string;
      const created = await order(v2Token);
      expect(created.status).toBe(201);
      const code = (await created.json()).code;

      // Persisted retry tetap 200 walau snapshot bergerak lagi.
      await writeSnapshot(db, "2026-11-12T20:00:00.000Z", { 501: { status: "ok", text: "Syarat ketiga." } });
      const retry = await order(v2Token);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ code, reused: true });
    } finally { fx.close(); }
  });

  it("rejects a quote without a signed terms version (absent version cannot sell)", async () => {
    const { db, fx } = await seed();
    try {
      const { token } = await createPediaQuoteToken({
        product_id: 1, tier_id: 1, quantity: 250, target_raw: "https://instagram.com/buyer",
        target_normalized: "https://www.instagram.com/buyer/", unit_price: 32, total: 8000,
        credit_code_hash: null, credit_used: 0, supplier: "providersmm", supplier_service_id: 501,
        supplier_rate_snapshot: 20000, managed: "auto",
        service_copy: { product_name: "Followers Instagram", service_name: "Followers Instagram", description: "d", terms: "", instructions: "" },
      });
      const { POST } = await import("@/app/api/pedia/orders/route");
      const res = await POST(request({ quote_token: token, customer_wa: "081234567890", customer_email: "a@b.com" }));
      expect(res.status).toBe(409);
      expect(await db.queryFirst(`SELECT COUNT(*) n FROM orders`)).toMatchObject({ n: 0 });
    } finally { fx.close(); }
  });

  it("refuses an auto row without a valid stamp, and when no snapshot exists", async () => {
    const { fx } = await seed({ stampedVersion: null });
    try {
      const { GET } = await import("@/app/api/pedia/catalog/route");
      // Cap kosong = fail closed (fitur belum pernah deploy; tidak ada legacy
      // auto row yang sah tanpa cap).
      expect((await (await GET()).json()).products).toEqual([]);
    } finally { fx.close(); }
  });
});

describe("queue reconciliation stamps the active snapshot version", () => {
  it("stamps the version and blocks a contradicted term instead of selling it", async () => {
    const { db, fx } = await seed();
    try {
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "No Refill." } });
      const before = await db.queryFirst(`SELECT managed_snapshot_at FROM pedia_tiers WHERE supplier_service_id=501`);
      expect(before).toMatchObject({ managed_snapshot_at: V1 });
      await enqueueManagedWork(db, [501]);
      const drained = await drainManagedWork(db, 5);
      expect(drained.errors).toEqual([]);
      // Cap versi baru ditulis; kontradiksi garansi (nama vs deskripsi) =
      // fail-closed `terms_conflict`, bukan janji lama yang dijual.
      const after = await db.queryFirst(`SELECT managed_snapshot_at,refill_days,is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=501`);
      expect(after).toMatchObject({ managed_snapshot_at: V2, refill_days: 0, is_active: 0, auto_disabled_reason: "terms_conflict" });
    } finally { fx.close(); }
  });

  it("stamps a non-conflicting changed term and stays sellable under the new version", async () => {
    const { db, fx } = await seed();
    try {
      // Perubahan syarat non-konflik: nama tanpa klaim garansi + "No Refill".
      await db.execRun(`UPDATE pedia_supplier_services SET name='Instagram Followers Global' WHERE service_id=501`);
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "Proses 0-6 jam. No Refill." } });
      await enqueueManagedWork(db, [501]);
      expect((await drainManagedWork(db, 5)).errors).toEqual([]);
      const after = await db.queryFirst(`SELECT managed_snapshot_at,refill_days,is_active FROM pedia_tiers WHERE supplier_service_id=501`);
      expect(after).toMatchObject({ managed_snapshot_at: V2, refill_days: 0, is_active: 1 });
    } finally { fx.close(); }
  });
});

describe("manually paused rows reconcile terms without being revived (PSMM-LASTGOOD-PAUSE B)", () => {
  async function adminCookie() {
    const { createAdminToken, createIdleToken } = await import("@/lib/auth");
    const session = await createAdminToken("admin@axvara.test");
    return `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
  }
  const put = async (body: Record<string, unknown>) => {
    vi.stubEnv("ADMIN_EMAIL", "admin@axvara.test");
    vi.stubEnv("ADMIN_JWT_SECRET", "pedia-final-terms-secret");
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
    const cookie = await adminCookie();
    const { PUT } = await import("@/app/api/admin/pedia/products/route");
    return PUT(new Request("http://localhost/api/admin/pedia/products", {
      method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
    }) as never);
  };

  it("a paused row gains the V2 stamp while staying inactive/manual and preserves pricing", async () => {
    const { db, fx } = await seed();
    try {
      // Admin menjeda (alasan manusia) + override pricing.
      await db.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='manual', markup_pct=77 WHERE supplier_service_id=501`);
      // V2 non-konflik tiba dan drain merekonsiliasi metadata/capnya.
      await db.execRun(`UPDATE pedia_supplier_services SET name='Instagram Followers Global' WHERE service_id=501`);
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "Proses 0-6 jam. No Refill." } });
      await enqueueManagedWork(db, [501]);
      expect((await drainManagedWork(db, 5)).errors).toEqual([]);
      const row = await db.queryFirst(`SELECT is_active,auto_disabled_reason,managed_snapshot_at,refill_days,markup_pct FROM pedia_tiers WHERE supplier_service_id=501`);
      // Tetap nonaktif + alasan manusia + basis harga admin; syarat & cap baru.
      expect(row).toMatchObject({ is_active: 0, auto_disabled_reason: "manual", managed_snapshot_at: V2, refill_days: 0, markup_pct: 77 });
      // Katalog tidak menawarkannya (tetap dijeda).
      const { GET } = await import("@/app/api/pedia/catalog/route");
      expect((await (await GET()).json()).products).toEqual([]);
      // Unpause yang sah sekarang diizinkan dan layak jual dengan syarat V2.
      const res = await put({ kind: "tier", id: Number((await db.queryFirst(`SELECT id FROM pedia_tiers WHERE supplier_service_id=501`))?.id), is_active: 1 });
      expect(res.status).toBe(200);
      expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=501`))
        .toMatchObject({ is_active: 1, auto_disabled_reason: null });
      expect((await (await GET()).json()).products).toHaveLength(1);
    } finally { fx.close(); }
  });

  it("a pause that becomes contradicted in V2 cannot be forced active (409, no mutation, never auto-revived)", async () => {
    const { db, fx } = await seed();
    try {
      await db.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='manual' WHERE supplier_service_id=501`);
      // Nama tetap mengklaim garansi 30 hari + deskripsi "No Refill" = kontradiksi.
      await writeSnapshot(db, V2, { 501: { status: "ok", text: "No Refill. Tanpa garansi." } });
      await enqueueManagedWork(db, [501]);
      expect((await drainManagedWork(db, 5)).errors).toEqual([]);
      const tierId = Number((await db.queryFirst(`SELECT id FROM pedia_tiers WHERE supplier_service_id=501`))?.id);
      // Metadata/cap direkonsiliasi tetapi baris tetap tertahan (tidak auto-revive).
      expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason,managed_snapshot_at FROM pedia_tiers WHERE supplier_service_id=501`))
        .toMatchObject({ is_active: 0, auto_disabled_reason: "manual", managed_snapshot_at: V2 });
      // Admin tidak bisa memaksa aktif: rencana mesin untuk syarat V2 = terms_conflict.
      const res = await put({ kind: "tier", id: tierId, is_active: 1 });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("managed_ineligible");
      expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=501`))
        .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });
      const { GET } = await import("@/app/api/pedia/catalog/route");
      expect((await (await GET()).json()).products).toEqual([]);
    } finally { fx.close(); }
  });
});
