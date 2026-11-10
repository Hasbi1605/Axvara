// Publishing never activates existing products or overwrites admin copy/state.

import type { DatabaseAccess } from "@/lib/db-access";
import { checkTunvnBuff, isTunvnSyncEnabled } from "./client";
import { syncTunvnCatalog } from "./sync";
import {
  TUNVN_BUFF_VARIANT_B,
  tunvnBuffSellPriceIdr, tunvnChatGptSellPriceIdr,
} from "./pricing";

export const TUNVN_CHATGPT_IMAGE_URL = "/r2/products/f87f491ee2f9034845db18eb08c9236d.webp";
export const TUNVN_MUSE_SLUG = "muse-ai-1-miliar-token";

/** Produk ChatGPT TUNVN yang boleh diterbitkan (supplier_product_id upstream). */
export const TUNVN_CHATGPT_PRODUCTS = [
  { supplier_product_id: 86, name: "ChatGPT Private", slug: "chatgpt-tunvn", label: "Business 1 Bulan", sort_order: 900 },
  { supplier_product_id: 83, name: "ChatGPT Private", slug: "chatgpt-tunvn", label: "GPay 1 Bulan", sort_order: 901 },
] as const;

export const tunvnDefaultDescription = (label: string) =>
  `${label}. Pilih paket Business atau GPay; garansi mengikuti paket. Stok dan harga dapat berubah.`;

export type TunvnPublishResult =
  | { skipped: "not_configured" | "throttled" | "claimed_elsewhere" }
  | { ok: false; error: string }
  | { ok: true; chatgpt: number; buff_variants: number; idr_per_usdt: number; activated: number };

type MirrorRow = Record<string, unknown> & {
  supplier_product_id: number; price_usdt: number | null; stock: number;
  axvara_product_id: number | null; markup_percent: number;
  admin_name: string | null; admin_description: string | null;
  publish_requested: number;
};

/** Terbitkan/perbarui katalog TUNVN dari mirror tersinkron + FX saat ini.
 *  Tidak pernah mengaktifkan produk yang tidak diminta admin. */
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

  const category = await db.queryFirst("SELECT id FROM categories WHERE slug='ai-chatbot'");
  const categoryId = category ? Number(category.id) : null;
  if (!categoryId) return { ok: false, error: "category_missing" };

  let chatgpt = 0;
  let activated = 0;
  for (const spec of TUNVN_CHATGPT_PRODUCTS) {
    const mirror = await db.queryFirst(
      "SELECT * FROM tunvn_products WHERE supplier_product_id=?", spec.supplier_product_id,
    ) as MirrorRow | null;
    if (!mirror || mirror.price_usdt === null || Number(mirror.price_usdt) <= 0) {
      await db.execRun("UPDATE product_variants SET stock=0 WHERE sku=?", `TUNVN-${spec.supplier_product_id}`);
      continue;
    }
    const markup = Number(mirror.markup_percent ?? 35);
    const sku = `TUNVN-${spec.supplier_product_id}`;
    const existingVariant = await db.queryFirst("SELECT tunvn_admin_price_idr FROM product_variants WHERE sku=?", sku);
    const sell = Number(existingVariant?.tunvn_admin_price_idr) > 0 ? Number(existingVariant?.tunvn_admin_price_idr) : tunvnChatGptSellPriceIdr(Number(mirror.price_usdt), idrPerUsdt, markup);
    const displayName = String(mirror.admin_name || "").trim() || spec.name;
    const displayDescription = String(mirror.admin_description || "").trim() || tunvnDefaultDescription(spec.label);
    const requested = Number(mirror.publish_requested ?? 0) === 1;

    const bySlug = await db.queryFirst("SELECT id FROM products WHERE slug=?", spec.slug);
    let productId = bySlug ? Number(bySlug.id) : 0;
    if (!productId) {
      const created = await db.execRun(
        `INSERT INTO products (category_id, name, slug, description, price, image_url, stock, is_active, sort_order, source, fulfillment_mode, telegram_enabled)
         VALUES (?,?,?,?,?, ?, ?, ?, ?, 'manual', 'manual', 1)`,
        categoryId, displayName, spec.slug, displayDescription,
        sell, TUNVN_CHATGPT_IMAGE_URL, Number(mirror.stock ?? 0), 0, spec.sort_order,
      );
      productId = Number(created.lastInsertRowid ?? 0);
    }
    if (!productId) continue;
    const productState = await db.queryFirst("SELECT is_active FROM products WHERE id=?", productId);
    const productActive = Number(productState?.is_active ?? 0) === 1;
    await db.execRun(
      `INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
       VALUES (?,?,?,?,?, 'manual', ?, 1)
        ON CONFLICT(sku) DO UPDATE SET product_id=excluded.product_id, price=excluded.price, stock=excluded.stock,
          is_active=CASE WHEN ? = 1 THEN product_variants.is_active ELSE 0 END, updated_at=datetime('now')
          WHERE product_variants.tunvn_admin_price_idr IS ? AND EXISTS (
            SELECT 1 FROM tunvn_products WHERE supplier_product_id=? AND markup_percent=? AND publish_requested=?)`,
       productId, sku, spec.label, sell, Number(mirror.stock ?? 0), requested && productActive ? 1 : 0, requested ? 1 : 0,
       existingVariant?.tunvn_admin_price_idr ?? null, spec.supplier_product_id, markup, requested ? 1 : 0,
    );
    const variantState = await db.queryFirst("SELECT is_active,price FROM product_variants WHERE sku=?", sku);
    const visible = requested && productActive && Number(variantState?.is_active) === 1;
    if (visible) activated++;
    await db.execRun(
      "UPDATE tunvn_products SET axvara_product_id=?, sell_price_idr=?, fx_idr_per_usdt=?, visible=?, updated_at=datetime('now') WHERE supplier_product_id=?",
       productId, Number(variantState?.price ?? sell), idrPerUsdt, visible ? 1 : 0, spec.supplier_product_id,
    );
    chatgpt++;
  }
  await db.execRun("UPDATE products SET is_active=0 WHERE slug IN ('chatgpt-business-1-bulan-tunvn','chatgpt-gpay-1-bulan-tunvn')");

  const muse = await db.queryFirst("SELECT id FROM products WHERE slug=?", TUNVN_MUSE_SLUG);
  let buff = 0;
  let buffError: string | null = null;
  if (muse) {
    const museId = Number(muse.id);
    // Price exactly one unit: a 20B probe cannot establish the unit price.
    const checked = await checkTunvnBuff(1);
    if (checked.kind !== "ok") buffError = `buff_${checked.kind}`;
    else {
    for (const quantityB of TUNVN_BUFF_VARIANT_B) {
      const existing = await db.queryFirst(
        "SELECT tunvn_markup_percent, tunvn_admin_price_idr, is_active FROM product_variants WHERE sku=?",
        `TUNVN-BUFF-${quantityB}B`,
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
          museId, `TUNVN-BUFF-${quantityB}B`, `Buff Token Muse AI per ${quantityB}B`, sell, checked.fundable ? -1 : 0, keepActive,
         9 + TUNVN_BUFF_VARIANT_B.indexOf(quantityB) + 1, quantityB, costUsdt, markup, idrPerUsdt,
         existing?.tunvn_markup_percent ?? null, existing?.tunvn_admin_price_idr ?? null,
      );
      buff++;
    }
    }
  }
  await db.execRun("UPDATE product_variants SET is_active=0 WHERE sku IN ('TUNVN-BUFF-5B','TUNVN-BUFF-10B','TUNVN-BUFF-20B','TUNVN-BUFF-30B')");
  await db.execRun(`UPDATE products SET price=COALESCE((SELECT MIN(price) FROM product_variants WHERE product_id=products.id AND is_active=1),price),
    stock=CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE product_id=products.id AND is_active=1 AND stock=-1) THEN -1
      ELSE COALESCE((SELECT SUM(MAX(stock,0)) FROM product_variants WHERE product_id=products.id AND is_active=1),0) END
    WHERE slug IN ('chatgpt-tunvn','muse-ai-1-miliar-token')`);
  if (buffError) return { ok: false, error: buffError };
  return { ok: true, chatgpt, buff_variants: buff, idr_per_usdt: idrPerUsdt, activated };
  } finally {
    await db.execRun("DELETE FROM store_settings WHERE key='tunvn_catalog_lease' AND value=?", lease);
  }
}
