// src/lib/orders/credential-terms.ts — S&K + cara aktivasi pasca-bayar untuk
// panel kredensial (WR/SK), satu resolver dengan halaman produk.
//
// Sebelum 2026-10-13 S&K varian hanya tampil SEBELUM bayar (PDP). Setelah
// bayar, panel hanya berisi kredensial — pembeli kehilangan aturan yang
// justru menentukan garansi (larangan ganti password, batas device, dst).
// SK tampak "lengkap" hanya karena seller_note ikut terlipat ke teks
// kredensial oleh formatSkLicenses.
//
// Kontrak di sini:
// - Mengembalikan salinan yang SUDAH diresolusi PDP (`VariantCopy`): admin →
//   kurasi → teks supplier dirapikan, dengan pagar sidik jari yang sama.
// - Dipetakan per item_index order agar cocok dengan kredensial yang tampil.
// - Kredensial sendiri TIDAK berubah (tetap bersih untuk disalin); S&K
//   dirender sebagai blok terpisah di bawahnya oleh WrCredentialsPanel.
// - Gagal baca katalog = null per item (panel tetap jalan), bukan error.

import type { DatabaseAccess } from "@/lib/db-access";
import type { VariantCopy } from "@/lib/product-copy/format";
import { resolveVariantCopy } from "@/lib/product-copy/resolve";
import { mergeProductCopy, parseProductDescription } from "@/lib/product-copy/format";
import { displayDescription } from "@/lib/catalog";

type OrderLine = { variant_id?: unknown };

function orderVariantIds(itemsRaw: unknown): (number | null)[] {
  try {
    const parsed = JSON.parse(String(itemsRaw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((line) => {
      const vid = Number((line as OrderLine)?.variant_id ?? 0);
      return Number.isFinite(vid) && vid > 0 ? vid : null;
    });
  } catch {
    return [];
  }
}

export type CredentialTermsByIndex = Map<number, VariantCopy>;

/**
 * S&K ter-resolusi per item_index untuk order ini. Query tunggal (JOIN
 * varian ↔ wr_variants/sk_products + kolom admin), lalu resolver PDP yang
 * sama persis diterapkan per baris.
 */
export async function resolveCredentialTermsByItem(
  orderCode: string,
  db: DatabaseAccess,
): Promise<CredentialTermsByIndex> {
  const out: CredentialTermsByIndex = new Map();
  const order = await db
    .queryFirst(`SELECT items,variant_id FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order) return out;
  const variantIds = orderVariantIds(order.items);
  const byIndex = new Map<number,number>();
  variantIds.forEach((vid,index)=>{if(vid!==null)byIndex.set(index,vid);});
  if (!variantIds.length || variantIds.some(vid=>vid===null)) {
    const legacy = await db.queryAll(`SELECT item_index,variant_id FROM fulfillment_items WHERE order_code=?`,orderCode).catch(()=>[]);
    for(const row of legacy){const index=Number(row.item_index),vid=Number(row.variant_id);if(Number.isSafeInteger(index)&&index>=0&&Number.isSafeInteger(vid)&&vid>0&&!byIndex.has(index))byIndex.set(index,vid);}
    if(!byIndex.has(0)&&Number(order.variant_id)>0)byIndex.set(0,Number(order.variant_id));
  }
  const uniqueIds = [...new Set(byIndex.values())];
  if (!uniqueIds.length) return out;
  const rows = await db
    .queryAll(
      `SELECT pv.id AS variant_id,
              pv.admin_terms, pv.admin_activation, pv.admin_copy_fingerprint,
              p.description, p.admin_description_override,
              wv.wr_terms AS wr_terms, wv.wr_delivery_terms AS wr_delivery_terms,
              sp.sk_description AS sk_description, sp.sk_seller_note AS sk_seller_note
       FROM product_variants pv
       JOIN products p ON p.id=pv.product_id
       LEFT JOIN wr_variants wv ON wv.wr_variant_id = pv.wr_variant_id
       LEFT JOIN sk_products sp ON sp.sk_variant_id = pv.sk_variant_id
       WHERE pv.id IN (${uniqueIds.map(() => "?").join(",")})`,
      ...uniqueIds,
    )
    .catch(() => [] as Record<string, unknown>[]);
  const copyByVariant = new Map<number, VariantCopy | null>();
  for (const row of rows) {
    const vid = Number(row.variant_id);
    const terms = (row.wr_terms as string | null) ?? (row.sk_description as string | null);
    const deliveryTerms = (row.wr_delivery_terms as string | null) ?? (row.sk_seller_note as string | null);
    const variantCopy = resolveVariantCopy(terms, deliveryTerms, {
        terms: row.admin_terms as string | null,
        activation: row.admin_activation as string | null,
        fingerprint: row.admin_copy_fingerprint as string | null,
      });
    const merged = mergeProductCopy(variantCopy, parseProductDescription(displayDescription(row)));
    copyByVariant.set(vid, merged.sections.length || merged.activation.length || merged.notes.length
      ? { source: variantCopy?.source ?? "admin", sections: merged.sections, activation: merged.activation, notes: merged.notes } : null);
  }
  byIndex.forEach((vid, index) => {
    const copy = copyByVariant.get(vid);
    if (copy) out.set(index, copy);
  });
  return out;
}
