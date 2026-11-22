// src/lib/warung-rebahan/sync/variant.ts — WR variant writes and parent
// aggregates (3D-4, class E: pure move from sync.ts; MAP-1 (a) section 6 step 4).
//
// Verbatim bodies: planExistingVariantWrites, upsertWrVariant,
// insertNewVariant, planParentAggregateWrite, refreshParentAggregates.
// SQL, bind order, null-safe write-quota guards, archived-parent
// predicates, insert order/lastInsertRowid, runWrites mode, outcomes and
// catches are unchanged. Only upsertWrVariant + refreshParentAggregates
// are re-exported from the sync barrel (their prior public surface).

import type { DatabaseAccess } from "@/lib/db-access";
import { deliveryClassFromApiMode, WR_DEFAULT_DELIVERY_CLASS } from "../delivery-class";
import type { WrVariant } from "../client";
import {
  calculateSellPrice,
  defaultMarkupFixed,
  defaultMarkupPercent,
  parseWrDuration,
  parseWrWarranty,
} from "./pricing";
import type { Row, SqlWrite, VariantOutcome } from "./types";
import { runWrites } from "./writes";

/**
 * Rencanakan tulis untuk satu varian yang SUDAH ada barisnya, tanpa menyentuh
 * D1. Baris `existing` disuplai pemanggil (satu SELECT massal per produk),
 * jadi jalur ini nol round-trip sampai `runWrites` mengirimnya sebagai batch.
 */
export function planExistingVariantWrites(
  wrVariant: WrVariant,
  existing: Row,
  now: string,
): { writes: SqlWrite[]; outcome: VariantOutcome } {
  const writes: SqlWrite[] = [];
  const markupPercent = Number(existing.markup_percent ?? defaultMarkupPercent());
    const markupFixed = Number(existing.markup_fixed ?? 0);
    const sellPrice = calculateSellPrice(Number(wrVariant.price), markupPercent, markupFixed);
    const stockChanged = Number(existing.wr_stock ?? -1) !== Number(wrVariant.stock);
    const priceChanged =
      Number(existing.wr_price ?? -1) !== Number(wrVariant.price) ||
      Number(existing.axvara_sell_price ?? -1) !== sellPrice;
    // Kuota D1: sweep menulis 96 baris wr_variants + 96 product_variants tiap
    // 5 menit walau WR tidak berubah sama sekali (~28k rows-written/hari dari
    // kuota 100k). `last_synced_at` TIDAK dibaca siapa pun, jadi menyegarkannya
    // sendirian tidak bernilai — guard null-safe (`IS NOT`) membuat baris yang
    // benar-benar sama tidak ditulis ulang.
    writes.push({
      sql: `UPDATE wr_variants SET wr_variant_name=?, wr_price=?, wr_duration=?,
        wr_type=?, wr_warranty=?, wr_stock=?, wr_terms=?, wr_delivery_terms=?,
        axvara_sell_price=?, last_synced_at=?, updated_at=?
       WHERE wr_variant_id=?
         AND (wr_variant_name IS NOT ? OR wr_price IS NOT ? OR wr_duration IS NOT ?
              OR wr_type IS NOT ? OR wr_warranty IS NOT ? OR wr_stock IS NOT ?
              OR wr_terms IS NOT ? OR wr_delivery_terms IS NOT ?
              OR axvara_sell_price IS NOT ?)`,
      params: [
        wrVariant.name,
        Number(wrVariant.price),
        wrVariant.duration || null,
        wrVariant.type || null,
        wrVariant.warranty || null,
        Number(wrVariant.stock),
        wrVariant.terms ?? null,
        wrVariant.delivery_terms ?? null,
        sellPrice,
        now,
        now,
        wrVariant.id,
        wrVariant.name,
        Number(wrVariant.price),
        wrVariant.duration || null,
        wrVariant.type || null,
        wrVariant.warranty || null,
        Number(wrVariant.stock),
        wrVariant.terms ?? null,
        wrVariant.delivery_terms ?? null,
        sellPrice,
      ],
    });
    // 2026-10-13: `delivery_mode` resmi API WR = SATU-SATUNYA penentu kelas
    // (paten ala SK, tanpa tebakan): "auto" → restock (AUTO), selainnya →
    // made_by_order (MANUAL; "mixed" dilipat karena bisa manual). Bila mode
    // ada, mode mentah + kelas biner ditulis bersama (sumber ditandai 'api').
    // Guard IS NOT: baris yang sudah sama tidak ditulis ulang.
    // `preMigrationFallback`: pra-0060 (kolom BELUM ada di D1 prod) statement
    // ini turun ke kelas saja tanpa kolom baru — sync tetap jalan walau
    // migrasi belum diterapkan.
    const apiClass = deliveryClassFromApiMode(wrVariant.delivery_mode);
    if (apiClass) {
      const apiMode = String(wrVariant.delivery_mode).trim().toLowerCase();
      writes.push({
        sql: `UPDATE wr_variants SET wr_delivery_mode=?, wr_delivery_class=?, wr_delivery_source='api',
          updated_at=? WHERE wr_variant_id=?
            AND (wr_delivery_mode IS NOT ? OR wr_delivery_class IS NOT ? OR wr_delivery_source IS NOT 'api')`,
        params: [apiMode, apiClass, now, wrVariant.id, apiMode, apiClass],
        preMigrationFallback: {
          sql: `UPDATE wr_variants SET wr_delivery_class=?, wr_delivery_source='api',
            updated_at=? WHERE wr_variant_id=? AND wr_delivery_class IS NOT ?`,
          params: [apiClass, now, wrVariant.id, apiClass],
        },
      });
    } else {
      // Tanpa delivery_mode dari API: kelas diisi default aman deterministik
      // (BUKAN tebakan konten) hanya bila masih NULL — begitu mode resmi
      // datang, cabang di atas menimpanya.
      writes.push({
        sql: `UPDATE wr_variants SET wr_delivery_class=?, wr_delivery_source='api',
          updated_at=? WHERE wr_variant_id=? AND wr_delivery_class IS NULL`,
        params: [WR_DEFAULT_DELIVERY_CLASS, now, wrVariant.id],
        optional: true,
      });
    }
    const axvaraVariantId =
      existing.axvara_variant_id != null ? Number(existing.axvara_variant_id) : 0;
    if (axvaraVariantId > 0) {
      const duration = parseWrDuration(wrVariant.duration);
      const warranty = parseWrWarranty(wrVariant.warranty);
      const previousSupplierName =
        existing.wr_variant_name != null ? String(existing.wr_variant_name) : null;
      // compare_price milik admin (ownership.ts): jangan tulis — tapi harga
      // jual baru yang menyamai/melampaui coret lama DITOLAK CHECK
      // (compare_price > price) sehingga rollback SELURUH batch produk
      // (insiden Alight/Viu 2026-10-06, terbukti di jalur SK). NULL-kan coret
      // basi agar harga jual otoritatif selalu tembus.
      //
      // label varian milik admin bila sudah dikustomisasi: hanya timpa
      // saat masih NULL/kosong atau masih sama dengan nama supplier lama
      // (sebelum wr_variants.wr_variant_name di-update batch ini).
      writes.push({
        sql: `UPDATE product_variants SET
          label=CASE WHEN label IS NULL OR label='' OR label IS ? THEN ? ELSE label END,
          price=?, stock=?,
          compare_price=CASE WHEN compare_price IS NOT NULL AND compare_price <= ? THEN NULL ELSE compare_price END,
          duration_value=?, duration_unit=?, duration_label=?,
          warranty_type=?, warranty_value=?, warranty_unit=?, warranty_label=?,
          updated_at=datetime('now')
         WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?
           AND (((label IS NULL OR label='' OR label IS ?) AND label IS NOT ?)
                OR price IS NOT ? OR stock IS NOT ?
                OR (compare_price IS NOT NULL AND compare_price <= ?)
                OR duration_value IS NOT ? OR duration_unit IS NOT ?
                OR duration_label IS NOT ? OR warranty_type IS NOT ?
                OR warranty_value IS NOT ? OR warranty_unit IS NOT ?
                OR warranty_label IS NOT ?)`,
        params: [
          previousSupplierName,
          wrVariant.name,
          sellPrice,
          Number(wrVariant.stock),
          sellPrice,
          duration.value,
          duration.unit,
          duration.label || null,
          warranty.type,
          warranty.value,
          warranty.unit,
          warranty.label || null,
          axvaraVariantId,
          previousSupplierName,
          wrVariant.name,
          sellPrice,
          Number(wrVariant.stock),
          sellPrice,
          duration.value,
          duration.unit,
          duration.label || null,
          warranty.type,
          warranty.value,
          warranty.unit,
          warranty.label || null,
        ],
        optional: true,
        catalogDisplay: true,
      });
    }
  return { writes, outcome: { stockChanged, priceChanged, isNew: false } };
}

export async function upsertWrVariant(
  wrVariant: WrVariant,
  wrProductId: string,
  axvaraProductId: number,
  db: DatabaseAccess,
): Promise<VariantOutcome> {
  const { queryFirst } = db;
  const now = new Date().toISOString();
  const existing = await queryFirst(
    `SELECT id, wr_variant_name, wr_price, wr_stock, markup_percent, markup_fixed,
            axvara_variant_id, axvara_sell_price
     FROM wr_variants WHERE wr_variant_id=?`,
    wrVariant.id,
  );
  if (existing) {
    const planned = planExistingVariantWrites(wrVariant, existing, now);
    await runWrites(planned.writes, db);
    return planned.outcome;
  }
  return insertNewVariant(wrVariant, wrProductId, axvaraProductId, db, now);
}

/**
 * Varian BARU. Tetap berurutan (tidak di-batch): butuh `lastInsertRowid` dari
 * insert `product_variants` untuk menautkan `wr_variants.axvara_variant_id`,
 * dan `batch()` tidak bisa memakai hasil statement sebelumnya. Varian baru
 * juga jarang — 0 dari 87 pada sweep normal — jadi tidak memengaruhi biaya.
 */
export async function insertNewVariant(
  wrVariant: WrVariant,
  wrProductId: string,
  axvaraProductId: number,
  db: DatabaseAccess,
  now: string,
): Promise<VariantOutcome> {
  const { queryFirst, execRun } = db;
  if (!axvaraProductId) return { stockChanged: false, priceChanged: false, isNew: false };
  const markupPercent = defaultMarkupPercent();
  const markupFixed = defaultMarkupFixed();
  const sellPrice = calculateSellPrice(Number(wrVariant.price), markupPercent, markupFixed);
  const duration = parseWrDuration(wrVariant.duration);
  const warranty = parseWrWarranty(wrVariant.warranty);
  // SKU dari UUID WR tanpa strip (36 char alnum) + suffix 6 char dari UUID agar
  // unik per varian. Temuan 2026-09-11: strip+slice(0,24) membuat "Member Pro"
  // Canva (2 varian) dan "Pro Member"/"Head" Gemini (3 varian) tabrakan SKU
  // karena 24 char pertama UUID-nya sama — varian ke-2 dst gagal dengan
  // D1_ERROR binding/UNIQUE lalu seluruh produk dicatat error (stok 0).
  const uuidAlnum = String(wrVariant.id).replace(/[^A-Za-z0-9]/g, "").toUpperCase() || "X";
  const sku = `WR-${uuidAlnum.slice(0, 24)}${uuidAlnum.slice(-6)}`;
  const created = await execRun(
    `INSERT INTO product_variants (product_id, sku, label, duration_value, duration_unit, duration_label,
       warranty_type, warranty_value, warranty_unit, warranty_label,
       price, stock, fulfillment_mode, is_active, sort_order,
       wr_variant_id, wr_auto_managed, created_at, updated_at) WITH archive_candidate(product_id, sku, label, duration_value, duration_unit, duration_label,
       warranty_type, warranty_value, warranty_unit, warranty_label,
       price, stock, fulfillment_mode, is_active, sort_order,
       wr_variant_id, wr_auto_managed, created_at, updated_at) AS (VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?)) SELECT * FROM archive_candidate WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=archive_candidate.product_id AND archive_parent.archived_at IS NULL)`,
    axvaraProductId,
    sku,
    wrVariant.name,
    duration.value,
    duration.unit,
    duration.label || null,
    warranty.type,
    warranty.value,
    warranty.unit,
    warranty.label || null,
    sellPrice,
    Number(wrVariant.stock),
    "manual",
    1,
    0,
    wrVariant.id,
    1,
    now,
    now,
  ).catch(() => ({ changes: 0 as number | undefined, lastInsertRowid: undefined as number | undefined }));
  let axvaraVariantId = Number(created.changes === 0 ? 0 : created.lastInsertRowid ?? 0);
  if (!axvaraVariantId) {
    // SKU collision (retry sync / UUID pendek sama): pakai baris yang ada.
    const conflict = await queryFirst(
      `SELECT id FROM product_variants WHERE sku=?`,
      sku,
    );
    axvaraVariantId = conflict ? Number(conflict.id) : 0;
  }
  // 2026-10-13: varian baru langsung berkelas dari delivery_mode API
  // (sumber 'api'); tanpa mode → default aman deterministik. Tidak ada
  // lagi tebakan nama/stok/terms (mesin lama dihapus).
  const variantClass = deliveryClassFromApiMode(wrVariant.delivery_mode) ?? WR_DEFAULT_DELIVERY_CLASS;
  const apiModeValue = wrVariant.delivery_mode ? String(wrVariant.delivery_mode).trim().toLowerCase() : null;
  try {
    await execRun(
      `INSERT OR IGNORE INTO wr_variants
        (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
         wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
         axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
         is_active, last_synced_at, wr_delivery_class, wr_delivery_source, wr_delivery_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
      wrVariant.id,
      wrProductId,
      wrVariant.name,
      Number(wrVariant.price),
      wrVariant.duration || null,
      wrVariant.type || null,
      wrVariant.warranty || null,
      Number(wrVariant.stock),
      wrVariant.terms ?? null,
      wrVariant.delivery_terms ?? null,
      axvaraVariantId || null,
      markupPercent,
      markupFixed,
      sellPrice,
      now,
      variantClass,
      "api",
      apiModeValue,
    );
  } catch {
    // Pra-migrasi 0060 (kolom wr_delivery_mode BELUM ada): INSERT yang sama
    // tanpa kolom baru. Kelas dari API tetap tertulis (bukan tebakan lama).
    await execRun(
      `INSERT OR IGNORE INTO wr_variants
        (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_duration,
         wr_type, wr_warranty, wr_stock, wr_terms, wr_delivery_terms,
         axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price,
         is_active, last_synced_at, wr_delivery_class, wr_delivery_source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      wrVariant.id,
      wrProductId,
      wrVariant.name,
      Number(wrVariant.price),
      wrVariant.duration || null,
      wrVariant.type || null,
      wrVariant.warranty || null,
      Number(wrVariant.stock),
      wrVariant.terms ?? null,
      wrVariant.delivery_terms ?? null,
      axvaraVariantId || null,
      markupPercent,
      markupFixed,
      sellPrice,
      now,
      variantClass,
      "api",
    );
  }
  if (axvaraVariantId > 0) {
    await execRun(
      `UPDATE product_variants SET wr_variant_id=?, wr_auto_managed=1,
        updated_at=datetime('now') WHERE EXISTS(SELECT 1 FROM products archive_parent WHERE archive_parent.id=product_variants.product_id AND archive_parent.archived_at IS NULL) AND id=?`,
      wrVariant.id,
      axvaraVariantId,
    ).catch(() => ({ changes: 0 }));
  }
  return { stockChanged: true, priceChanged: true, isNew: true };
}

/**
 * Statement agregat induk. SATU sumber SQL untuk jalur berurutan maupun batch.
 *
 * Guard kuota D1 (2026-09-20): agregat induk dihitung ulang tiap sweep dan
 * dulu SELALU ditulis walau hasilnya identik — 48 baris per sweep tanpa
 * perubahan apa pun. Subquery yang sama dipakai di WHERE sebagai pembanding
 * sehingga UPDATE hanya terjadi saat harga/stok agregat benar-benar bergeser.
 */
export function planParentAggregateWrite(axvaraProductId: number): SqlWrite {
  return {
    sql: `UPDATE products
     SET price=COALESCE((
           SELECT MIN(price) FROM product_variants
           WHERE product_id=? AND is_active=1
         ),price),
         stock=CASE WHEN EXISTS(
           SELECT 1 FROM product_variants
           WHERE product_id=? AND is_active=1 AND stock=-1
         ) THEN -1 ELSE COALESCE((
           SELECT SUM(CASE WHEN stock>0 THEN stock ELSE 0 END)
           FROM product_variants WHERE product_id=? AND is_active=1
         ),0) END,
         updated_at=datetime('now')
     WHERE products.archived_at IS NULL AND id=?
       AND (price IS NOT COALESCE((
              SELECT MIN(price) FROM product_variants
              WHERE product_id=? AND is_active=1
            ),price)
         OR stock IS NOT CASE WHEN EXISTS(
              SELECT 1 FROM product_variants
              WHERE product_id=? AND is_active=1 AND stock=-1
            ) THEN -1 ELSE COALESCE((
              SELECT SUM(CASE WHEN stock>0 THEN stock ELSE 0 END)
              FROM product_variants WHERE product_id=? AND is_active=1
            ),0) END)`,
    params: new Array(7).fill(axvaraProductId),
    optional: true,
  };
}

/** Sinkronkan stok induk dari agregat varian aktif (SUM, unlimited bila ada -1). */
export async function refreshParentAggregates(
  axvaraProductId: number,
  db: DatabaseAccess,
): Promise<void> {
  if (!axvaraProductId) return;
  const write = planParentAggregateWrite(axvaraProductId);
  await db.execRun(write.sql, ...write.params).catch(() => ({ changes: 0 }));
}
