// tests/pedia-final-admin-api.integration.test.ts — PSMM-FINAL-PATCH E (2026-11-12).
// Membuktikan: filter kelayakan diterapkan di SQL SEBELUM COUNT/LIMIT sehingga
// total & paginasi benar (bukan saring 50 baris klien), default tidak menyembunyikan
// tipe yang diblokir/Custom Comments; dan body admin yang dipalsukan tidak dapat
// memetakan ulang sumber baris `managed='auto'` (supplier/layanan/input/refill/
// salinan), sementara pricing & jeda tetap boleh.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { seedOfficialDescriptions } from "./helpers/pedia-managed-fixture";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const fx = createD1Fixture();
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "pedia-final-admin-secret");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  const session = await createAdminToken("admin@axvara.tech");
  const cookie = `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
  const db = createDatabaseAccess(fx.db);
  return { fx, db, cookie };
}

/** 60 layanan: 30 auto-aktif, 20 auto-ditahan, 10 belum otomatis (termasuk Custom Comments). */
async function seedServices(db: ReturnType<typeof createDatabaseAccess>) {
  for (let i = 0; i < 60; i++) {
    const id = 1000 + i;
    const state = i < 30 ? "active" : i < 50 ? "blocked" : "unmanaged";
    const type = state === "unmanaged" && i % 2 === 0 ? "Custom Comments" : "Default";
    await db.execRun(
      `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
       VALUES ('providersmm',?,?,'Instagram','${type}',20000,20,10000,1)`, id, `Layanan ${id}`,
    );
    if (state === "unmanaged") continue;
    await db.execRun(
      `INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed)
       VALUES (?,'instagram','followers','profile',?,'[100]',1,1,'auto')`, `psmm-${id}`, `Produk ${id}`,
    );
    const product = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug=?`, `psmm-${id}`);
    await db.execRun(
      `INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,package_prices_json,is_active,managed)
       VALUES (?, 'standar','providersmm',?,'G2',60,2000,'{"100":4000}',?,'auto')`,
      Number(product?.id), id, state === "active" ? 1 : 0,
    );
  }
}

async function getServices(cookie: string, qs: string) {
  const { GET } = await import("@/app/api/admin/pedia/services/route");
  return GET(new NextRequest(`http://localhost/?${qs}`, { headers: { cookie } }));
}

describe("server-side eligibility filter (SQL before COUNT/LIMIT)", () => {
  it("counts and paginates the filtered set, not a single 50-row page", async () => {
    const { db, fx, cookie } = await fixture();
    await seedServices(db);
    try {
      const active = await (await getServices(cookie, "supplier=providersmm&managed=active")).json();
      expect(active.total).toBe(30);
      expect(active.rows).toHaveLength(30);

      const blocked = await (await getServices(cookie, "supplier=providersmm&managed=blocked")).json();
      expect(blocked.total).toBe(20);
      expect(blocked.rows).toHaveLength(20);

      const unmanaged = await (await getServices(cookie, "supplier=providersmm&managed=unmanaged")).json();
      expect(unmanaged.total).toBe(10);
      expect(unmanaged.rows).toHaveLength(10);

      // Paginasi benar: halaman 2 dari 30 baris aktif = 30 - 50 → kosong, bukan salah hitung.
      const page2 = await (await getServices(cookie, "supplier=providersmm&managed=active&page=2")).json();
      expect(page2.total).toBe(30);
      expect(page2.rows).toHaveLength(0);
    } finally { fx.close(); }
  });

  it("default view keeps every service visible incl. Custom Comments and blocked types", async () => {
    const { db, fx, cookie } = await fixture();
    await seedServices(db);
    try {
      const all = await (await getServices(cookie, "supplier=providersmm")).json();
      expect(all.total).toBe(60);
      // Custom Comments berada di halaman 2 (peringkat service_id); tetap muncul
      // karena default TIDAK menyaring tipe/mapping ataupun status blokir.
      const page2 = await (await getServices(cookie, "supplier=providersmm&page=2")).json();
      expect(all.rows.length + page2.rows.length).toBe(60);
      expect([...all.rows, ...page2.rows].some((r: Record<string, unknown>) => r.type === "Custom Comments")).toBe(true);
      // Filter tak dikenal diabaikan (bukan menampilkan nol diam-diam).
      const bogus = await (await getServices(cookie, "supplier=providersmm&managed=whatever")).json();
      expect(bogus.total).toBe(60);
    } finally { fx.close(); }
  });
});

describe("managed source fields cannot be forged through the admin API", () => {
  async function seedOneTier(db: ReturnType<typeof createDatabaseAccess>) {
    await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES ('providersmm',900,'IG Followers','Instagram Followers','Default',20000,20,10000,1)`);
    await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES ('providersmm',901,'IG Likes','Instagram Likes','Default',20000,20,10000,1)`);
    await db.execRun(`INSERT INTO pedia_products (slug,platform,metric,target_kind,name,packages_json,step,is_active,managed) VALUES ('psmm-900','instagram','followers','profile','Produk 900','[100]',1,1,'auto')`);
    const product = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug='psmm-900'`);
    await db.execRun(
      `INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,refill_days,package_prices_json,is_active,managed,public_name,description_md,input_kind)
       VALUES (?,'standar','providersmm',900,'G2',60,2000,0,'{"100":4000}',1,'auto','Nama sumber','Deskripsi sumber',NULL)`,
      Number(product?.id),
    );
    await seedOfficialDescriptions(db, [900]);
    return Number((await db.queryFirst(`SELECT id FROM pedia_tiers WHERE supplier_service_id=900`))?.id);
  }

  it("ignores forged supplier/service/input/refill/copy but applies allowed pricing and pause", async () => {
    const { db, fx, cookie } = await fixture();
    const tierId = await seedOneTier(db);
    try {
      const { PUT } = await import("@/app/api/admin/pedia/products/route");
      const res = await PUT(new Request("http://localhost/api/admin/pedia/products", {
        method: "PUT", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "tier", id: tierId,
          // Field sumber PALSU — harus diabaikan untuk baris auto.
          supplier: "providersmm", supplier_service_id: 901, input_kind: "", refill_days: 30,
          public_name: "Sumber ditimpa", description_md: "Timpa sumber",
          // Field yang diizinkan.
          markup_pct: 75, min_profit_rp: 2500, is_active: 0,
        }),
      }) as never);
      expect(res.status).toBe(200);
      const row = await db.queryFirst(`SELECT supplier,supplier_service_id,input_kind,refill_days,public_name,description_md,markup_pct,min_profit_rp,is_active,auto_disabled_reason FROM pedia_tiers WHERE id=?`, tierId);
      expect(row).toMatchObject({
        supplier_service_id: 900, input_kind: null, refill_days: 0,
        public_name: "Nama sumber", description_md: "Deskripsi sumber",
        markup_pct: 75, min_profit_rp: 2500, is_active: 0, auto_disabled_reason: "manual",
      });
    } finally { fx.close(); }
  });

  it("still lets a forged remap through for curated (human-owned) rows", async () => {
    const { db, fx, cookie } = await fixture();
    const tierId = await seedOneTier(db);
    try {
      await db.execRun(`UPDATE pedia_tiers SET managed='curated' WHERE id=?`, tierId);
      const { PUT } = await import("@/app/api/admin/pedia/products/route");
      const res = await PUT(new Request("http://localhost/api/admin/pedia/products", {
        method: "PUT", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ kind: "tier", id: tierId, supplier: "providersmm", supplier_service_id: 901 }),
      }) as never);
      expect(res.status).toBe(200);
      expect(await db.queryFirst(`SELECT supplier_service_id FROM pedia_tiers WHERE id=?`, tierId)).toMatchObject({ supplier_service_id: 901 });
    } finally { fx.close(); }
  });

  it("refuses to force-activate a machine-blocked managed tier (no mutation), but normal pause/unpause works", async () => {
    const { db, fx, cookie } = await fixture();
    const tierId = await seedOneTier(db);
    try {
      const { PUT } = await import("@/app/api/admin/pedia/products/route");
      const put = (body: Record<string, unknown>) => PUT(new Request("http://localhost/api/admin/pedia/products", {
        method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
      }) as never);
      // Alasan mesin yang memblokir: admin hanya menyentuh pricing + is_active=1.
      await db.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason='terms_conflict' WHERE id=?`, tierId);
      const forged = await put({ kind: "tier", id: tierId, is_active: 1, markup_pct: 75, min_profit_rp: 2500 });
      expect(forged.status).toBe(409);
      expect((await forged.json()).error).toBe("managed_ineligible");
      // Tidak ada mutasi: alasan mesin dan harga tidak berubah.
      expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason,markup_pct FROM pedia_tiers WHERE id=?`, tierId))
        .toMatchObject({ is_active: 0, auto_disabled_reason: "terms_conflict", markup_pct: 60 });

      // type_unsupported / warranty_unconfirmed juga tertahan.
      for (const reason of ["type_unsupported", "warranty_unconfirmed"]) {
        await db.execRun(`UPDATE pedia_tiers SET is_active=0, auto_disabled_reason=? WHERE id=?`, reason, tierId);
        expect((await put({ kind: "tier", id: tierId, is_active: 1 })).status).toBe(409);
        expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE id=?`, tierId))
          .toMatchObject({ is_active: 0, auto_disabled_reason: reason });
      }

      // Jeda normal (aktif→0) sukses dan menulis alasan manusia.
      await db.execRun(`UPDATE pedia_tiers SET is_active=1, auto_disabled_reason=NULL WHERE id=?`, tierId);
      expect((await put({ kind: "tier", id: tierId, is_active: 0 })).status).toBe(200);
      expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE id=?`, tierId))
        .toMatchObject({ is_active: 0, auto_disabled_reason: "manual" });
      // Unpause yang SAH (alasan manusia, bukan mesin) tetap boleh.
      expect((await put({ kind: "tier", id: tierId, is_active: 1 })).status).toBe(200);
      expect(await db.queryFirst(`SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE id=?`, tierId))
        .toMatchObject({ is_active: 1, auto_disabled_reason: null });
      // Pricing saja pada baris aktif tidak memicu gate.
      expect((await put({ kind: "tier", id: tierId, markup_pct: 80 })).status).toBe(200);
    } finally { fx.close(); }
  });

  it("protects managed product mapping fields while allowing display/pause controls", async () => {
    const { db, fx, cookie } = await fixture();
    const tierId = await seedOneTier(db);
    try {
      const product = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug='psmm-900'`);
      const productId = Number(product?.id);
      const { PUT } = await import("@/app/api/admin/pedia/products/route");
      const put = (body: Record<string, unknown>) => PUT(new Request("http://localhost/api/admin/pedia/products", {
        method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body),
      }) as never);
      // Percobaan mengubah sumber mapping/nama lewat kind:product harus diabaikan.
      const res = await put({ id: productId, name: "Nama Ditimpa", platform: "tiktok", metric: "likes", target_kind: "video", slug: "hacked", packages_json: "[1]", step: 1, tagline: "Tagline baru" });
      expect(res.status).toBe(200);
      const after = await db.queryFirst(`SELECT slug,platform,metric,target_kind,name,tagline FROM pedia_products WHERE id=?`, productId);
      expect(after).toMatchObject({ slug: "psmm-900", platform: "instagram", metric: "followers", target_kind: "profile", name: "Produk 900", tagline: "Tagline baru" });
      // Pause produk auto tetap boleh.
      expect((await put({ id: productId, is_active: 0 })).status).toBe(200);
      expect(await db.queryFirst(`SELECT is_active FROM pedia_products WHERE id=?`, productId)).toMatchObject({ is_active: 0 });
      void tierId;
    } finally { fx.close(); }
  });
});
