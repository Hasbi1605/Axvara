// Publishing never activates existing products or overwrites admin copy/state.
//
// Revisi owner 15 November 2026: SEMUA produk mirror TUNVN (kecuali #60 API
// TEST) diterbitkan sebagai produk/varian katalog AXVARA lewat peta keluarga
// statis (families.ts). Produk serupa = varian satu produk. Produk/varian baru
// selalu NONAKTIF; admin yang mengaktifkan dari menu Produk atau panel TUNVN.
//
// Anggaran statement dijaga konstan (~13 setelah sync) memakai json_each
// batching, bukan query per varian. Lease 90 detik tetap mencegah dua isolate
// menerbitkan bersamaan; guard order TUNVN menolak saat lease aktif.

import type { DatabaseAccess } from "@/lib/db-access";
import { checkTunvnBuff, isTunvnSyncEnabled } from "./client";
import { syncTunvnCatalog } from "./sync";
import { TUNVN_BUFF_VARIANT_B, tunvnBuffSellPriceIdr, tunvnSellPriceIdr } from "./pricing";
import {
  tunvnDefaultDescription, TUNVN_CHATGPT_IMAGE_URL, TUNVN_MUSE_SLUG,
  isTunvnExcludedProduct, tunvnFallbackFamily, tunvnFamilyForSupplierId, type TunvnFamily,
} from "./families";
import { mapSkCategory } from "@/lib/sekalipay/sync";

export { TUNVN_CHATGPT_IMAGE_URL, TUNVN_MUSE_SLUG, tunvnDefaultDescription };

export type TunvnPublishResult =
  | { skipped: "not_configured" | "throttled" | "claimed_elsewhere" }
  | { ok: false; error: string }
  | { ok: true; families: number; variants: number; buff_variants: number; idr_per_usdt: number; activated: number };

type Row = Record<string, unknown>;

type MirrorRow = Row & {
  supplier_product_id: number; name: string;
  price_usdt: number | null; stock: number;
  axvara_product_id: number | null; markup_percent: number;
  admin_name: string | null; admin_description: string | null;
  publish_requested: number;
};

type ProductRow = Row & {
  id: number; slug: string; tunvn_family: string | null; image_url: string | null; is_active: number;
};

type VariantRow = Row & {
  id: number; sku: string; product_id: number;
  tunvn_source_product_id: number; tunvn_admin_price_idr: number | null;
  price: number; is_active: number;
};

const RETIRED_BUNDLE_SKUS = ["TUNVN-BUFF-5B", "TUNVN-BUFF-10B", "TUNVN-BUFF-20B", "TUNVN-BUFF-30B"];

/** Terbitkan/perbarui katalog TUNVN dari mirror tersinkron + FX saat ini.
 *  Tidak pernah mengaktifkan produk/varian yang tidak diminta admin. */
export async function publishTunvnCatalog(db: DatabaseAccess, idrPerUsdt: number, opts: { force?: boolean; now?: number } = { force: true }): Promise<TunvnPublishResult> {
  if (!isTunvnSyncEnabled()) return { skipped: "not_configured" };
  if (!Number.isFinite(idrPerUsdt) || idrPerUsdt <= 0) return { ok: false, error: "fx_unavailable" };

  const now = opts.now ?? Date.now();
  const lease = JSON.stringify({ until: now + 90_000, owner: crypto.randomUUID() });
  const claimed = await db.execRun(`INSERT INTO store_settings(key,value) VALUES('tunvn_catalog_lease',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(store_settings.value,'$.until')<=?`, lease, now);
  if (claimed.changes !== 1) return { skipped: "claimed_elsewhere" };
  try {
    const synced = await syncTunvnCatalog(db, { ...opts, reserveStatements: 28 });
    if ("ok" in synced && synced.ok === false) return { ok: false, error: synced.error };
    if ("skipped" in synced) return synced;

    const mirrors = await db.queryAll("SELECT * FROM tunvn_products ORDER BY supplier_product_id") as MirrorRow[];
    const families = planFamilies(mirrors);
    if (!families.length) return { ok: true, families: 0, variants: 0, buff_variants: 0, idr_per_usdt: idrPerUsdt, activated: 0 };

    const knownSlugs = [...new Set(families.flatMap(f => [f.family.slug, ...f.family.imageFromSlugs]))];
    const products = await db.queryAll(
      `SELECT id, slug, tunvn_family, image_url, is_active FROM products
        WHERE tunvn_family IS NOT NULL OR slug LIKE '%tunvn' OR slug IN (${knownSlugs.map(() => "?").join(",")})`,
      ...knownSlugs,
    ) as ProductRow[];
    const productBySlug = new Map(products.map(p => [String(p.slug), p]));

    const accountVariants = await db.queryAll(
      `SELECT id, sku, product_id, tunvn_source_product_id, tunvn_admin_price_idr, price, is_active
         FROM product_variants WHERE tunvn_source_product_id IS NOT NULL`,
    ) as VariantRow[];

    const categories = await db.queryAll("SELECT id, slug FROM categories");
    const categoryIds = new Set(categories.map(c => Number(c.id)));
    const fallbackCategory = Number(categories.find(c => String(c.slug) === "ai-chatbot")?.id ?? 0) || null;

    const existingSlugs = new Set(productBySlug.keys());
    const plans = families.map(({ family, rows }) => {
      const existing = productBySlug.get(family.slug);
      const productId = existing ? Number(existing.id) : null;
      const slug = existing ? family.slug : uniqueSlug(family.slug, existingSlugs);
      const mappedCategory = mapSkCategory(family.name);
      const categoryId = categoryIds.has(mappedCategory) ? mappedCategory : fallbackCategory;
      if (!categoryId) return null;
      const image = resolveImage(family, productBySlug) ?? family.imageUrl ?? null;
      const members = rows.map(mirror => {
        const row = family.members.find(m => m.supplier_product_id === Number(mirror.supplier_product_id))!;
        const usable = mirror.price_usdt !== null && Number(mirror.price_usdt) > 0;
        const markup = Number(mirror.markup_percent ?? 35);
        const sell = usable ? tunvnSellPriceIdr(Number(mirror.price_usdt), idrPerUsdt, markup) : 0;
        return { mirror, row, usable, markup, sell };
      });
      const price = members.reduce((min, m) => (m.usable ? Math.min(min, m.sell) : min), Number.POSITIVE_INFINITY);
      const stock = members.reduce((sum, m) => sum + Math.max(0, Number(m.mirror.stock ?? 0)), 0);
      return { family, rows, existing, productId, slug, categoryId, image, members, price: Number.isFinite(price) ? price : 0, stock };
    }).filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

    if (!plans.length) return { ok: false, error: "category_missing" };

    const newProducts = plans.filter(plan => !plan.existing);
    if (newProducts.length) {
      await db.execRun(INSERT_PRODUCTS_SQL, JSON.stringify(newProducts.map(plan => ({
        category: plan.categoryId,
        name: plan.family.name,
        slug: plan.slug,
        description: tunvnDefaultDescription(plan.family.name),
        price: plan.price,
        image: plan.image,
        stock: plan.stock,
        family: plan.family.markFamily === false ? null : plan.family.key,
      }))));
    }

    const variantBySource = new Map(accountVariants.map(v => [Number(v.tunvn_source_product_id), v]));
    const inserts: Row[] = [];
    const updates: Row[] = [];
    for (const plan of plans) {
      for (const member of plan.members) {
        const id = Number(member.mirror.supplier_product_id);
        const existing = variantBySource.get(id);
        const price = member.usable && existing && Number(existing.tunvn_admin_price_idr) > 0
          ? Number(existing.tunvn_admin_price_idr)
          : member.usable ? member.sell : existing ? Number(existing.price) : 0;
        const stock = member.usable ? Math.max(0, Number(member.mirror.stock ?? 0)) : 0;
        if (!existing) {
          inserts.push({ slug: plan.slug, sku: `TUNVN-${id}`, label: member.row.label, price, stock, sort: member.row.sort, sid: id });
        } else {
          updates.push({ vid: Number(existing.id), price, stock, admin_price: existing.tunvn_admin_price_idr ?? null, markup: member.markup, cas: 1 });
        }
      }
      // Varian akun yang mirror-nya hilang tetap ada (histori) tetapi stok 0.
      const memberIds = new Set(plan.members.map(m => Number(m.mirror.supplier_product_id)));
      for (const variant of accountVariants) {
        if (Number(variant.product_id) !== Number(plan.productId) || memberIds.has(Number(variant.tunvn_source_product_id))) continue;
        updates.push({ vid: Number(variant.id), price: Number(variant.price), stock: 0, admin_price: variant.tunvn_admin_price_idr ?? null, markup: 0, cas: 0 });
      }
    }

    if (inserts.length) await db.execRun(INSERT_VARIANTS_SQL, JSON.stringify(inserts));
    if (updates.length) await db.execRun(UPDATE_VARIANTS_SQL, JSON.stringify(updates));

    await db.execRun(UPDATE_MIRRORS_SQL, idrPerUsdt, JSON.stringify(plans.flatMap(plan => plan.members.map(member => {
      const id = Number(member.mirror.supplier_product_id);
      // Modal tidak valid: pertahankan harga jual tersimpan, jangan tulis 0.
      const previous = variantBySource.get(id);
      return { sid: id, slug: plan.slug, sell: member.usable ? member.sell : previous ? Number(previous.price) : 0 };
    }))));

    await db.execRun("UPDATE products SET is_active=0 WHERE slug IN ('chatgpt-business-1-bulan-tunvn','chatgpt-gpay-1-bulan-tunvn')");
    await db.execRun(`UPDATE product_variants SET is_active=0 WHERE sku IN (${RETIRED_BUNDLE_SKUS.map(() => "?").join(",")})`, ...RETIRED_BUNDLE_SKUS);

    // Buff Muse: perilaku lama dipertahankan (probe tanpa charge, harga manual
    // admin, saklar admin tidak diubah sync).
    const museId = productIdOf(productBySlug.get(TUNVN_MUSE_SLUG))
      || Number((await db.queryFirst("SELECT id FROM products WHERE slug=?", TUNVN_MUSE_SLUG))?.id ?? 0);
    let buff = 0;
    let buffError: string | null = null;
    if (museId > 0) {
      const checked = await checkTunvnBuff(1);
      if (checked.kind !== "ok") buffError = `buff_${checked.kind}`;
      else {
        for (const quantityB of TUNVN_BUFF_VARIANT_B) {
          const sku = `TUNVN-BUFF-${quantityB}B`;
          const existing = await db.queryFirst(
            "SELECT tunvn_markup_percent, tunvn_admin_price_idr, is_active FROM product_variants WHERE sku=?",
            sku,
          );
          const markup = existing?.tunvn_markup_percent !== null && existing?.tunvn_markup_percent !== undefined
            ? Number(existing.tunvn_markup_percent) : 40;
          const adminPrice = existing?.tunvn_admin_price_idr !== null && existing?.tunvn_admin_price_idr !== undefined
            ? Number(existing.tunvn_admin_price_idr) : null;
          const sell = adminPrice !== null && adminPrice > 0
            ? adminPrice
            : tunvnBuffSellPriceIdr(quantityB, idrPerUsdt, { markupPercent: markup, costUsdtPerB: checked.sell_price_usdt });
          const costUsdt = checked.sell_price_usdt * quantityB;
          const keepActive = existing ? Number(existing.is_active ?? 0) : 0;
          await db.execRun(
            `INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt,buyer_field_key,max_qty)
             VALUES (?,?,?,?, ?, 'manual', ?, ?, ?, ?, ?, ?, 'muse_invite_code',30)
             ON CONFLICT(sku) DO UPDATE SET price=excluded.price, stock=excluded.stock, tunvn_cost_usdt=excluded.tunvn_cost_usdt,
               tunvn_markup_percent=excluded.tunvn_markup_percent, tunvn_fx_idr_per_usdt=excluded.tunvn_fx_idr_per_usdt,
               updated_at=datetime('now') WHERE product_variants.tunvn_markup_percent IS ? AND product_variants.tunvn_admin_price_idr IS ?`,
            museId, sku, `Buff Token Muse AI per ${quantityB}B`, sell, checked.fundable ? -1 : 0, keepActive,
            9 + TUNVN_BUFF_VARIANT_B.indexOf(quantityB) + 1, quantityB, costUsdt, markup, idrPerUsdt,
            existing?.tunvn_markup_percent ?? null, existing?.tunvn_admin_price_idr ?? null,
          );
          buff++;
        }
      }
    }
    await db.execRun(RECOMPUTE_PRODUCTS_SQL);

    if (buffError) return { ok: false, error: buffError };
    const productActiveBySlug = new Map(plans.map(plan => [plan.slug, plan.existing ? Number(plan.existing.is_active ?? 0) === 1 : false]));
    const activated = plans.reduce((count, plan) => count + plan.members.filter(member => {
      const id = Number(member.mirror.supplier_product_id);
      const variant = variantBySource.get(id);
      return Boolean(variant) && Number(variant!.is_active) === 1 && productActiveBySlug.get(plan.slug) === true;
    }).length, 0);
    return { ok: true, families: plans.length, variants: inserts.length + updates.filter(row => Number(row.cas) === 1).length, buff_variants: buff, idr_per_usdt: idrPerUsdt, activated };
  } finally {
    await db.execRun("DELETE FROM store_settings WHERE key='tunvn_catalog_lease' AND value=?", lease);
  }
}

type FamilyPlan = { family: TunvnFamily; rows: MirrorRow[] };

/** Kelompokkan mirror per keluarga. Id tak dikenal memakai fallback 1:1. */
export function planFamilies(mirrors: MirrorRow[]): FamilyPlan[] {
  const byKey = new Map<string, FamilyPlan>();
  for (const mirror of mirrors) {
    const id = Number(mirror.supplier_product_id);
    // #60 (API TEST) tidak pernah masuk katalog, bahkan sebagai fallback.
    if (isTunvnExcludedProduct(id)) continue;
    const mapped = tunvnFamilyForSupplierId(id);
    const family = mapped?.family ?? tunvnFallbackFamily(id, String(mirror.name ?? ""));
    const plan = byKey.get(family.key) ?? { family, rows: [] };
    plan.rows.push(mirror);
    byKey.set(family.key, plan);
  }
  return [...byKey.values()].sort((a, b) => a.family.slug.localeCompare(b.family.slug));
}

function productIdOf(product: ProductRow | undefined): number {
  return product ? Number(product.id) : 0;
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base;
  for (let attempt = 2; attempt < 8 && taken.has(slug); attempt++) slug = `${base.slice(0, 74)}-${attempt}`;
  taken.add(slug);
  return slug;
}

/** Gambar dari produk existing: kandidat pertama (urutan peta) yang punya URL. */
function resolveImage(family: TunvnFamily, bySlug: Map<string, ProductRow>): string | null {
  for (const slug of family.imageFromSlugs) {
    const url = bySlug.get(slug)?.image_url;
    if (typeof url === "string" && url.trim()) return url;
  }
  return null;
}

const INSERT_PRODUCTS_SQL = `INSERT INTO products
  (category_id,name,slug,description,price,image_url,stock,is_active,sort_order,source,fulfillment_mode,telegram_enabled,tunvn_family,created_at,updated_at)
SELECT json_extract(j.value,'$.category'),json_extract(j.value,'$.name'),json_extract(j.value,'$.slug'),
  json_extract(j.value,'$.description'),json_extract(j.value,'$.price'),json_extract(j.value,'$.image'),
  json_extract(j.value,'$.stock'),0,
  COALESCE((SELECT MIN(999989, MAX(sort_order)) + 10 FROM products),10),
  'manual','manual',1,json_extract(j.value,'$.family'),datetime('now'),datetime('now')
FROM json_each(?) AS j
WHERE NOT EXISTS(SELECT 1 FROM products p WHERE p.slug=json_extract(j.value,'$.slug'))`;

const INSERT_VARIANTS_SQL = `INSERT INTO product_variants
  (product_id,sku,label,price,stock,fulfillment_mode,is_active,sort_order,tunvn_source_product_id,created_at,updated_at)
SELECT p.id,json_extract(j.value,'$.sku'),json_extract(j.value,'$.label'),json_extract(j.value,'$.price'),
  json_extract(j.value,'$.stock'),'manual',0,json_extract(j.value,'$.sort'),json_extract(j.value,'$.sid'),
  datetime('now'),datetime('now')
FROM json_each(?) AS j JOIN products p ON p.slug=json_extract(j.value,'$.slug')
WHERE NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.tunvn_source_product_id=json_extract(j.value,'$.sid'))
ON CONFLICT(sku) DO UPDATE SET tunvn_source_product_id=excluded.tunvn_source_product_id
  WHERE product_variants.tunvn_source_product_id IS NULL`;

const UPDATE_VARIANTS_SQL = `UPDATE product_variants AS pv
SET price=json_extract(j.value,'$.price'), stock=json_extract(j.value,'$.stock'), updated_at=datetime('now')
FROM json_each(?) AS j
WHERE pv.id=json_extract(j.value,'$.vid') AND pv.tunvn_source_product_id IS NOT NULL
  AND pv.tunvn_admin_price_idr IS json_extract(j.value,'$.admin_price')
  AND (json_extract(j.value,'$.cas')=0 OR EXISTS(SELECT 1 FROM tunvn_products t
        WHERE t.supplier_product_id=pv.tunvn_source_product_id AND t.markup_percent=json_extract(j.value,'$.markup')))
  AND (pv.price IS NOT json_extract(j.value,'$.price') OR pv.stock IS NOT json_extract(j.value,'$.stock'))`;

const UPDATE_MIRRORS_SQL = `UPDATE tunvn_products AS t
SET axvara_product_id=(SELECT p.id FROM products p WHERE p.slug=json_extract(j.value,'$.slug')),
  sell_price_idr=json_extract(j.value,'$.sell'),
  fx_idr_per_usdt=?,
  publish_requested=CASE WHEN EXISTS(SELECT 1 FROM product_variants pv WHERE pv.tunvn_source_product_id=t.supplier_product_id AND pv.is_active=1) THEN 1 ELSE 0 END,
  visible=CASE WHEN EXISTS(SELECT 1 FROM product_variants pv JOIN products p ON p.id=pv.product_id
    WHERE pv.tunvn_source_product_id=t.supplier_product_id AND pv.is_active=1 AND p.is_active=1) THEN 1 ELSE 0 END,
  updated_at=datetime('now')
FROM json_each(?) AS j
WHERE t.supplier_product_id=json_extract(j.value,'$.sid')`;

const RECOMPUTE_PRODUCTS_SQL = `UPDATE products SET
  price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
  stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
    ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END,
  updated_at=datetime('now')
WHERE EXISTS(SELECT 1 FROM product_variants pv WHERE pv.product_id=products.id
  AND (pv.tunvn_source_product_id IS NOT NULL OR pv.tunvn_buff_quantity_b IS NOT NULL))`;
