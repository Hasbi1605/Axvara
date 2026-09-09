// src/lib/fulfillment/delivery/send.ts — Pengiriman kredensial satu baris item ke kanal.
//
// MENGAPA dipisah: inilah satu-satunya tempat plaintext kredensial didekripsi
// dan dikirim ke Telegram/WhatsApp. Mengisolasinya membuat jejak "di mana
// secret muncul di memori" sempit dan mudah diaudit. processItem dipecah PER
// FASE yang sudah tersirat di kode monolit: (1) klaim lease baris, (2) rute
// manual/web, (3) mode shared, (4) mode unique dengan penyembuhan ikatan
// inventory. Tiap fase menjadi fungsi <100 baris tanpa mengubah urutan
// statement, SQL, pesan error, atau disiplin fencing lease. NOL perubahan
// perilaku.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "../crypto";
import { markDelivered } from "../inventory";
import { sendMessage } from "@/lib/telegram/api";
import { sendTextMessage } from "@/lib/whatsapp/gateway";
import { isEnabled } from "@/lib/feature-flags";
import { deliveryMessage } from "@/lib/telegram/messages";
import type { Row } from "./types";
import { MAX_ATTEMPTS, RETRY_DELAYS } from "./types";
import { findReservedForOrderVariant, inventoryMatchesItem } from "./inventory-binding";

/**
 * Klaim lease baris item (FASE 1). Immediate pass (no due-gate): retry rows
 * become deliverable the moment their cause is fixed (secret configured,
 * recipient restored). next_attempt_at only paces the cron, never blocks a
 * live payment path.
 *
 * Lease fencing (review R4): the claim only wins when the row is queued/retry
 * with no active lease. An ACTIVE `sending` lease is never stolen. The caller
 * fences every state-changing write with the exact locked_until value this
 * worker holds; if a newer worker re-claimed the row after our claim expired,
 * those writes affect zero rows and the result is dropped.
 *
 * Mengembalikan baris yang benar-benar kita menangkan + nilai fence, atau
 * status "tidak diklaim" yang membedakan "sudah dipegang worker lain" (bukan
 * kegagalan kita) dari kegagalan sebenarnya.
 */
async function claimItemLease(
  itemRow: Row, database: DatabaseAccess, parent?: { jobId: number; lease: string },
): Promise<{ item: Row; leaseFence: string } | { skip: boolean }> {
  const { queryFirst, execRun } = database;
  const itemId = Number(itemRow.id);
  const lockUntil = new Date(Date.now() + 60_000).toISOString();
  const lockRequested = lockUntil;
  const claim = await execRun(
    `UPDATE fulfillment_items SET status='sending', locked_until=?, attempt_count=attempt_count+1, updated_at=datetime('now')
      WHERE id=? AND status IN ('queued','retry')
        AND (locked_until IS NULL OR datetime(locked_until) < datetime('now'))
        ${parent ? "AND EXISTS (SELECT 1 FROM fulfillment_jobs WHERE id=? AND locked_until=? AND status='sending')" : ""}`,
    lockUntil, itemId, ...(parent ? [parent.jobId, parent.lease] : []),
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (!claim.changes) {
    if (String(itemRow.status) === "sending") return { skip: true };
    // A retry row claimed/locked by another worker is not our failure.
    if (String(itemRow.status) === "retry") return { skip: true };
    return { skip: false };
  }
  // Read only the claim we actually won; never adopt a newer worker's lease.
  const claimed = await queryFirst(`SELECT * FROM fulfillment_items WHERE id=? AND locked_until=? AND status='sending'`, itemId, lockRequested);
  if (!claimed) return { skip: false };
  return { item: claimed, leaseFence: lockRequested };
}

/**
 * Rute manual/web (FASE 2). Web items have no push channel (review R3): route
 * them straight to the admin handover queue instead of burning the retry
 * budget on a delivery that can never succeed. manual_required IS the final,
 * actionable state for web — the admin hands the credential over and records
 * it in admin_note.
 */
async function settleManualOrWeb(
  itemId: number, leaseFence: string, recipientChannel: string, mode: string, database: DatabaseAccess,
): Promise<boolean | null> {
  const { execRun } = database;
  if (recipientChannel === "web") {
    await execRun(
      `UPDATE fulfillment_items SET status='manual_required', last_error='web_channel_requires_manual_handover:serahkan manual via admin_note', locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
      itemId, leaseFence,
    );
    return true;
  }
  if (mode === "manual") {
    await execRun(
      `UPDATE fulfillment_items SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
      itemId, leaseFence,
    );
    return true;
  }
  return null; // bukan manual/web → lanjut ke shared/unique
}

/**
 * Mode shared (FASE 3): satu shared secret varian untuk seluruh pembeli.
 */
async function deliverShared(
  itemId: number, leaseFence: string, recipientChannel: string, recipientTarget: string,
  orderCode: string, productId: number, variantId: number, qty: number, database: DatabaseAccess,
): Promise<boolean> {
  const { queryFirst, execRun, isD1Mode } = database;
  const secret = variantId && isD1Mode()
    ? await queryFirst(
        `SELECT shared_secret_ciphertext, shared_secret_iv FROM product_variants WHERE id=? AND product_id=?`,
        variantId, productId,
      )
    : null;
  const ct = String(secret?.shared_secret_ciphertext || "");
  const iv = String(secret?.shared_secret_iv || "");
  if (!ct || !iv) throw new Error("Shared secret not configured for product");
  const plaintext = await decryptSecret(ct, iv);
  await sendToRecipient(recipientChannel, recipientTarget, orderCode, plaintext, qty);
  // Fenced write: only applies while THIS worker still holds the lease.
  const settled = await execRun(
    `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
    `item:${itemId}`, itemId, leaseFence,
  );
  if (!settled.changes) throw new Error("lease_lost_during_delivery");
  return true;
}

/**
 * Pilih & sembuhkan ikatan unit inventory untuk baris unique (FASE 4a).
 *
 * One reserved inventory row per unique item, bound explicitly at
 * materialization (claimInventoryForItem) and re-validated here before
 * decrypt/send (review R3). A row pointing at another variant's unit (legacy
 * mis-binding) is NOT sent — it fails closed with inventory_mismatch so an
 * admin can reconcile instead of the buyer receiving the wrong credential.
 * Bila unit yang BENAR untuk baris ini masih tersedia, ikatan disembuhkan
 * (perilaku menyembuhkan, bukan macet).
 */
async function resolveUniqueInventory(
  item: Row, itemId: number, leaseFence: string, orderCode: string,
  productId: number, variantId: number, database: DatabaseAccess,
): Promise<Row> {
  const { queryFirst, execRun } = database;
  const bound = Number(item.inventory_id || 0) > 0
    ? await queryFirst(
        `SELECT * FROM fulfillment_inventory WHERE id=? AND order_code=? AND status='reserved'`,
        Number(item.inventory_id || 0), orderCode,
      )
    : null;
  let inventoryItem = bound && inventoryMatchesItem(bound, productId, variantId || null) ? bound : null;
  if (bound && !inventoryItem) {
    // Ikatan menunjuk unit varian lain (pemetaan salah historis) —
    // JANGAN kirim secret yang salah. Namun sebelum gagal, periksa dulu
    // apakah unit yang BENAR untuk baris ini masih tersedia: bila ya,
    // pakai unit benar itu (perilaku menyembuhkan, bukan macet); bila
    // tidak, gagal tertutup mismatch untuk rekonsiliasi admin.
    const correct = await findReservedForOrderVariant(orderCode, productId, variantId || null, database);
    if (correct && inventoryMatchesItem(correct, productId, variantId || null)) {
      const takenElsewhere = await queryFirst(
        `SELECT id FROM fulfillment_items WHERE order_code=? AND id!=? AND inventory_id=?`,
        orderCode, itemId, Number(correct.id),
      );
      if (!takenElsewhere) {
        const rebound = await execRun(`UPDATE fulfillment_items SET inventory_id=? WHERE id=? AND locked_until=?`, Number(correct.id), itemId, leaseFence);
        if (!rebound.changes) throw new Error("lease_lost_during_delivery");
        inventoryItem = correct;
      }
    }
    if (!inventoryItem) {
      throw new Error(`inventory_mismatch:unit ${Number(item.inventory_id)} bukan milik varian ${variantId || "-"} (perlu rekonsiliasi admin)`);
    }
  }
  if (!bound) {
    const fallback = await findReservedForOrderVariant(orderCode, productId, variantId || null, database);
    if (fallback && inventoryMatchesItem(fallback, productId, variantId || null)) {
      // Perbaiki ikatan baris ini ke unit yang cocok agar retry
      // berikutnya deterministik (bukan pencarian ulang tiap proses).
      // Unit yang sudah terikat ke baris LAIN order ini tidak boleh
      // direbut — satu unit = satu kebutuhan pengiriman (review R3).
      const takenElsewhere = await queryFirst(
        `SELECT id FROM fulfillment_items WHERE order_code=? AND id!=? AND inventory_id=?`,
        orderCode, itemId, Number(fallback.id),
      );
      if (!takenElsewhere) {
        const rebound = await execRun(`UPDATE fulfillment_items SET inventory_id=? WHERE id=? AND locked_until=?`, Number(fallback.id), itemId, leaseFence);
        if (!rebound.changes) throw new Error("lease_lost_during_delivery");
        inventoryItem = fallback;
      } else {
        throw new Error(`inventory_mismatch:unit ${Number(fallback.id)} sudah terikat ke baris lain order ${orderCode} (perlu rekonsiliasi admin)`);
      }
    }
  }
  if (!inventoryItem) throw new Error("No reserved inventory found");
  return inventoryItem;
}

/**
 * Mode unique (FASE 4): dekripsi unit terikat lalu selesaikan
 * inventory+item secara atomik di bawah lease yang sama.
 *
 * Catatan urutan: baris item diproses berurutan (item_index naik), sehingga
 * baris pertama mengonsumsi unit cocoknya dulu via markDelivered
 * (reserved→delivered). Baris kedua yang menunjuk unit yang SAMA melihatnya
 * sudah tidak reserved → mismatch, bukan kirim ulang secret yang sama.
 */
async function deliverUnique(
  item: Row, itemId: number, leaseFence: string, recipientChannel: string, recipientTarget: string,
  orderCode: string, productId: number, variantId: number, qty: number, database: DatabaseAccess,
): Promise<boolean> {
  const { execRun } = database;
  const inventoryItem = await resolveUniqueInventory(item, itemId, leaseFence, orderCode, productId, variantId, database);
  const plaintext = await decryptSecret(
    String(inventoryItem.secret_ciphertext),
    String(inventoryItem.secret_iv),
  );
  await sendToRecipient(recipientChannel, recipientTarget, orderCode, plaintext, qty);
  const d1 = database.d1;
  // Keep inventory and item settlement atomic, both under the item lease.
  // A worker resuming after its lease was taken cannot consume the unit.
  if (d1) {
    const settled = await d1.batch([
      d1.prepare(`UPDATE fulfillment_inventory SET status='delivered', delivered_at=datetime('now')
        WHERE id=? AND order_code=? AND status='reserved'
          AND EXISTS(SELECT 1 FROM fulfillment_items WHERE id=? AND inventory_id=? AND locked_until=? AND status='sending')`)
        .bind(Number(inventoryItem.id), orderCode, itemId, Number(inventoryItem.id), leaseFence),
      d1.prepare(`UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, locked_until=NULL, updated_at=datetime('now')
        WHERE id=? AND locked_until=? AND status='sending'
          AND EXISTS(SELECT 1 FROM fulfillment_inventory WHERE id=? AND order_code=? AND status='delivered')`)
        .bind(`item:${itemId}`, itemId, leaseFence, Number(inventoryItem.id), orderCode),
    ]);
    if (!settled.at(-1)?.meta.changes) throw new Error("lease_lost_during_delivery");
  } else {
    await markDelivered(Number(inventoryItem.id), database);
    await execRun(`UPDATE fulfillment_items SET status='delivered', locked_until=NULL WHERE id=? AND locked_until=?`, itemId, leaseFence);
  }
  return true;
}

export async function processItem(order: Row, itemRow: Row, adminChatId?: string, database: DatabaseAccess = createDatabaseAccess(), parent?: { jobId: number; lease: string }): Promise<boolean> {
  const { execRun } = database;
  const orderCode = String(order.code);
  const itemId = Number(itemRow.id);
  const lease = await claimItemLease(itemRow, database, parent);
  if ("skip" in lease) return lease.skip;
  const { item, leaseFence } = lease;

  const mode = String(order.sales_channel) === "whatsapp" && !isEnabled("WHATSAPP_FULFILLMENT") ? "manual" : String(item.fulfillment_mode || "manual");
  const recipientChannel = String(item.recipient_channel || order.sales_channel || "telegram");
  const recipientTarget = String(item.recipient_target || "");
  const productId = Number(item.product_id);
  const variantId = item.variant_id != null ? Number(item.variant_id) : 0;
  const qty = Math.max(1, Number(item.qty || 1));

  try {
    // Empty recipient → manual, never send to nobody (issue #4).
    if ((recipientChannel === "telegram" || recipientChannel === "whatsapp") && !recipientTarget) {
      throw new Error("no_recipient_for_channel");
    }
    const settledManual = await settleManualOrWeb(itemId, leaseFence, recipientChannel, mode, database);
    if (settledManual !== null) return settledManual;
    if (mode === "shared") {
      return await deliverShared(itemId, leaseFence, recipientChannel, recipientTarget, orderCode, productId, variantId, qty, database);
    }
    if (mode === "unique") {
      return await deliverUnique(item, itemId, leaseFence, recipientChannel, recipientTarget, orderCode, productId, variantId, qty, database);
    }
    throw new Error(`Unknown fulfillment mode: ${mode}`);
  } catch (error) {
    const errMsg = (error instanceof Error ? error.message : "Unknown delivery error").slice(0, 500);
    // A lost lease is not a delivery failure: the new owner proceeds, and
    // this worker must not consume the retry budget or overwrite its error.
    if (errMsg === "lease_lost_during_delivery") return false;
    if (errMsg.startsWith("inventory_mismatch")) {
      await execRun(
        `UPDATE fulfillment_items SET status='retry', last_error=?, locked_until=NULL,
         next_attempt_at=datetime('now', '+60 minutes'), updated_at=datetime('now') WHERE id=? AND locked_until=?`,
        errMsg, itemId, leaseFence,
      ).catch(() => undefined);
      return false;
    }
    await scheduleItemRetry(itemId, errMsg, leaseFence, database);
    void adminChatId;
    return false;
  }
}

export async function sendToRecipient(
  channel: string,
  target: string,
  orderCode: string,
  plaintext: string,
  qty: number,
): Promise<void> {
  const qtySuffix = qty > 1 ? ` (×${qty})` : "";
  if (channel === "whatsapp") {
    const sendResult = await sendTextMessage({
      target,
      message: `*PRODUK AXVARA SIAP!*\nOrder: ${orderCode}${qtySuffix}\n\nDetail akses/lisensi Anda:\n${plaintext}\n\nSimpan baik-baik. Ketik *garansi* untuk ketentuan.`,
    });
    if (!sendResult.ok) throw new Error(sendResult.error || "WhatsApp direct delivery failed");
    return;
  }
  if (channel === "web") {
    // Web has no push channel: a web item can only settle via an explicit
    // admin handover (recorded through the admin orders UI, which writes
    // the credential into admin_note and flips the item to delivered).
    // Auto-delivery must NEVER push it — and must never spin forever in
    // retry either. Mark it manual_required immediately so the order
    // surfaces in the admin handover queue with a clear action.
    throw new Error("web_channel_requires_manual_handover:serahkan manual via admin_note");
  }
  const sendResult = await sendMessage({
    chat_id: target,
    text: deliveryMessage(plaintext),
    parse_mode: "HTML",
  });
  if (!sendResult.ok) throw new Error(sendResult.description || "Telegram send failed");
}

export async function scheduleItemRetry(itemId: number, error: string, leaseFence?: string, database: DatabaseAccess = createDatabaseAccess()): Promise<void> {
  const { queryFirst, execRun } = database;
  const item = await queryFirst(`SELECT attempt_count, locked_until FROM fulfillment_items WHERE id=?`, itemId);
  const attempts = Number(item?.attempt_count ?? 0);
  // Fence: never touch a row whose lease moved on (a newer worker owns it).
  const fenceSql = leaseFence ? ` AND locked_until=?` : ``;
  const fenceArgs = leaseFence ? [leaseFence] : [];
  if (attempts >= MAX_ATTEMPTS) {
    await execRun(
      `UPDATE fulfillment_items SET status='failed', last_error=?, locked_until=NULL, updated_at=datetime('now') WHERE id=?${fenceSql}`,
      error, itemId, ...fenceArgs,
    );
    return;
  }
  const delayMinutes = RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)];
  await execRun(
    `UPDATE fulfillment_items SET status='retry', last_error=?, locked_until=NULL,
     next_attempt_at=datetime('now', '+${delayMinutes} minutes'), updated_at=datetime('now') WHERE id=?${fenceSql}`,
    error, itemId, ...fenceArgs,
  );
}
