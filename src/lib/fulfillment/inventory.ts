// src/lib/fulfillment/inventory.ts — Reserve/release/consume inventory atomically
// Works with D1 in production, in-memory for dev.

import { queryAll, queryFirst, execRun, isD1Mode } from "@/lib/db";
import { encryptSecret, computeFingerprint } from "./crypto";

type Row = Record<string, unknown>;

// In-memory store for dev
function getInventoryMem(): Row[] {
  const g = process as unknown as { __AXVARA_FULFILLMENT_INVENTORY?: Row[] };
  if (!g.__AXVARA_FULFILLMENT_INVENTORY) g.__AXVARA_FULFILLMENT_INVENTORY = [];
  return g.__AXVARA_FULFILLMENT_INVENTORY;
}

export interface ImportResult {
  inserted: number;
  duplicate: number;
  invalid: number;
}

/**
 * Import secrets into inventory for a product. Max 100 per call.
 * Each secret is encrypted and fingerprinted. Duplicates are skipped.
 */
export async function importInventory(
  productId: number,
  secrets: string[],
): Promise<ImportResult> {
  const result: ImportResult = { inserted: 0, duplicate: 0, invalid: 0 };
  const batch = secrets.slice(0, 100); // hard cap

  for (const raw of batch) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 2000) {
      result.invalid++;
      continue;
    }

    const fingerprint = await computeFingerprint(trimmed);
    const { ciphertext, iv } = await encryptSecret(trimmed);

    try {
      if (isD1Mode()) {
        await execRun(
          `INSERT INTO fulfillment_inventory (product_id, secret_ciphertext, secret_iv, secret_fingerprint, status)
           VALUES (?, ?, ?, ?, 'available')`,
          productId, ciphertext, iv, fingerprint,
        );
      } else {
        const mem = getInventoryMem();
        if (mem.some((r) => r.product_id === productId && r.secret_fingerprint === fingerprint)) {
          result.duplicate++;
          continue;
        }
        const id = Math.max(0, ...mem.map((r) => Number(r.id) || 0)) + 1;
        mem.push({
          id, product_id: productId, secret_ciphertext: ciphertext, secret_iv: iv,
          secret_fingerprint: fingerprint, status: "available", order_code: null,
          reserved_at: null, delivered_at: null, created_at: new Date().toISOString(),
        });
      }
      result.inserted++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("UNIQUE")) {
        result.duplicate++;
      } else {
        result.invalid++;
      }
    }
  }

  return result;
}

/**
 * Count inventory by status for a product.
 */
export async function countInventory(productId: number): Promise<Record<string, number>> {
  if (isD1Mode()) {
    const rows = await queryAll(
      `SELECT status, COUNT(*) as count FROM fulfillment_inventory WHERE product_id=? GROUP BY status`,
      productId,
    );
    const counts: Record<string, number> = { available: 0, reserved: 0, delivered: 0, revoked: 0 };
    for (const row of rows) counts[String(row.status)] = Number(row.count);
    return counts;
  }

  const mem = getInventoryMem().filter((r) => Number(r.product_id) === productId);
  const counts: Record<string, number> = { available: 0, reserved: 0, delivered: 0, revoked: 0 };
  for (const row of mem) counts[String(row.status)] = (counts[String(row.status)] || 0) + 1;
  return counts;
}

/**
 * Reserve one available inventory item for an order. Returns inventory ID or null.
 * Atomic in D1 via conditional UPDATE.
 */
export async function reserveInventory(productId: number, orderCode: string): Promise<number | null> {
  if (isD1Mode()) {
    // Find first available, then atomically reserve it
    const item = await queryFirst(
      `SELECT id FROM fulfillment_inventory WHERE product_id=? AND status='available' ORDER BY id ASC LIMIT 1`,
      productId,
    );
    if (!item) return null;
    const id = Number(item.id);
    const result = await execRun(
      `UPDATE fulfillment_inventory SET status='reserved', order_code=?, reserved_at=datetime('now')
       WHERE id=? AND status='available'`,
      orderCode, id,
    );
    return result.changes ? id : null;
  }

  const mem = getInventoryMem();
  const item = mem.find(
    (r) => Number(r.product_id) === productId && r.status === "available",
  );
  if (!item) return null;
  item.status = "reserved";
  item.order_code = orderCode;
  item.reserved_at = new Date().toISOString();
  return Number(item.id);
}

/**
 * Release a reserved inventory item back to available (e.g. on cancel/expire).
 * Idempotent: only transitions reserved → available.
 */
export async function releaseInventory(inventoryId: number): Promise<boolean> {
  if (isD1Mode()) {
    const result = await execRun(
      `UPDATE fulfillment_inventory SET status='available', order_code=NULL, reserved_at=NULL
       WHERE id=? AND status='reserved'`,
      inventoryId,
    );
    return !!result.changes;
  }

  const item = getInventoryMem().find((r) => Number(r.id) === inventoryId);
  if (!item || item.status !== "reserved") return false;
  item.status = "available";
  item.order_code = null;
  item.reserved_at = null;
  return true;
}

/**
 * Mark inventory as delivered after successful send.
 */
export async function markDelivered(inventoryId: number): Promise<boolean> {
  if (isD1Mode()) {
    const result = await execRun(
      `UPDATE fulfillment_inventory SET status='delivered', delivered_at=datetime('now')
       WHERE id=? AND status='reserved'`,
      inventoryId,
    );
    return !!result.changes;
  }

  const item = getInventoryMem().find((r) => Number(r.id) === inventoryId);
  if (!item || item.status !== "reserved") return false;
  item.status = "delivered";
  item.delivered_at = new Date().toISOString();
  return true;
}

/**
 * Revoke an available inventory item (admin action).
 */
export async function revokeInventory(inventoryId: number): Promise<boolean> {
  if (isD1Mode()) {
    const result = await execRun(
      `UPDATE fulfillment_inventory SET status='revoked' WHERE id=? AND status='available'`,
      inventoryId,
    );
    return !!result.changes;
  }

  const item = getInventoryMem().find((r) => Number(r.id) === inventoryId);
  if (!item || item.status !== "available") return false;
  item.status = "revoked";
  return true;
}

/**
 * Find the reserved inventory item for an order.
 */
export async function findReservedForOrder(orderCode: string): Promise<Row | undefined> {
  if (isD1Mode()) {
    return await queryFirst(
      `SELECT * FROM fulfillment_inventory WHERE order_code=? AND status='reserved'`,
      orderCode,
    );
  }
  return getInventoryMem().find(
    (r) => r.order_code === orderCode && r.status === "reserved",
  );
}

/**
 * Release all reserved inventory for an order (for cancel/expire).
 */
export async function releaseInventoryForOrder(orderCode: string): Promise<number> {
  if (isD1Mode()) {
    const result = await execRun(
      `UPDATE fulfillment_inventory SET status='available', order_code=NULL, reserved_at=NULL
       WHERE order_code=? AND status='reserved'`,
      orderCode,
    );
    return result.changes ?? 0;
  }

  let count = 0;
  for (const item of getInventoryMem()) {
    if (item.order_code === orderCode && item.status === "reserved") {
      item.status = "available";
      item.order_code = null;
      item.reserved_at = null;
      count++;
    }
  }
  return count;
}
