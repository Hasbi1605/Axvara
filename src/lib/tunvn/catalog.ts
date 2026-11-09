// src/lib/tunvn/catalog.ts — publikasi katalog TUNVN yang disetujui owner.
//
// Scope 9 Nov 2026: hanya dua produk ChatGPT TUNVN diterbitkan sebagai produk
// Market (gambar memakai aset ChatGPT AXVARA existing yang sama dengan produk
// WR id 12 / SK id 85), dan Buff Token menjadi varian produk Muse manual.
// Harga dihitung dari modal USDT x FX snapshot x markup (35% ChatGPT, 40%
// Buff) lewat pricing.ts. Fungsi ini idempoten: aman dipanggil ulang dari
// panel admin; tidak pernah menimpa nama/deskripsi/harga yang sudah diedit
// admin selain menulis ulang harga hasil rumus pada baris TUNVN sendiri.

import type { DatabaseAccess } from "@/lib/db-access";
import { isTunvnSyncEnabled } from "./client";
import { syncTunvnCatalog } from "./sync";
import {
  TUNVN_BUFF_MARKUP_PERCENT, TUNVN_BUFF_VARIANT_B, TUNVN_CHATGPT_MARKUP_PERCENT,
  tunvnBuffSellPriceIdr, tunvnChatGptSellPriceIdr,
} from "./pricing";

export const TUNVN_CHATGPT_IMAGE_URL = "/r2/products/f87f491ee2f9034845db18eb08c9236d.webp";
export const TUNVN_MUSE_SLUG = "muse-ai-1-miliar-token";

/** Produk ChatGPT TUNVN yang diterbitkan (supplier_product_id upstream). */
export const TUNVN_CHATGPT_PRODUCTS = [
  { supplier_product_id: 86, name: "ChatGPT Business 1 Bulan (TUNVN)", slug: "chatgpt-business-1-bulan-tunvn", label: "ChatGPT Business 1 Bulan", sort_order: 900 },
  { supplier_product_id: 83, name: "ChatGPT GPay 1 Bulan (TUNVN)", slug: "chatgpt-gpay-1-bulan-tunvn", label: "ChatGPT GPay 1 Bulan", sort_order: 901 },
] as const;

export type TunvnPublishResult =
  | { skipped: "not_configured" }
  | { ok: false; error: string }
  | { ok: true; chatgpt: number; buff_variants: number; idr_per_usdt: number };

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Terbitkan/perbarui katalog TUNVN dari mirror tersinkron + FX saat ini. */
export async function publishTunvnCatalog(db: DatabaseAccess, idrPerUsdt: number): Promise<TunvnPublishResult> {
  if (!isTunvnSyncEnabled()) return { skipped: "not_configured" };
  if (!Number.isFinite(idrPerUsdt) || idrPerUsdt <= 0) return { ok: false, error: "fx_unavailable" };

  const synced = await syncTunvnCatalog(db, { force: true });
  if ("ok" in synced && synced.ok === false) return { ok: false, error: synced.error };
  if (!("ok" in synced) || synced.ok !== true) return { ok: false, error: "sync_not_run" };

  const category = await db.queryFirst("SELECT id FROM categories WHERE slug='ai-chatbot'");
  const categoryId = category ? Number(category.id) : null;
  if (!categoryId) return { ok: false, error: "category_missing" };

  let chatgpt = 0;
  for (const spec of TUNVN_CHATGPT_PRODUCTS) {
    const mirror = await db.queryFirst(
      "SELECT * FROM tunvn_products WHERE supplier_product_id=?", spec.supplier_product_id,
    );
    if (!mirror || mirror.price_usdt === null || Number(mirror.price_usdt) <= 0) continue;
    const sell = tunvnChatGptSellPriceIdr(Number(mirror.price_usdt), idrPerUsdt);
    const sku = `TUNVN-${spec.supplier_product_id}`;

    let productId = mirror.axvara_product_id !== null && mirror.axvara_product_id !== undefined
      ? Number(mirror.axvara_product_id) : 0;
    if (!productId) {
      const bySlug = await db.queryFirst("SELECT id FROM products WHERE slug=?", spec.slug);
      productId = bySlug ? Number(bySlug.id) : 0;
    }
    if (!productId) {
      const created = await db.execRun(
        `INSERT INTO products (category_id, name, slug, description, price, image_url, stock, is_active, sort_order, source, fulfillment_mode, telegram_enabled)
         VALUES (?,?,?,?,?, ?, ?, 1, ?, 'manual', 'manual', 1)`,
        categoryId, spec.name, spec.slug,
        `${spec.label} dari supplier TUNVN. Garansi mengikuti masa garansi supplier; stok dan harga mengikuti katalog TUNVN.`,
        sell, TUNVN_CHATGPT_IMAGE_URL, Number(mirror.stock ?? 0), spec.sort_order,
      );
      productId = Number(created.lastInsertRowid ?? 0);
    } else {
      await db.execRun(
        "UPDATE products SET price=?, stock=?, image_url=?, is_active=1, updated_at=datetime('now') WHERE id=?",
        sell, Number(mirror.stock ?? 0), TUNVN_CHATGPT_IMAGE_URL, productId,
      );
    }
    if (!productId) continue;
    await db.execRun(
      `INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
       VALUES (?,?,?,?,?, 'manual', 1, 1)
       ON CONFLICT(sku) DO UPDATE SET price=excluded.price, stock=excluded.stock, is_active=1, updated_at=datetime('now')`,
      productId, sku, spec.label, sell, Number(mirror.stock ?? 0),
    );
    await db.execRun(
      "UPDATE tunvn_products SET axvara_product_id=?, markup_percent=?, sell_price_idr=?, fx_idr_per_usdt=?, visible=1, updated_at=datetime('now') WHERE supplier_product_id=?",
      productId, TUNVN_CHATGPT_MARKUP_PERCENT, sell, idrPerUsdt, spec.supplier_product_id,
    );
    chatgpt++;
  }

  const muse = await db.queryFirst("SELECT id FROM products WHERE slug=?", TUNVN_MUSE_SLUG);
  let buff = 0;
  if (muse) {
    const museId = Number(muse.id);
    for (const quantityB of TUNVN_BUFF_VARIANT_B) {
      const sell = tunvnBuffSellPriceIdr(quantityB, idrPerUsdt);
      const costUsdt = 0.0588 * quantityB;
      await db.execRun(
        `INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
         VALUES (?,?,?,?, -1, 'manual', 1, ?, ?, ?, ?, ?)
         ON CONFLICT(sku) DO UPDATE SET price=excluded.price, tunvn_cost_usdt=excluded.tunvn_cost_usdt, tunvn_markup_percent=excluded.tunvn_markup_percent, tunvn_fx_idr_per_usdt=excluded.tunvn_fx_idr_per_usdt, is_active=1, updated_at=datetime('now')`,
        museId, `TUNVN-BUFF-${quantityB}B`, `Buff Token Muse AI ${quantityB}B`, sell,
        9 + TUNVN_BUFF_VARIANT_B.indexOf(quantityB) + 1, quantityB, costUsdt, TUNVN_BUFF_MARKUP_PERCENT, idrPerUsdt,
      );
      buff++;
    }
  }
  return { ok: true, chatgpt, buff_variants: buff, idr_per_usdt: idrPerUsdt };
}

export { slugify as tunvnSlugify };
