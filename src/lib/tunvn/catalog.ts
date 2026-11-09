// src/lib/tunvn/catalog.ts — publikasi katalog TUNVN yang dikendalikan admin.
//
// Scope 9 Nov 2026: hanya dua produk ChatGPT TUNVN yang dapat diterbitkan
// sebagai produk Market (gambar memakai aset ChatGPT AXVARA existing yang
// sama dengan produk WR id 12 / SK id 85), dan Buff Token menjadi varian
// produk Muse manual. Owner meminta semua TUNVN DIMATIKAN dari publik
// sampai diatur dari panel admin:
//
// - Produk hanya tampil bila admin menyalakan publish_requested DAN produk
//   Market + variannya aktif. Publish/sync tidak pernah memaksa is_active=1.
// - markup_percent, admin_name, dan admin_description adalah milik admin di
//   tunvn_products; sync tidak menimpanya. Nama/deskripsi kosong = teks
//   bawaan AXVARA di bawah.
// - Harga terbit = modal USDT x FX segar x (1+markup admin). FX lama tersimpan
//   di tunvn_products.fx_idr_per_usdt dan tidak menghancurkan harga hanya
//   karena snapshot baru belum tersedia (harga tetap, ditandai peringatan
//   di panel lewat fx comparison).

import type { DatabaseAccess } from "@/lib/db-access";
import { isTunvnSyncEnabled } from "./client";
import { syncTunvnCatalog } from "./sync";
import {
  TUNVN_BUFF_COST_USDT_PER_B, TUNVN_BUFF_VARIANT_B,
  tunvnBuffSellPriceIdr, tunvnChatGptSellPriceIdr,
} from "./pricing";

export const TUNVN_CHATGPT_IMAGE_URL = "/r2/products/f87f491ee2f9034845db18eb08c9236d.webp";
export const TUNVN_MUSE_SLUG = "muse-ai-1-miliar-token";

/** Produk ChatGPT TUNVN yang boleh diterbitkan (supplier_product_id upstream). */
export const TUNVN_CHATGPT_PRODUCTS = [
  { supplier_product_id: 86, name: "ChatGPT Business 1 Bulan (TUNVN)", slug: "chatgpt-business-1-bulan-tunvn", label: "ChatGPT Business 1 Bulan", sort_order: 900 },
  { supplier_product_id: 83, name: "ChatGPT GPay 1 Bulan (TUNVN)", slug: "chatgpt-gpay-1-bulan-tunvn", label: "ChatGPT GPay 1 Bulan", sort_order: 901 },
] as const;

export const tunvnDefaultDescription = (label: string) =>
  `${label} dari supplier TUNVN. Garansi mengikuti masa garansi supplier; stok dan harga mengikuti katalog TUNVN.`;

export type TunvnPublishResult =
  | { skipped: "not_configured" }
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
  let activated = 0;
  for (const spec of TUNVN_CHATGPT_PRODUCTS) {
    const mirror = await db.queryFirst(
      "SELECT * FROM tunvn_products WHERE supplier_product_id=?", spec.supplier_product_id,
    ) as MirrorRow | null;
    if (!mirror || mirror.price_usdt === null || Number(mirror.price_usdt) <= 0) continue;
    const markup = Number(mirror.markup_percent ?? 35);
    const sell = tunvnChatGptSellPriceIdr(Number(mirror.price_usdt), idrPerUsdt, markup);
    const sku = `TUNVN-${spec.supplier_product_id}`;
    const displayName = String(mirror.admin_name || "").trim() || spec.name;
    const displayDescription = String(mirror.admin_description || "").trim() || tunvnDefaultDescription(spec.label);
    const requested = Number(mirror.publish_requested ?? 0) === 1;

    let productId = mirror.axvara_product_id !== null && mirror.axvara_product_id !== undefined
      ? Number(mirror.axvara_product_id) : 0;
    if (!productId) {
      const bySlug = await db.queryFirst("SELECT id FROM products WHERE slug=?", spec.slug);
      productId = bySlug ? Number(bySlug.id) : 0;
    }
    if (!productId) {
      const created = await db.execRun(
        `INSERT INTO products (category_id, name, slug, description, price, image_url, stock, is_active, sort_order, source, fulfillment_mode, telegram_enabled)
         VALUES (?,?,?,?,?, ?, ?, ?, ?, 'manual', 'manual', 1)`,
        categoryId, displayName, spec.slug, displayDescription,
        sell, TUNVN_CHATGPT_IMAGE_URL, Number(mirror.stock ?? 0), requested ? 1 : 0, spec.sort_order,
      );
      productId = Number(created.lastInsertRowid ?? 0);
    } else {
      // Harga/stok/nama/deskripsi mengikuti admin; is_active TIDAK disentuh
      // selain mematikan bila admin menarik permintaan terbit.
      await db.execRun(
        `UPDATE products SET price=?, stock=?, image_url=?, name=?, description=?,
           is_active=CASE WHEN ? = 0 THEN 0 ELSE is_active END, updated_at=datetime('now') WHERE id=?`,
        sell, Number(mirror.stock ?? 0), TUNVN_CHATGPT_IMAGE_URL, displayName, displayDescription,
        requested ? 1 : 0, productId,
      );
    }
    if (!productId) continue;
    const productState = await db.queryFirst("SELECT is_active FROM products WHERE id=?", productId);
    const productActive = Number(productState?.is_active ?? 0) === 1;
    await db.execRun(
      `INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
       VALUES (?,?,?,?,?, 'manual', ?, 1)
       ON CONFLICT(sku) DO UPDATE SET price=excluded.price, stock=excluded.stock,
         is_active=CASE WHEN ? = 1 THEN product_variants.is_active ELSE 0 END, updated_at=datetime('now')`,
      productId, sku, spec.label, sell, Number(mirror.stock ?? 0), requested && productActive ? 1 : 0, requested ? 1 : 0,
    );
    if (requested && productActive) {
      await db.execRun("UPDATE product_variants SET is_active=1, updated_at=datetime('now') WHERE sku=?", sku);
      activated++;
    }
    await db.execRun(
      "UPDATE tunvn_products SET axvara_product_id=?, sell_price_idr=?, fx_idr_per_usdt=?, visible=?, updated_at=datetime('now') WHERE supplier_product_id=?",
      productId, sell, idrPerUsdt, requested && productActive ? 1 : 0, spec.supplier_product_id,
    );
    chatgpt++;
  }

  const muse = await db.queryFirst("SELECT id FROM products WHERE slug=?", TUNVN_MUSE_SLUG);
  let buff = 0;
  if (muse) {
    const museId = Number(muse.id);
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
        : tunvnBuffSellPriceIdr(quantityB, idrPerUsdt, { markupPercent: markup });
      const costUsdt = TUNVN_BUFF_COST_USDT_PER_B * quantityB;
      const keepActive = existing ? Number(existing.is_active ?? 0) : 0;
      await db.execRun(
        `INSERT INTO product_variants (product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
         VALUES (?,?,?,?, -1, 'manual', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sku) DO UPDATE SET price=excluded.price, tunvn_cost_usdt=excluded.tunvn_cost_usdt,
           tunvn_markup_percent=excluded.tunvn_markup_percent, tunvn_fx_idr_per_usdt=excluded.tunvn_fx_idr_per_usdt,
           updated_at=datetime('now')`,
        museId, `TUNVN-BUFF-${quantityB}B`, `Buff Token Muse AI ${quantityB}B`, sell, keepActive,
        9 + TUNVN_BUFF_VARIANT_B.indexOf(quantityB) + 1, quantityB, costUsdt, markup, idrPerUsdt,
      );
      buff++;
    }
  }
  return { ok: true, chatgpt, buff_variants: buff, idr_per_usdt: idrPerUsdt, activated };
}
