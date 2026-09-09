// src/lib/fulfillment/delivery/inventory-binding.ts — Ikat unit inventory ke baris item.
//
// MENGAPA dipisah: pemilihan unit inventory per baris (unique) dan
// materialisasi fulfillment_items adalah tanggung jawab yang berbeda dari
// pengiriman. Aturan kecocokan unit↔varian (unit khusus varian vs unit legacy
// NULL) dan idempotensi INSERT per (order, item_index) terkumpul di sini agar
// invarian "satu unit = satu kebutuhan pengiriman" dapat ditinjau terpisah dari
// dekripsi/kirim. NOL perubahan perilaku: SQL, urutan, dan guard identik.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { findReservedForOrder } from "../inventory";
import type { FulfillmentOrderItem, Row } from "./types";
import { COST_PER_JOB_FRAME } from "./types";
import {
  fulfillmentModesFromOrderSnapshot,
  parseOrderItems,
  resolveRecipient,
} from "./manifest";

/** Resolve one item's mode: snapshot → variant row → product fallback. */
export async function resolveItemMode(
  item: FulfillmentOrderItem,
  order: Row,
  productsById: Map<number, Row>, database: DatabaseAccess = createDatabaseAccess()
): Promise<"manual" | "shared" | "unique"> {
  const { queryFirst, isD1Mode } = database;
  const snapshotModes = fulfillmentModesFromOrderSnapshot(order);
  const snapshot = item.variant_id != null ? snapshotModes.get(item.variant_id) : undefined;
  if (snapshot) return snapshot;
  if (typeof item.fulfillment_mode === "string" && ["manual", "shared", "unique"].includes(item.fulfillment_mode)) {
    return item.fulfillment_mode as "manual" | "shared" | "unique";
  }
  if (item.variant_id != null && isD1Mode()) {
    const variant = await queryFirst(
      `SELECT fulfillment_mode FROM product_variants WHERE id=? AND product_id=?`,
      item.variant_id,
      item.product_id,
    );
    const mode = String(variant?.fulfillment_mode || "");
    if (["manual", "shared", "unique"].includes(mode)) return mode as "manual" | "shared" | "unique";
  }
  const product = productsById.get(item.product_id);
  const fallback = String(product?.fulfillment_mode || "manual");
  return (["manual", "shared", "unique"].includes(fallback) ? fallback : "manual") as "manual" | "shared" | "unique";
}

/**
 * Ensure one fulfillment_items row per order item (issue #4).
 * Idempotent via UNIQUE(order_code, item_index); existing rows are kept so
 * retry/progress is never reset. Returns the rows in item order.
 */
export async function ensureFulfillmentItems(
  order: Row, database: DatabaseAccess = createDatabaseAccess(), maxNewItems = Infinity,
): Promise<Row[]> {
  const { queryAll, queryFirst, execRun } = database;
  const orderCode = String(order.code);
  const items = parseOrderItems(order.items);
  const existing = await queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode);
  if (existing.length === items.length) return existing;
  const have = new Set(existing.map((row) => Number(row.item_index)));
  const taken = new Set(existing.map((row) => Number(row.inventory_id || 0)).filter((id) => id > 0));
  const recipient = resolveRecipient(order);
  const productsById = new Map<number, Row>();
  let created = 0;
  for (let index = 0; index < items.length; index++) {
    if (have.has(index)) continue;
    // At most five statements to resolve/bind/insert one line; keep enough
    // room to reread rows and finish the job without calling a provider.
    if (created >= maxNewItems || !database.canSpend(5 + COST_PER_JOB_FRAME + 1)) break;
    const item = items[index];
    if (!Number.isSafeInteger(item.qty) || Number(item.qty) < 1) throw new Error("invalid_fulfillment_quantity");
    if (!productsById.has(item.product_id)) {
      const product = await queryFirst(`SELECT * FROM products WHERE id=?`, item.product_id);
      if (product) productsById.set(item.product_id, product);
    }
    const mode = await resolveItemMode(item, order, productsById, database);
    const inventory = mode === "unique"
      ? await claimInventoryForItem(orderCode, item.product_id, item.variant_id ?? null, taken, database)
      : null;
    if (inventory) taken.add(Number(inventory.id));
    await execRun(
      `INSERT OR IGNORE INTO fulfillment_items
       (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,inventory_id,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
       VALUES(?,?,?,?,?,?,?,?,?,'queued',0,datetime('now'))`,
      orderCode, index, item.product_id, item.variant_id ?? null, item.qty, mode,
      inventory ? Number(inventory.id) : null, recipient.channel, recipient.target || null,
    );
    created++;
  }
  if (!created) return existing;
  return queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode);
}

/**
 * Klaim satu unit inventory untuk satu baris item (review R3).
 * - Eksplisit per (order, product, variant): unit khusus varian diutamakan,
 *   unit legacy tanpa variant_id adalah pool terakhir yang deterministik
 *   (id terkecil) — bukan pilihan acak by order_code.
 * - Unik: id dalam `taken` (sudah terikat ke baris lain order ini) dilewati.
 * - Divalidasi ulang sebelum kirim oleh processItem (inventoryMatchesItem).
 * Mengembalikan baris inventory atau null bila tidak ada unit yang cocok.
 */
export async function claimInventoryForItem(
  orderCode: string,
  productId: number,
  variantId: number | null,
  taken: Set<number>, database: DatabaseAccess = createDatabaseAccess()
): Promise<Row | null> {
  const { queryAll } = database;
  const candidates = variantId == null
    ? await queryAll(
        `SELECT * FROM fulfillment_inventory
         WHERE order_code=? AND product_id=? AND status='reserved'
         ORDER BY id ASC`,
        orderCode, productId,
      ).catch(() => [] as Row[])
    : await queryAll(
        `SELECT * FROM fulfillment_inventory
         WHERE order_code=? AND product_id=? AND status='reserved'
           AND (variant_id=? OR variant_id IS NULL)
         ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id ASC`,
        orderCode, productId, variantId, variantId,
      ).catch(() => [] as Row[]);
  for (const row of candidates) {
    const id = Number(row.id);
    if (taken.has(id)) continue;
    const rowVariant = row.variant_id == null ? null : Number(row.variant_id);
    // Kecocokan: unit khusus varian hanya untuk varian itu; unit legacy
    // (variant_id NULL) boleh dipakai varian mana pun sebagai fallback.
    if (rowVariant !== null && variantId !== null && rowVariant !== variantId) continue;
    if (rowVariant !== null && variantId === null) continue;
    return row;
  }
  return null;
}

/**
 * Validasi kecocokan inventory ↔ item sebelum dekripsi/pengiriman.
 * Menolak unit milik varian lain; unit legacy (variant_id NULL) diterima
 * sebagai fallback deterministik.
 */
export function inventoryMatchesItem(inventory: Row, productId: number, variantId: number | null): boolean {
  if (Number(inventory.product_id) !== Number(productId)) return false;
  if (inventory.variant_id == null) return true;
  if (variantId == null) return false;
  return Number(inventory.variant_id) === Number(variantId);
}

export async function findReservedForOrderVariant(
  orderCode: string,
  productId: number,
  variantId: number | null, database: DatabaseAccess = createDatabaseAccess()
): Promise<Row | null | undefined> {
  const { queryFirst, isD1Mode } = database;
  if (isD1Mode()) {
    return await queryFirst(
      `SELECT * FROM fulfillment_inventory
       WHERE order_code=? AND product_id=? AND status='reserved'
         AND (? IS NULL OR variant_id=? OR variant_id IS NULL)
       ORDER BY CASE WHEN variant_id=? THEN 0 ELSE 1 END, id ASC LIMIT 1`,
      orderCode, productId, variantId, variantId, variantId,
    );
  }
  return findReservedForOrder(orderCode);
}
