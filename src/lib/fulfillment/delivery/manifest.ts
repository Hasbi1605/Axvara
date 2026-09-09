// src/lib/fulfillment/delivery/manifest.ts — Identitas penerima + manifest per item.
//
// MENGAPA dipisah: fungsi-fungsi di sini adalah lapis "pembacaan fakta order"
// yang murni/near-murni — memetakan penerima kanal, mem-parse items[], membaca
// mode dari snapshot, dan menilai kelengkapan/settlement manifest. Lapis ini
// tidak mengirim, tidak mengklaim job, dan tidak menulis ledger; ia dipakai
// bersama oleh claim/send/process/reconcile/handover. Memisahkannya membuat
// kontrak manifest (satu baris fulfillment = satu baris order) mudah ditinjau
// tanpa terdistraksi mesin pengiriman. NOL perubahan perilaku.

import { execRun } from "@/lib/db";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import type {
  FulfillmentOrderItem,
  FulfillmentRecipient,
  FulfillmentLineMismatch,
  Row,
} from "./types";

/**
 * Resolve the delivery recipient for one order (issues #4, #5).
 *
 * - telegram → telegram_user_id pembeli (chat pribadi terverifikasi).
 *   telegram_chat_id TIDAK dipakai sebagai penerima kredensial: dari grup,
 *   chat_id adalah ID grup, sehingga memakainya membocorkan kredensial ke
 *   seluruh anggota grup. Order grup menyimpan chat pribadi setelah buyer
 *   menekan START (ensurePrivateRecipient) atau item diarahkan manual.
 * - whatsapp → nomor anggota grup (channel_member_id) atau customer_wa.
 * - web → nomor WA pembeli (jalur manual/admin; tidak ada push otomatis).
 * Target kosong berarti item tidak dapat dikirim otomatis dan diarahkan ke
 * `manual_required` — bukan dikirim ke penerima kosong/grup.
 */
export function resolveRecipient(order: Row): FulfillmentRecipient {
  const channel = String(order.sales_channel || "telegram");
  if (channel === "whatsapp") {
    return {
      channel: "whatsapp",
      target: String(order.channel_member_id || order.customer_wa || ""),
    };
  }
  if (channel === "web") {
    return { channel: "web", target: String(order.customer_wa || "") };
  }
  // Private-only: telegram_user_id adalah identitas pembeli terverifikasi
  // (from.id saat START/callback di chat pribadi). telegram_chat_id hanya
  // dipakai untuk membalas pesan operasional non-kredensial.
  return { channel: "telegram", target: String(order.telegram_user_id || "") };
}

/**
 * Bind the verified private chat of a Telegram buyer to their user id
 * (issue #5). Called on every private START/callback/message BEFORE any
 * order or delivery work:
 * - telegram_users.chat_id = chat pribadi terakhir yang terverifikasi.
 * - paid orders of this buyer with no usable private recipient inherit it
 *   (CAS: only when the stored target is empty or a negative group id),
 *   so credentials created from a group checkout find the private chat as
 *   soon as the buyer presses START — without ever trusting a group id.
 */
export async function ensurePrivateRecipient(
  telegramUserId: string,
  privateChatId: string,
): Promise<void> {
  if (!telegramUserId || !privateChatId) return;
  if (Number(privateChatId) < 0) return; // never bind a group id
  await execRun(
    `UPDATE telegram_users SET chat_id=?, updated_at=datetime('now')
     WHERE user_id=? AND (chat_id IS NULL OR chat_id!=? OR CAST(chat_id AS INTEGER) < 0)`,
    privateChatId, telegramUserId, privateChatId,
  ).catch(() => {});
  await execRun(
    `UPDATE orders SET telegram_chat_id=?
     WHERE sales_channel='telegram' AND telegram_user_id=?
       AND status='lunas' AND payment_status='paid'
       AND (telegram_chat_id IS NULL OR telegram_chat_id!=? OR CAST(telegram_chat_id AS INTEGER) < 0)
       AND fulfillment_status NOT IN ('delivered')`,
    privateChatId, telegramUserId, privateChatId,
  ).catch(() => {});
  await execRun(
    `UPDATE fulfillment_items SET recipient_target=?
     WHERE recipient_channel='telegram' AND recipient_target!=?
       AND (recipient_target IS NULL OR CAST(recipient_target AS INTEGER) < 0)
       AND order_code IN (
         SELECT code FROM orders
         WHERE sales_channel='telegram' AND telegram_user_id=?
           AND status='lunas' AND payment_status='paid'
       )`,
    privateChatId, privateChatId, telegramUserId,
  ).catch(() => {});
}

/** Parse order.items into a normalized per-item list. */
export function parseOrderItems(raw: unknown): FulfillmentOrderItem[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const productId = Number(row.product_id || 0);
        if (!productId) return null;
        return {
          product_id: productId,
          variant_id: row.variant_id != null ? Number(row.variant_id) : null,
          qty: Number(row.qty ?? 1),
          fulfillment_mode: row.fulfillment_mode,
        } as FulfillmentOrderItem;
      })
      .filter((entry): entry is FulfillmentOrderItem => entry !== null);
  } catch {
    return [];
  }
}

export function fulfillmentModeFromOrderSnapshot(order: Row): string | null {
  return fulfillmentModesFromOrderSnapshot(order).get(-1)
    ?? fulfillmentModesFromOrderSnapshot(order).get(
      Number(order.variant_id || 0) || -1,
    )
    ?? null;
}

/**
 * Read per-item modes from the order snapshot. Supports the legacy
 * single-item shape (`{fulfillment_mode}`), the Telegram cart shape
 * (`{lines:[{variant_id, fulfillment_mode}]}`), and per-item entries
 * embedded in items[] itself (resolved separately).
 */
export function fulfillmentModesFromOrderSnapshot(order: Row): Map<number, "manual" | "shared" | "unique"> {
  const modes = new Map<number, "manual" | "shared" | "unique">();
  if (!order.variant_snapshot) return modes;
  try {
    const snapshot = JSON.parse(String(order.variant_snapshot)) as {
      fulfillment_mode?: unknown;
      variant_id?: unknown;
      lines?: { variant_id?: unknown; fulfillment_mode?: unknown }[];
    };
    const single = String(snapshot.fulfillment_mode || "");
    if (["manual", "shared", "unique"].includes(single)) {
      const key = Number(snapshot.variant_id ?? order.variant_id ?? -1);
      modes.set(Number.isFinite(key) ? key : -1, single as "manual" | "shared" | "unique");
    }
    for (const line of snapshot.lines ?? []) {
      const mode = String(line.fulfillment_mode || "");
      if (!["manual", "shared", "unique"].includes(mode)) continue;
      modes.set(Number(line.variant_id), mode as "manual" | "shared" | "unique");
    }
  } catch {
    /* snapshot rusak → fallback ke variant/product */
  }
  return modes;
}

/**
 * True when every item row reached a successful terminal state.
 * manual_required counts as settled (it waits for a legitimate handover),
 * but NOT as delivered — see allItemsDelivered.
 */
export function allItemsSettled(rows: Row[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => ["delivered", "manual_required"].includes(String(row.status)));
}

/**
 * True only when EVERY item row is delivered AND no item still waits for a
 * manual handover. Invariant (review R2): an order is NOT delivered while
 * any item is manual_required, queued, retry, sending, failed — or a line
 * that should exist has no row at all. A mixed shared/manual order with
 * rows [delivered, manual_required] therefore aggregates to
 * manual_required, never delivered.
 */
export function allItemsDelivered(rows: Row[]): boolean {
  if (!rows.length) return false;
  return rows.every((row) => String(row.status) === "delivered");
}

/**
 * Cocokkan baris fulfillment terhadap manifest order (RR3-02): setiap baris
 * order (product_id + variant_id + qty) HARUS punya baris fulfillment
 * dengan identitas yang sama. Mengembalikan daftar index yang hilang/salah.
 *
 * RR4-04: cocokkan JUMLAH UNIT juga. Kontrak representasi: SATU baris
 * fulfillment mewakili SELURUH qty baris order itu (kolom qty disalin dari
 * order saat materialisasi — bukan dipecah per unit). Bila baris fulfillment
 * qty-nya lebih kecil dari kebutuhan order (data tidak konsisten, mis.
 * qty 2 vs 1), baris itu DILAPORKAN hilang agar agregat tidak delivered
 * sebelum kekurangan unit diselesaikan — bukan ditimpa qty-nya (fakta
 * pengiriman tidak boleh dipalsukan) dan bukan mereset item benar.
 */
export async function findMissingFulfillmentLines(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<number[]> {
  return (await findFulfillmentLineMismatches(orderCode, database)).map((m) => m.index);
}

export async function findFulfillmentLineMismatches(orderCode: string, database: DatabaseAccess = createDatabaseAccess()): Promise<FulfillmentLineMismatch[]> {
  const { queryAll, queryFirst } = database;
  const order = await queryFirst(`SELECT items FROM orders WHERE code=?`, orderCode);
  if (!order) return [];
  const rows = await queryAll(
    `SELECT item_index, product_id, variant_id, qty FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode,
  );
  return fulfillmentLineMismatches(order.items, rows);
}

export function fulfillmentLineMismatches(rawItems: unknown, rows: Row[]): FulfillmentLineMismatch[] {
  const expected = parseOrderItems(rawItems);
  const byIndex = new Map(rows.map((r) => [Number(r.item_index), r]));
  const missing: FulfillmentLineMismatch[] = [];
  expected.forEach((line, index) => {
    const row = byIndex.get(index);
    if (!row) { missing.push({ index, kind: "missing", expectedQty: Math.max(1, Number(line.qty || 1)), actualQty: 0 }); return; }
    if (Number(row.product_id) !== Number(line.product_id)
      || Number(row.variant_id ?? 0) !== Number(line.variant_id ?? 0)) {
      missing.push({ index, kind: "identity", expectedQty: Math.max(1, Number(line.qty || 1)), actualQty: Number(row.qty ?? 0) });
      return;
    }
    const need = Number(line.qty);
    const have = Number(row.qty);
    // Nilai legacy tidak valid (qty 0/negatif/NaN → have 0) juga short.
    if (!Number.isSafeInteger(need) || need < 1 || !Number.isSafeInteger(have) || have !== need) {
      missing.push({ index, kind: "quantity", expectedQty: need, actualQty: have });
    }
  });
  for (const row of rows) {
    const index = Number(row.item_index);
    if (!Number.isInteger(index) || index < 0 || index >= expected.length) {
      missing.push({ index, kind: "unexpected", expectedQty: 0, actualQty: Number(row.qty) });
    }
  }
  return missing;
}
