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
import type { Row } from "./types";
import { MAX_ATTEMPTS, RETRY_DELAYS } from "./types";
import { findReservedForOrderVariant, inventoryMatchesItem } from "./inventory-binding";
import { isValidBuyerEmail, sendWebDeliveryEmail, orderLineLabel } from "./buyer-email";
import { eligibleStorebatLine } from "@/lib/storebat/orders";
import { eligibleMiraiLine } from "@/lib/mirai/orders";
import { eligibleAivaultLine } from "@/lib/aivault/orders";
import { eligibleTunvnLine } from "@/lib/tunvn/orders";
import { CredentialSendDeferred, sendFencedCredential } from "./send-fence";

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
  const { queryFirst } = database;
  const itemId = Number(itemRow.id);
  const lockUntil = new Date(Date.now() + 60_000).toISOString();
  const lockRequested = lockUntil;
  // RETURNING yields only our won row. Freeze shared push ciphertext in the
  // same CAS, avoiding separate item-read, secret-read and snapshot statements.
  const claimed = await queryFirst(
    `UPDATE fulfillment_items SET status='sending', locked_until=?, attempt_count=attempt_count+1, updated_at=datetime('now'),
       delivered_ciphertext=CASE WHEN recipient_channel='telegram' AND fulfillment_mode='shared'
         AND (delivered_ciphertext IS NULL OR delivered_iv IS NULL)
         THEN (SELECT shared_secret_ciphertext FROM product_variants WHERE id=fulfillment_items.variant_id AND product_id=fulfillment_items.product_id)
         ELSE delivered_ciphertext END,
       delivered_iv=CASE WHEN recipient_channel='telegram' AND fulfillment_mode='shared'
         AND (delivered_ciphertext IS NULL OR delivered_iv IS NULL)
         THEN (SELECT shared_secret_iv FROM product_variants WHERE id=fulfillment_items.variant_id AND product_id=fulfillment_items.product_id)
         ELSE delivered_iv END
      WHERE id=? AND status IN ('queued','retry')
        AND (locked_until IS NULL OR datetime(locked_until) < datetime('now'))
        ${parent ? "AND EXISTS (SELECT 1 FROM fulfillment_jobs WHERE id=? AND locked_until=? AND status='sending')" : ""}
      RETURNING *`,
    lockUntil, itemId, ...(parent ? [parent.jobId, parent.lease] : []),
  ).catch(() => null);
  if (!claimed) {
    if (String(itemRow.status) === "sending") return { skip: true };
    // A retry row claimed/locked by another worker is not our failure.
    if (String(itemRow.status) === "retry") return { skip: true };
    return { skip: false };
  }
  return { item: claimed, leaseFence: lockRequested };
}

/**
 * Rute manual (FASE 2). Varian Made By Order (mode manual) masuk antrean
 * serah terima admin di semua kanal. Kanal web mengirim item shared/unique
 * lewat email pembeli (2026-09-25); order web tanpa email valid (order lama)
 * tidak punya tujuan kirim, jadi langsung ke antrean admin alih-alih
 * menghabiskan jatah retry.
 */
async function settleManualOrWeb(
  itemId: number, leaseFence: string, recipientChannel: string, mode: string, buyerEmail: unknown, database: DatabaseAccess,
): Promise<boolean | null> {
  const { execRun } = database;
  if (recipientChannel === "web" && mode !== "manual" && !isValidBuyerEmail(buyerEmail)) {
    await execRun(
      `UPDATE fulfillment_items SET status='manual_required', last_error='web_no_buyer_email:serahkan manual lewat panel admin', locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
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
  item: Row, itemId: number, leaseFence: string, recipientChannel: string, recipientTarget: string,
  orderCode: string, productId: number, variantId: number, qty: number, database: DatabaseAccess,
): Promise<boolean> {
  const { queryFirst, execRun, isD1Mode } = database;
  const push = recipientChannel === "telegram";
  const secret = !push && variantId && isD1Mode()
    ? await queryFirst(
        `SELECT shared_secret_ciphertext, shared_secret_iv FROM product_variants WHERE id=? AND product_id=?`,
        variantId, productId,
      )
    : null;
  const ct = String((push ? item.delivered_ciphertext : secret?.shared_secret_ciphertext) || "");
  const iv = String((push ? item.delivered_iv : secret?.shared_secret_iv) || "");
  if (!ct || !iv) throw new Error("Shared secret not configured for product");
  const plaintext = await decryptSecret(ct, iv);
  await sendItem(recipientChannel, recipientTarget, orderCode, itemId, leaseFence, plaintext, qty, database, variantId);
  // Fenced write: only applies while THIS worker still holds the lease.
  // Ciphertext yang barusan dikirim ikut disalin (migrasi 0043) supaya
  // halaman pesanan tetap menampilkan isi yang SAMA walau pesan bersama
  // varian diganti kemudian.
  const settled = await execRun(
    `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, delivered_ciphertext=?, delivered_iv=?, locked_until=NULL, updated_at=datetime('now') WHERE id=? AND locked_until=?`,
    `item:${itemId}`, ct, iv, itemId, leaseFence,
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
  orderCode: string, productId: number, variantId: number, qty: number, database: DatabaseAccess, unitLabel?: string,
): Promise<boolean> {
  const { execRun } = database;
  const inventoryItem = await resolveUniqueInventory(item, itemId, leaseFence, orderCode, productId, variantId, database);
  const secretCt = String(inventoryItem.secret_ciphertext);
  const secretIv = String(inventoryItem.secret_iv);
  const plaintext = await decryptSecret(secretCt, secretIv);
  await sendItem(recipientChannel, recipientTarget, orderCode, itemId, leaseFence, plaintext, qty, database, variantId, unitLabel);
  const d1 = database.d1;
  // Keep inventory and item settlement atomic, both under the item lease.
  // A worker resuming after its lease was taken cannot consume the unit.
  if (d1) {
    const settled = await d1.batch([
      d1.prepare(`UPDATE fulfillment_inventory SET status='delivered', delivered_at=datetime('now')
        WHERE id=? AND order_code=? AND status='reserved'
          AND EXISTS(SELECT 1 FROM fulfillment_items WHERE id=? AND inventory_id=? AND locked_until=? AND status='sending')`)
        .bind(Number(inventoryItem.id), orderCode, itemId, Number(inventoryItem.id), leaseFence),
      d1.prepare(`UPDATE fulfillment_items SET status='delivered', delivered_message_id=?, delivered_ciphertext=?, delivered_iv=?, locked_until=NULL, updated_at=datetime('now')
        WHERE id=? AND locked_until=? AND status='sending'
          AND EXISTS(SELECT 1 FROM fulfillment_inventory WHERE id=? AND order_code=? AND status='delivered')`)
        .bind(`item:${itemId}`, secretCt, secretIv, itemId, leaseFence, Number(inventoryItem.id), orderCode),
    ]);
    if (!settled.at(-1)?.meta.changes) throw new Error("lease_lost_during_delivery");
  } else {
    await markDelivered(Number(inventoryItem.id), database);
    await execRun(`UPDATE fulfillment_items SET status='delivered', delivered_ciphertext=?, delivered_iv=?, locked_until=NULL WHERE id=? AND locked_until=?`, secretCt, secretIv, itemId, leaseFence);
  }
  return true;
}

export async function processItem(order: Row, itemRow: Row, adminChatId?: string, database: DatabaseAccess = createDatabaseAccess(), parent?: { jobId: number; lease: string }): Promise<boolean> {
  const { execRun } = database;
  const orderCode = String(order.code);
  const itemId = Number(itemRow.id);
  // Item milik pipeline Warung Rebahan (P0-5): JANGAN klaim/kirim sebagai
  // manual palsu. Dicek SEBELUM claimItemLease agar attempt_count tidak
  // terbuang dan lease tidak tertahan. WR menyelesaikan item ini via
  // wr_order_links; agregat order dihitung refreshOrderAggregate.
  if (itemRow.wr_link_id != null) return false;
  // Item milik pipeline Sekalipay (0049, pola WR): diselesaikan via
  // sk_order_links; agregat order dihitung refreshOrderAggregate yang sama.
  if (itemRow.sk_link_id != null) return false;
  if (itemRow.aivault_link_id != null) {
    const avLink=await database.queryFirst("SELECT status FROM aivault_order_links WHERE id=? AND order_code=? AND item_index=?",itemRow.aivault_link_id,orderCode,itemRow.item_index);
    if (avLink?.status!=="completed") return false;
  } else {
    try { if (eligibleAivaultLine(JSON.parse(String(order.items ?? "[]"))[Number(itemRow.item_index)] ?? {})) return false; } catch { /* manifest validation below */ }
  }
  let storebatKind: unknown;
  if (itemRow.storebat_link_id != null) {
    const link=await database.queryFirst("SELECT status,kind FROM storebat_order_links WHERE id=? AND order_code=? AND item_index=?",itemRow.storebat_link_id,orderCode,itemRow.item_index);
    if (link?.status!=="completed") return false;
    storebatKind=link.kind;
  } else {
    try { if (eligibleStorebatLine(JSON.parse(String(order.items ?? "[]"))[Number(itemRow.item_index)] ?? {})) return false; } catch { /* manifest validation below */ }
  }
  if (itemRow.mirai_link_id != null) {
    const link = await database.queryFirst("SELECT status FROM mirai_order_links WHERE id=? AND order_code=? AND item_index=?", itemRow.mirai_link_id, orderCode, itemRow.item_index);
    if (link?.status !== "completed") return false;
  } else {
    try { if (eligibleMiraiLine(JSON.parse(String(order.items ?? "[]"))[Number(itemRow.item_index)] ?? {})) return false; } catch { /* manifest validation below */ }
  }
  let tunvnKind: unknown;
  if (itemRow.tunvn_link_id != null) {
    const link=await database.queryFirst("SELECT status,kind FROM tunvn_order_links WHERE id=? AND order_code=? AND item_index=?",itemRow.tunvn_link_id,orderCode,itemRow.item_index);
    if (link?.status!=="completed") return false;
    tunvnKind=link.kind;
  } else {
    try { if (eligibleTunvnLine(JSON.parse(String(order.items ?? "[]"))[Number(itemRow.item_index)] ?? {})) return false; } catch { /* normal manifest checks remain authoritative */ }
  }
  const lease = await claimItemLease(itemRow, database, parent);
  if ("skip" in lease) return lease.skip;
  const { item, leaseFence } = lease;
  if (item.tunvn_link_id != null || item.aivault_link_id != null || item.storebat_link_id != null || item.mirai_link_id != null) {
    try {
      if (item.delivered_ciphertext && item.delivered_iv) {
        const plaintext=await decryptSecret(String(item.delivered_ciphertext),String(item.delivered_iv));
        await sendItem(String(item.recipient_channel),String(item.recipient_target ?? ""),orderCode,itemId,leaseFence,plaintext,Number(item.qty),database,Number(item.variant_id));
      } else if (tunvnKind==="buff" || storebatKind==="muse_buff") {
        const { notifyBuyerBuffCompleted }=await import("@/lib/notify-buyer");
        if (!await notifyBuyerBuffCompleted(orderCode,Number(item.item_index),database)) throw new Error("buff_notice_deferred");
      } else throw new Error("supplier_receipt_missing");
      const done=await execRun("UPDATE fulfillment_items SET status='delivered',delivered_message_id=?,locked_until=NULL,last_error=NULL WHERE id=? AND locked_until=? AND status='sending'",`item:${itemId}`,itemId,leaseFence);
      return Boolean(done.changes);
    } catch (error) {
      if (await deferFencedSend(error, itemId, leaseFence, database)) return false;
      await scheduleItemRetry(itemId,"supplier_delivery_deferred",leaseFence,database);
      return false;
    }
  }
  // Race: item dikaitkan WR setelah baris dibaca — verifikasi ulang di bawah
  // lease; bila milik WR, lepas lease tanpa konsumsi hasil.
  if (item.wr_link_id != null) {
    await execRun(
      `UPDATE fulfillment_items SET status='queued', locked_until=NULL, updated_at=datetime('now')
       WHERE id=? AND locked_until=?`,
      itemId, leaseFence,
    ).catch(() => undefined);
    return false;
  }
  // Race SK yang sama (pola WR di atas).
  if (item.sk_link_id != null) {
    await execRun(
      `UPDATE fulfillment_items SET status='queued', locked_until=NULL, updated_at=datetime('now')
       WHERE id=? AND locked_until=?`,
      itemId, leaseFence,
    ).catch(() => undefined);
    return false;
  }

  const recipientChannel = String(item.recipient_channel || order.sales_channel || "telegram");
  const legacyWa = order.sales_channel === "whatsapp" || recipientChannel === "whatsapp";
  const mode = legacyWa ? "manual" : String(item.fulfillment_mode || "manual");
  const recipientTarget = String(item.recipient_target || "");
  const productId = Number(item.product_id);
  const variantId = item.variant_id != null ? Number(item.variant_id) : 0;
  const qty = Math.max(1, Number(item.qty || 1));

  try {
    // Empty recipient → manual, never send to nobody (issue #4).
    if (!legacyWa && recipientChannel === "telegram" && !recipientTarget) {
      throw new Error("no_recipient_for_channel");
    }
    const settledManual = await settleManualOrWeb(itemId, leaseFence, recipientChannel, mode, order.customer_email, database);
    if (settledManual !== null) return settledManual;
    if (mode === "shared") {
      return await deliverShared(item, itemId, leaseFence, recipientChannel, recipientTarget, orderCode, productId, variantId, qty, database);
    }
    if (mode === "unique") {
      return await deliverUnique(item, itemId, leaseFence, recipientChannel, recipientTarget, orderCode, productId, variantId, qty, database, orderLineLabel(order.items, Number(item.item_index)));
    }
    throw new Error(`Unknown fulfillment mode: ${mode}`);
  } catch (error) {
    if (await deferFencedSend(error, itemId, leaseFence, database)) return false;
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
    // Alarm admin saat item JATUH TERMINAL (2026-09-22). Sebelumnya
    // `void adminChatId` membuang parameternya: jalur fulfillment modern gagal
    // dalam diam sementara jalur legacy (delivery/process.ts) mengirim ping
    // Telegram. Akibatnya stok habis / secret belum diset menumpuk berhari-hari
    // tanpa ada yang tahu — dan order itu sekaligus jatuh ke
    // `fulfillment_status='failed'` yang dulu tak punya tombol handover.
    const becameTerminal = await scheduleItemRetry(itemId, errMsg, leaseFence, database);
    if (becameTerminal) {
      const chatId = adminChatId || process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (chatId) {
        try {
          const { adminDeliveryFailedNotification } = await import("@/lib/telegram/messages");
          await sendMessage({
            chat_id: chatId,
            text: adminDeliveryFailedNotification(orderCode, errMsg),
            parse_mode: "HTML",
          });
        } catch { /* ping admin best-effort; jangan gagalkan worker */ }
      }
      // Kabari PEMBELI juga (2026-09-23): sebelumnya hanya admin yang tahu,
      // sehingga pembeli yang sudah lunas menunggu tanpa batas tanpa satu pun
      // kabar. Best-effort — kegagalan kirim tidak boleh mengubah status item.
      try {
        const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
        await notifyBuyerDeliveryFailed(orderCode, database);
      } catch { /* kabar pembeli best-effort */ }
    }
    return false;
  }
}

/** Kanal web lewat email pembeli; kanal lain lewat sendToRecipient. */
async function sendItem(
  channel: string, target: string, orderCode: string, itemId: number, leaseFence: string, plaintext: string, qty: number, database: DatabaseAccess, variantId: number, label?: string,
): Promise<void> {
  if (channel === "web") {
    await sendWebDeliveryEmail({ database, orderCode, itemId, plaintext });
    return;
  }
  await sendToRecipient(channel, target, orderCode, plaintext, qty, database, variantId, label, { itemId, leaseFence });
  if (channel === "telegram") {
    // Salinan email (2026-11-04) untuk pembeli Telegram dengan produk wajib-email.
    // DM Telegram sudah sukses dan otoritatif; email best-effort, idempoten per
    // item (buyer_notice_log), dan kegagalannya TIDAK boleh memicu retry item.
    try {
      const { telegramEmailCopyTarget } = await import("@/lib/telegram/email-copy");
      if (await telegramEmailCopyTarget(orderCode, database)) {
        await sendWebDeliveryEmail({ database, orderCode, itemId, plaintext });
      }
    } catch { /* email best-effort */ }
  }
}

export async function sendToRecipient(
  channel: string,
  target: string,
  orderCode: string,
  plaintext: string,
  _qty: number,
  database: DatabaseAccess = createDatabaseAccess(),
  variantId = 0,
  productName?: string,
  automatic?: { itemId: number; leaseFence: string },
): Promise<string> {
  if (channel === "web") {
    // Kanal web dikirim lewat email oleh sendItem; jalur ini tidak boleh
    // dipakai untuk web (tidak ada tujuan push selain email).
    throw new Error("web_channel_uses_email_delivery");
  }
  if (channel !== "telegram") throw new Error("unsupported_delivery_channel");
  const { resolveCredentialTermsForVariants, resolveCredentialTermsByItem } = await import("@/lib/orders/credential-terms");
  const copies = variantId
    ? await resolveCredentialTermsForVariants([variantId], database)
    : await resolveCredentialTermsByItem(orderCode, database);
  const { credentialMessages } = await import("@/lib/telegram/messages/credential");
  const messages = credentialMessages({
    orderCode, plaintext, productName, copy: copies.get(variantId || 0), secretTag: "code",
  });
  if (automatic) {
    if (!/^[1-9]\d*$/.test(target) || !Number.isSafeInteger(Number(target))) throw new Error("no_private_telegram_chat");
    return sendFencedCredential(database, automatic.itemId, automatic.leaseFence, "telegram", messages, async text => {
      const sent = await sendMessage({ chat_id: target, text, parse_mode: "HTML", disable_web_page_preview: true });
      return {
        ok: Boolean(sent?.ok), messageId: String(sent?.result?.message_id ?? ""),
        definiteFailure: Number(sent?.error_code) >= 400 && Number(sent?.error_code) < 500 && sent?.error_code !== 408,
      };
    });
  }
  const { sendTelegramCredentialParts } = await import("@/lib/telegram/credential-delivery");
  const sent = await sendTelegramCredentialParts(target, messages);
  return sent.messageId;
}

/** Waiting for another send/unknown result is not another failed send attempt. */
async function deferFencedSend(error: unknown, itemId: number, leaseFence: string, database: DatabaseAccess): Promise<boolean> {
  if (!(error instanceof CredentialSendDeferred)) return false;
  await database.execRun(
    `UPDATE fulfillment_items SET status='retry',last_error=?,locked_until=NULL,
       attempt_count=MAX(0,attempt_count-1),next_attempt_at=datetime('now','+10 minutes'),updated_at=datetime('now')
     WHERE id=? AND locked_until=? AND status='sending'`,
    error.message, itemId, leaseFence,
  ).catch(() => undefined);
  return true;
}

/**
 * Jadwalkan retry item, atau tandai `failed` bila attempt habis.
 *
 * Mengembalikan `true` HANYA pada transisi terminal (menjadi `failed`) agar
 * pemanggil bisa membunyikan alarm admin sekali saja — bukan tiap percobaan.
 */
export async function scheduleItemRetry(itemId: number, error: string, leaseFence?: string, database: DatabaseAccess = createDatabaseAccess()): Promise<boolean> {
  const { queryFirst, execRun } = database;
  const item = await queryFirst(`SELECT attempt_count, locked_until FROM fulfillment_items WHERE id=?`, itemId);
  const attempts = Number(item?.attempt_count ?? 0);
  // Fence: never touch a row whose lease moved on (a newer worker owns it).
  const fenceSql = leaseFence ? ` AND locked_until=?` : ``;
  const fenceArgs = leaseFence ? [leaseFence] : [];
  if (attempts >= MAX_ATTEMPTS) {
    const result = await execRun(
      `UPDATE fulfillment_items SET status='failed', last_error=?, locked_until=NULL, updated_at=datetime('now') WHERE id=?${fenceSql}`,
      error, itemId, ...fenceArgs,
    );
    // Hanya baris yang benar-benar berubah = transisi terminal milik worker
    // ini. Fence yang kalah race menghasilkan 0 changes → jangan alert ganda.
    return Number(result?.changes ?? 0) > 0;
  }
  const delayMinutes = RETRY_DELAYS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS.length - 1)];
  await execRun(
    `UPDATE fulfillment_items SET status='retry', last_error=?, locked_until=NULL,
     next_attempt_at=datetime('now', '+${delayMinutes} minutes'), updated_at=datetime('now') WHERE id=?${fenceSql}`,
    error, itemId, ...fenceArgs,
  );
  return false;
}
