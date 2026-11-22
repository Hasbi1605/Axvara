// src/lib/fulfillment/delivery/process.ts — Orkestrasi job: per-item modern + legacy.
//
// MENGAPA dipisah: file ini adalah "otak" yang menggabungkan manifest, klaim,
// dan pengiriman menjadi satu policy transisi order/job. Ia dipisah dari
// mekanisme kirim (send.ts) dan lease (claim.ts) agar kebijakan tingkat-tinggi
// (kapan order menjadi delivered/manual_required, kapan yield budget, kapan
// retry) dapat dibaca utuh. processLegacyJob dipecah per FASE mode
// (manual/shared/unique) menjadi helper <100 baris; perilaku items[0]-centric
// lama dipertahankan persis untuk data pra-migrasi/dev in-memory. NOL
// perubahan perilaku.

import { queryFirst, execRun, isD1Mode } from "@/lib/db";
import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret } from "../crypto";
import { findReservedForOrder, markDelivered } from "../inventory";
import { sendMessage } from "@/lib/telegram/api";
import {
  adminDeliveryFailedNotification,
} from "@/lib/telegram/messages";
import type { JobUnitResult, Row } from "./types";
import { COST_PER_DELIVERY_ITEM, COST_PER_JOB_FRAME, getJobsMem } from "./types";
import {
  allItemsDelivered,
  allItemsSettled,
  fulfillmentLineMismatches,
  fulfillmentModeFromOrderSnapshot,
  resolveRecipient,
} from "./manifest";
import { ensureFulfillmentItems } from "./inventory-binding";
import {
  claimJob,
  markJobDelivered,
  scheduleRetry,
  scheduleRetryFenced,
  writeJobOutcome,
} from "./claim";
import { processItem, sendToRecipient } from "./send";
import { expandDeliveryLines } from "../units";
import { eligibleStorebatLine } from "@/lib/storebat/orders";
import { eligibleMiraiLine } from "@/lib/mirai/orders";
import { eligibleAivaultLine } from "@/lib/aivault/orders";
import { eligibleTunvnLine } from "@/lib/tunvn/orders";
import { eligiblePixelverifLine } from "@/lib/pixelverif/orders";

/**
 * Proses SEBANYAK maxItems item berikutnya dari satu job (RR4-01).
 *
 * Unit kerja yang benar-benar bisa dilanjutkan: item yang sudah delivered/
 * manual_required dilewati (TIDAK dikirim ulang), item berikutnya diklaim
 * dan dikirim satu per satu, dan `item_cursor` (index berikutnya)
 * disimpan ke DB setiap selesai satu item — sehingga invocation berikutnya
 * (bahkan setelah restart worker) melanjutkan dari posisi yang benar.
 *
 * - `shouldContinue` dipanggil SEBELUM tiap item: kembalikan false untuk
 *   yield (budget habis). Yield BUKAN kegagalan provider: attempt job tidak
 *   dikonsumsi untuk item yang belum dicoba, dan item yang sudah delivered
 *   tidak diulang.
 * - Agregat job/order HANYA ditulis bila seluruh item terminal (selesai)
 *   ATAU ada kegagalan item yang butuh status retry/failed. Yield murni
 *   (semua item yang dicoba sukses tetapi masih ada sisa) TIDAK menulis
 *   retry — job kembali queued dan melepas lease agar cron berikutnya
 *   dapat melanjutkan tanpa menghabiskan jatah kegagalan.
 *
 * Kepemilikan lease antar invocation: klaim job per invocation (bukan
 * dipertahankan lintas cron). Tiap panggilan mengklaim ulang (CAS) bila
 * status masih queued/retry/sending-lease-lewat; item delivered tidak
 * disentuh ulang. Ini membuat retry budget hanya dikonsumsi oleh
 * kegagalan nyata, bukan oleh yield.
 */
export async function processJobItems(
  jobId: number, order: Row, product: Row, maxItems: number,
  shouldContinue?: () => boolean, database: DatabaseAccess = createDatabaseAccess(),
): Promise<JobUnitResult> {
  const { queryAll, queryFirst, execRun } = database;
  void product;
  const empty = (reason: "not_paid" | "no_work" | "not_owned" | "budget_yield"): JobUnitResult => ({ done: false, reason, attempted: 0, finished: false });
  if (order.status !== "lunas" || order.payment_status !== "paid") return empty("not_paid");
  // Pedia/Games never run through the Market job engine: stale false jobs (if any)
  // are left inert for history, never processed or re-materialized here.
  if (["pedia", "games"].includes(String(order.order_kind))) return empty("no_work");
  const orderCode = String(order.code);
  const channel = String(order.sales_channel || "telegram");
  if (!database.canSpend(COST_PER_JOB_FRAME)) return empty("budget_yield");
  const itemRows = await ensureFulfillmentItems(order, database, Number.isFinite(maxItems) ? Math.max(1, maxItems) : Infinity);
  if (!itemRows.length) return empty("budget_yield");
  // Admission includes claim + final reconciliation even if no item fits.
  if (!database.canSpend(COST_PER_JOB_FRAME)) return empty("budget_yield");
  const claimed = await claimJob(jobId, database, false);
  if (!claimed) return empty("not_owned");
  const lease = String(claimed.locked_until ?? "");
  if (fulfillmentLineMismatches(order.items, itemRows).some((m) => m.kind !== "missing")) {
    const owned = await writeJobOutcome(jobId, lease, "manual_required", "manual_required", database, { error: "fulfillment_manifest_mismatch" });
    return empty(owned ? "no_work" : "not_owned");
  }
  const start = Number(claimed.item_cursor ?? 0);
  let attempted = 0;
  let failure: string | null = null;
  let sendDeferred = false;
  // Item milik pipeline WR (wr_link_id NOT NULL) dilewati di sini (P0-5):
  // WR menyelesaikannya via wr_order_links, bukan processItem. Tanpa filter
  // ini, item WR queued memicu scheduleRetryFenced selamanya.
  // Item SK (sk_link_id NOT NULL) dilewati dengan pola yang sama (0049).
  let snapshot: Record<string,unknown>[]=[];
  try { snapshot=JSON.parse(String(order.items ?? "[]")); } catch { /* invalid manifests fail closed above */ }
  const readyTunvn = snapshot.some(item=>eligibleTunvnLine(item)) && database.canSpend(COST_PER_JOB_FRAME+1)
    ? await queryAll("SELECT id FROM tunvn_order_links WHERE order_code=? AND status='completed'",orderCode) : [];
  const readyStorebat = snapshot.some(item=>eligibleStorebatLine(item)) && database.canSpend(COST_PER_JOB_FRAME+1)
    ? await queryAll("SELECT id FROM storebat_order_links WHERE order_code=? AND status='completed'",orderCode) : [];
  const readyMirai = snapshot.some(item=>eligibleMiraiLine(item)) && database.canSpend(COST_PER_JOB_FRAME+1)
    ? await queryAll("SELECT id FROM mirai_order_links WHERE order_code=? AND status='completed'",orderCode) : [];
  const readyAivault = snapshot.some(item=>eligibleAivaultLine(item)) && database.canSpend(COST_PER_JOB_FRAME+1)
    ? await queryAll("SELECT id FROM aivault_order_links WHERE order_code=? AND status='completed'",orderCode) : [];
  const readyPixelverif = snapshot.some(item=>eligiblePixelverifLine(item)) && database.canSpend(COST_PER_JOB_FRAME+1)
    ? await queryAll("SELECT id FROM pixelverif_order_links WHERE order_code=? AND status='completed'",orderCode) : [];
  const pending = itemRows.filter((row) => !["delivered", "manual_required"].includes(String(row.status)) && row.wr_link_id == null && row.sk_link_id == null
    && (!eligibleStorebatLine(snapshot[Number(row.item_index)] ?? {}) || readyStorebat.some(link=>link.id===row.storebat_link_id))
    && (!eligibleMiraiLine(snapshot[Number(row.item_index)] ?? {}) || readyMirai.some(link=>link.id===row.mirai_link_id))
    && (!eligibleAivaultLine(snapshot[Number(row.item_index)] ?? {}) || readyAivault.some(link=>link.id===row.aivault_link_id))
    && (!eligiblePixelverifLine(snapshot[Number(row.item_index)] ?? {}) || readyPixelverif.some(link=>link.id===row.pixelverif_link_id))
    && (!eligibleTunvnLine(snapshot[Number(row.item_index)] ?? {}) || readyTunvn.some(link=>link.id===row.tunvn_link_id)));
  const todo = pending.filter((r) => Number(r.item_index) >= start).concat(pending.filter((r) => Number(r.item_index) < start));
  for (const row of todo.slice(0, Math.max(0, maxItems))) {
    // Worst-case item recovery + finalization are reserved before any provider call.
    // Shared push folds snapshot + lease read into UPDATE RETURNING, offsetting
    // its ledger CAS/checkpoint. Unique still needs one extra statement.
    const copyCost = String(row.recipient_channel || channel) === "telegram" && row.fulfillment_mode !== "manual" ? 1 : 0;
    const pushCost = String(row.recipient_channel || channel) === "telegram" && row.fulfillment_mode === "unique" ? 1 : 0;
    const itemCost = (row.tunvn_link_id != null || row.aivault_link_id != null || row.storebat_link_id != null || row.mirai_link_id != null || row.pixelverif_link_id != null ? 16 : row.fulfillment_mode === "unique" ? COST_PER_DELIVERY_ITEM : 8) + copyCost + pushCost;
    if (!database.canSpend(itemCost + COST_PER_JOB_FRAME) || (shouldContinue && !shouldContinue())) break;
    if (row.status === "failed") { failure ??= String(row.last_error || "item failed"); continue; }
    const ok = await processItem(order, row, process.env.TELEGRAM_ADMIN_CHAT_ID, database, { jobId, lease });
    attempted++;
    const checkpoint = await execRun(`UPDATE fulfillment_jobs SET item_cursor=? WHERE id=? AND locked_until=? AND status='sending'`, Number(row.item_index) + 1, jobId, lease);
    if (!checkpoint.changes) return { done: false, reason: "not_owned", attempted, finished: false };
    if (!ok) {
      const error = String((await queryFirst(`SELECT last_error FROM fulfillment_items WHERE id=?`, Number(row.id)))?.last_error || "item delivery failed");
      if (error.startsWith("credential_send_deferred:")) sendDeferred = true;
      else failure ??= error;
    }
  }
  const rows = await queryAll(`SELECT * FROM fulfillment_items WHERE order_code=? ORDER BY item_index ASC`, orderCode);
  const mismatches = fulfillmentLineMismatches(order.items, rows);
  const missingOnly = mismatches.length > 0 && mismatches.every((m) => m.kind === "missing");
  if (mismatches.length && !missingOnly) {
    const owned = await writeJobOutcome(jobId, lease, "manual_required", "manual_required", database, { error: "fulfillment_manifest_mismatch" });
    return { done: false, reason: owned ? "no_work" : "not_owned", attempted, finished: false };
  }
  if (!mismatches.length && allItemsSettled(rows)) {
    const aggregate = allItemsDelivered(rows) ? "delivered" : "manual_required";
    const owned = await writeJobOutcome(jobId, lease, "delivered", aggregate, database, { clearCursor: true });
    return owned ? { done: true, attempted, finished: true } : { done: false, reason: "not_owned", attempted, finished: false };
  }
  if (failure) {
    const outcome = await scheduleRetryFenced(jobId, failure, lease, database, true);
    return { done: false, reason: outcome.owned ? "item_failed" : "not_owned", attempted, finished: false };
  }
  if (sendDeferred) {
    const owned = await writeJobOutcome(jobId, lease, "retry", "retry", database, { error: "credential_send_pending", delay: 10 });
    return { done: false, reason: owned ? "budget_yield" : "not_owned", attempted, finished: false };
  }
  // A normal checkpoint is not a failed delivery attempt.
  const owned = await writeJobOutcome(jobId, lease, "queued", null, database);
  return { done: false, reason: owned ? "budget_yield" : "not_owned", attempted, finished: false };
}

/** Direct and cron delivery share the same policy and state transitions. */
export async function processJob(
  jobId: number, order: Row, product: Row,
  database: DatabaseAccess = createDatabaseAccess(),
  deadlineMs?: number,
): Promise<boolean> {
  if (deadlineMs !== undefined && Date.now() >= deadlineMs) return false;
  if (["pedia", "games"].includes(String(order.order_kind))) return false;
  // Dev's in-memory adapter has no per-item table; preserve its existing path.
  if (!database.d1) {
    if (order.status !== "lunas" || order.payment_status !== "paid") return false;
    const claimed = await claimJob(jobId, database);
    return claimed ? processLegacyJob(jobId, order, product, claimed) : false;
  }
  const deadline = deadlineMs ?? Date.now() + 40_000;
  const multiUnique = expandDeliveryLines(order.items).some(line => Number(line.unit_total) > 1);
  const result = await processJobItems(jobId, order, product, Infinity, deadlineMs !== undefined || multiUnique ? () => Date.now() < deadline : undefined, database);
  return result.done;
}

/** Legacy path FASE shared: satu shared secret produk/varian dikirim ke kanal. */
async function deliverLegacyShared(
  jobId: number, orderCode: string, chatId: string,
  fulfillmentSource: Row,
): Promise<boolean> {
  const ct = String(fulfillmentSource.shared_secret_ciphertext || "");
  const iv = String(fulfillmentSource.shared_secret_iv || "");
  if (!ct || !iv) throw new Error("Shared secret not configured for product");
  const plaintext = await decryptSecret(ct, iv);

  const messageId = await sendToRecipient("telegram", chatId, orderCode, plaintext, 1);
  await markJobDelivered(jobId, messageId);

  await execRun(
    `UPDATE orders SET fulfillment_status='delivered', updated_at=datetime('now') WHERE code=?`,
    orderCode,
  );
  return true;
}

/** Legacy path FASE unique: dekripsi reserved inventory lalu kirim. */
async function deliverLegacyUnique(
  jobId: number, orderCode: string, chatId: string,
): Promise<boolean> {
  const inventoryItem = await findReservedForOrder(orderCode);
  if (!inventoryItem) throw new Error("No reserved inventory found");
  const plaintext = await decryptSecret(
    String(inventoryItem.secret_ciphertext),
    String(inventoryItem.secret_iv),
  );

  const messageId = await sendToRecipient("telegram", chatId, orderCode, plaintext, 1);
  await markDelivered(Number(inventoryItem.id));
  await markJobDelivered(jobId, messageId);

  await execRun(
    `UPDATE orders SET fulfillment_status='delivered', updated_at=datetime('now') WHERE code=?`,
    orderCode,
  );
  return true;
}

/** Legacy path: catat kegagalan, beri tahu admin, dan cerminkan status job ke order. */
async function handleLegacyFailure(jobId: number, orderCode: string, error: unknown): Promise<false> {
  const errMsg = error instanceof Error ? error.message : "Unknown delivery error";
  await scheduleRetry(jobId, errMsg);

  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  // Notify admin on failure
  if (adminChatId) {
    try {
      await sendMessage({
        chat_id: adminChatId,
        text: adminDeliveryFailedNotification(orderCode, errMsg),
        parse_mode: "HTML",
      });
    } catch { /* admin notification is best-effort */ }
  }

  // Update order fulfillment status
  const job = isD1Mode()
    ? await queryFirst(`SELECT status FROM fulfillment_jobs WHERE id=?`, jobId)
    : getJobsMem().find((r) => Number(r.id) === jobId);
  const newStatus = String(job?.status ?? "retry");
  await execRun(
    `UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`,
    newStatus, orderCode,
  );

  return false;
}

/**
 * Legacy single-item processing for jobs without fulfillment_items rows
 * (pre-migration data, or dev in-memory flows). Preserves the previous
 * items[0]-centered behavior exactly; new code paths always materialize
 * per-item rows first via ensureFulfillmentItems.
 */
async function processLegacyJob(
  jobId: number,
  order: Row,
  product: Row,
  claimed: Row,
): Promise<boolean> {
  const salesChannel = String(order.sales_channel || "telegram");
  const orderCode = String(order.code);
  const recipient = resolveRecipient(order);
  const chatId = recipient.channel === "telegram" ? recipient.target : String(order.telegram_chat_id || "");

  if (salesChannel === "whatsapp") {
    await execRun(
      `UPDATE fulfillment_jobs SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
      jobId,
    );
    await execRun(
      `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
      orderCode,
    );
    return true;
  }

  try {
    // A selected variant owns its fulfillment mode and shared secret. Product
    // fields are only the legacy fallback while variant rollout is disabled.
    const variantId = Number(order.variant_id || claimed.variant_id || 0);
    const variant = variantId && isD1Mode()
      ? await queryFirst(
          `SELECT fulfillment_mode, shared_secret_ciphertext, shared_secret_iv
           FROM product_variants WHERE id=? AND product_id=?`,
          variantId,
          Number(product.id),
        )
      : null;
    if (variantId && isD1Mode() && !variant) throw new Error("Selected fulfillment variant not found");

    const fulfillmentSource = variant ? { ...product, ...variant } : product;
    const snapshotMode = fulfillmentModeFromOrderSnapshot(order);
    const fulfillmentMode = String(
      (claimed.inventory_id || String(order.fulfillment_status) === "reserved")
        ? "unique"
        : snapshotMode || fulfillmentSource.fulfillment_mode || "manual",
    );

    // Manual: payment acknowledgement is handled independently from
    // auto-fulfillment, so stop here and leave the order for the admin.
    if (fulfillmentMode === "manual") {
      await execRun(
        `UPDATE fulfillment_jobs SET status='manual_required', locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
        jobId,
      );
      await execRun(
        `UPDATE orders SET fulfillment_status='manual_required', updated_at=datetime('now') WHERE code=?`,
        orderCode,
      );
      return true;
    }

    // Shared: decrypt product shared secret
    if (fulfillmentMode === "shared") {
      return await deliverLegacyShared(jobId, orderCode, chatId, fulfillmentSource);
    }

    // Unique: decrypt reserved inventory
    if (fulfillmentMode === "unique") {
      return await deliverLegacyUnique(jobId, orderCode, chatId);
    }

    throw new Error(`Unknown fulfillment mode: ${fulfillmentMode}`);
  } catch (error) {
    return handleLegacyFailure(jobId, orderCode, error);
  }
}
