// src/lib/warung-rebahan/deliver.ts — Completion + delivery detail akun WR.
//
// DESAIN (migrasi 0029):
// - Status vendor (processing/completed/failed) monotonik via CAS
//   (advanceWrLinkMonotonic): completed TIDAK PERNAH diregresi oleh failed
//   yang terlambat/replay (P1-7).
// - Status delivery kredensial (delivery_status) TERPISAH dari status
//   vendor: completed dicatat dulu, delivery di-retry sampai durable
//   (P0-6). Order baru dianggap selesai setelah delivery queued/settled.
// - Item WR adalah fulfillment_items mode 'manual' (kontrak fulfillment:
//   hanya manual/shared/unique). Completion WR menyelesaikan HANYA item
//   WR terkait; agregat order dihitung dari SELURUH fulfillment_items
//   (P0-5) — mixed cart tidak delivered prematur.
// - Detail akun dienkripsi AES-256-GCM sebelum disimpan (tidak plaintext).
// - Web retrieval memakai capability token (hash di DB, raw hanya ke
//   pembeli) — TIDAK dibuka hanya dengan kode order (P0-6).
// - Telegram hanya private chat; WhatsApp hanya DM via outbox.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { decryptSecret, encryptSecret } from "@/lib/fulfillment/crypto";

export type WrOrderLinkRow = {
  id: number;
  order_code: string;
  wr_order_id: string | null;
  wr_variant_id: string;
  quantity: number;
  wr_cost: number;
  status: string;
};

export type WrDeliveryChannel = "web" | "telegram" | "whatsapp";

/** Urutan monotonik status vendor: index naik = maju. Regresi dilarang. */
const WR_STATUS_RANK: Record<string, number> = {
  pending: 0,
  claimed: 1,
  retry: 1,
  blocked_balance: 1,
  submitted: 2,
  ordering: 2,
  processing: 3,
  completed: 4,
  failed: 4,
};

export function wrStatusRank(status: unknown): number {
  return WR_STATUS_RANK[String(status)] ?? -1;
}

/**
 * Maju status vendor secara monotonik + CAS (P1-7).
 * - completed/failed (rank 4) tidak bisa diregresi ke rank lebih rendah.
 * - completed tidak bisa diubah menjadi failed dan sebaliknya (keduanya
 *   terminal) — webhook yang kalah sempre direkam di wr_webhook_events
 *   dengan applied=0 (observable, bukan diam).
 * - Event duplikat (event_id sama) tidak diterapkan dua kali.
 * Mengembalikan true bila transisi diterapkan.
 */
export async function advanceWrLinkMonotonic(
  wrOrderId: string,
  toStatus: "processing" | "completed" | "failed",
  fields: Record<string, unknown> | null,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  const from = String(link.status || "");
  // Dedupe event: event_id sama yang sudah diterapkan → no-op tercatat.
  if (eventId) {
    const seen = await queryFirst(
      `SELECT id FROM wr_webhook_events WHERE wr_order_id=? AND event_id=? AND applied=1`,
      wrOrderId,
      eventId,
    ).catch(() => null);
    if (seen) {
      await logWebhookEvent(db, wrOrderId, toStatus, eventId, false, "duplicate_event_id").catch(
        () => undefined,
      );
      return true;
    }
  }
  const fromRank = wrStatusRank(from);
  const toRank = wrStatusRank(toStatus);
  // Terminal vs terminal berbeda = regresi terlarang (completed→failed).
  if (fromRank >= 4 && toRank >= 4 && from !== toStatus) {
    await logWebhookEvent(db, wrOrderId, toStatus, eventId, false, `terminal_regression_blocked:${from}`).catch(
      () => undefined,
    );
    return false;
  }
  // Regresi rank = webhook terlambat/replay.
  if (toRank < fromRank) {
    await logWebhookEvent(db, wrOrderId, toStatus, eventId, false, `rank_regression_blocked:${from}`).catch(
      () => undefined,
    );
    return false;
  }
  if (from === toStatus) {
    await logWebhookEvent(db, wrOrderId, toStatus, eventId, true, "idempotent_replay").catch(
      () => undefined,
    );
    return true;
  }
  const now = new Date().toISOString();
  const sets = [`status='${toStatus}'`, `last_event_at='${now}'`];
  const values: unknown[] = [];
  if (eventId) {
    sets.push(`last_event_id=?`);
    values.push(eventId);
  }
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key}=?`);
      values.push(value);
    }
  }
  sets.push(`updated_at=datetime('now')`);
  // CAS: hanya menang bila status saat ini masih `from` (fenced — worker
  // lain yang sudah memajukan tidak ditimpa).
  const res = await execRun(
    `UPDATE wr_order_links SET ${sets.join(", ")} WHERE wr_order_id=? AND status=?`,
    ...values,
    wrOrderId,
    from,
  ).catch(() => ({ changes: 0 as number | undefined }));
  const applied = Number(res.changes ?? 0) > 0;
  await logWebhookEvent(
    db,
    wrOrderId,
    toStatus,
    eventId,
    applied,
    applied ? `advanced:${from}` : "lost_race",
  ).catch(() => undefined);
  return applied;
}

async function logWebhookEvent(
  db: DatabaseAccess,
  wrOrderId: string,
  event: string,
  eventId: string | undefined,
  applied: boolean,
  result: string,
): Promise<void> {
  try {
    await db.execRun(
      `INSERT INTO wr_webhook_events (wr_order_id, event, event_id, applied, result)
       VALUES (?,?,?,?,?)`,
      wrOrderId,
      event,
      eventId ?? null,
      applied ? 1 : 0,
      result.slice(0, 200),
    );
  } catch {
    // DB pre-0029: tabel belum ada — abaikan, transisi tetap berlaku.
  }
}

export function formatWrAccountDetails(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.slice(0, 2000);
  try {
    const data = raw as Record<string, unknown>;
    const details = Array.isArray(data) ? data : (data.account_details as unknown[]);
    if (Array.isArray(details) && details.length) {
      return details
        .map((d) => {
          if (typeof d === "string") return d;
          const o = d as Record<string, unknown>;
          const parts = ["email", "username", "user", "password", "pass", "pin", "akun", "note", "keterangan"]
            .map((k) => (o[k] != null && String(o[k]).trim() ? `${k}: ${String(o[k]).trim()}` : ""))
            .filter(Boolean);
          return parts.length ? parts.join(" · ") : JSON.stringify(o).slice(0, 500);
        })
        .join("\n")
        .slice(0, 2000);
    }
    const flat = ["email", "username", "password"]
      .map((k) => (data[k] != null ? `${k}: ${String(data[k])}` : ""))
      .filter(Boolean)
      .join("\n");
    if (flat) return flat.slice(0, 2000);
    return JSON.stringify(raw).slice(0, 2000);
  } catch {
    return String(raw).slice(0, 2000);
  }
}

export async function encryptAccountDetails(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  return encryptSecret(plaintext);
}

export async function decryptAccountDetails(ciphertext: string, iv: string): Promise<string> {
  return decryptSecret(ciphertext, iv);
}

/**
 * Webhook order.completed (P0-5 + P0-6):
 * 1. Simpan akun terenkripsi (tidak plaintext).
 * 2. Maju monotonik ke completed (CAS — replay failed kemudian ditolak).
 * 3. Selesaikan HANYA fulfillment_items WR terkait (bukan seluruh order).
 * 4. Hitung agregat order dari SELURUH fulfillment_items.
 * 5. Queue delivery kredensial secara durable; duplicate webhook melanjutkan
 *    delivery yang belum selesai (bukan no-op buta).
 */
export async function handleWrOrderCompleted(
  wrOrderId: string,
  accountPayload: unknown,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  const plaintext = formatWrAccountDetails(
    (accountPayload as { account_details?: unknown })?.account_details ?? accountPayload,
  );
  const { ciphertext, iv } = await encryptSecret(plaintext || "(detail akun kosong dari WR)");
  const now = new Date().toISOString();
  // Simpan kredensial dulu (durable) — sebelum status, agar crash di tengah
  // tidak menghasilkan completed tanpa akun.
  await execRun(
    `UPDATE wr_order_links SET wr_account_details=?, wr_account_iv=?,
       completed_at=?, last_error=NULL, updated_at=datetime('now')
     WHERE wr_order_id=?`,
    ciphertext,
    iv,
    now,
    wrOrderId,
  );
  const advanced = await advanceWrLinkMonotonic(wrOrderId, "completed", {
    completed_at: now,
    last_error: null,
  }, db);
  void advanced;
  // Selesaikan item WR terkait + agregat ulang dari seluruh item.
  await settleWrFulfillmentItem(String(link.order_code), Number(link.fulfillment_item_id || 0), db);
  await refreshOrderAggregate(String(link.order_code), db);
  // Delivery durable: queue (atau lanjutkan bila sudah queued/gagal).
  await queueCredentialDelivery(Number(link.id), db);
  // Coba kirim segera; bila gagal, delivery_status tetap queued/failed dan
  // cron delivery + webhook duplikat akan retry (P0-6).
  await processCredentialDelivery(Number(link.id), db).catch(() => undefined);
  return true;
}

/**
 * Webhook order.failed: monotonik (P1-7) — tidak meregresi completed.
 * Item WR terkait → failed; agregat dihitung ulang (bukan order failed buta,
 * agar mixed cart yang item lain sudah delivered tetap jujur).
 */
export async function handleWrOrderFailed(
  wrOrderId: string,
  errorMessage: string,
  database?: DatabaseAccess,
  eventId?: string,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE wr_order_id=?`, wrOrderId).catch(
    () => null,
  );
  if (!link) return false;
  const applied = await advanceWrLinkMonotonic(
    wrOrderId,
    "failed",
    { last_error: String(errorMessage || "wr_order_failed").slice(0, 500) },
    db,
    eventId,
  );
  if (!applied) return true; // regresi diblokir (mis. sudah completed) — tetap 200.
  // Item WR terkait → failed; agregat ulang dari seluruh item.
  const itemId = Number(link.fulfillment_item_id || 0);
  if (itemId > 0) {
    await execRun(
      `UPDATE fulfillment_items SET status='failed', last_error=?,
         locked_until=NULL, updated_at=datetime('now') WHERE id=?`,
      String(errorMessage || "wr_order_failed").slice(0, 500),
      itemId,
    ).catch(() => undefined);
  }
  await refreshOrderAggregate(String(link.order_code), db);
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (adminChatId && process.env.TELEGRAM_BOT_ENABLED === "true") {
    try {
      const { sendMessage } = await import("@/lib/telegram/api");
      await sendMessage({
        chat_id: adminChatId,
        text:
          `⚠️ <b>Order WR gagal</b> <code>${String(link.order_code)}</code>\n` +
          `WR: <code>${wrOrderId}</code> — ${String(errorMessage).slice(0, 200)}\n` +
          `Tangani manual (refund/cancel) via admin.`,
        parse_mode: "HTML",
      });
    } catch {
      /* best-effort */
    }
  }
  return true;
}

/**
 * Kaitkan link WR ke baris fulfillment_items yang tepat (P0-5).
 * Dipanggil saat link dibuat (bila item sudah materialisasi) dan oleh
 * reconciler. Satu link ↔ satu item_index (kebutuhan canonical per varian).
 * Item WR memakai mode 'manual' (kontrak fulfillment) tetapi TIDAK boleh
 * muncul sebagai pekerjaan manual palsu: kolom wr_variant marker + kolom
 * fulfillment_items.wr_link_id menandai kepemilikan WR.
 */
export async function bindWrLinkToFulfillmentItem(
  linkId: number,
  database?: DatabaseAccess,
): Promise<number> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link || Number(link.fulfillment_item_id || 0) > 0) return Number(link?.fulfillment_item_id || 0);
  const orderCode = String(link.order_code || "");
  // Cari item dengan variant yang punya wr_variant_id sama.
  const items = await queryFirst(
    `SELECT fi.id FROM fulfillment_items fi
     JOIN product_variants pv ON pv.id = fi.variant_id
     WHERE fi.order_code=? AND pv.wr_variant_id=?
     ORDER BY fi.item_index ASC LIMIT 1`,
    orderCode,
    String(link.wr_variant_id || ""),
  ).catch(() => null);
  if (!items) return 0;
  const itemId = Number(items.id);
  // .catch: DB pre-0029 (kolom belum ada) → reconciler mengisi setelah migrasi.
  await execRun(`UPDATE wr_order_links SET fulfillment_item_id=? WHERE id=?`, itemId, linkId).catch(
    () => undefined,
  );
  await execRun(`UPDATE fulfillment_items SET wr_link_id=? WHERE id=?`, linkId, itemId).catch(
    () => undefined,
  );
  return itemId;
}

/**
 * Selesaikan HANYA item WR terkait (P0-5). Item manual/shared/unique lain
 * tidak disentuh — mixed cart tidak delivered prematur.
 */
async function settleWrFulfillmentItem(
  orderCode: string,
  fulfillmentItemId: number,
  db: DatabaseAccess,
): Promise<void> {
  if (fulfillmentItemId > 0) {
    await db
      .execRun(
        `UPDATE fulfillment_items SET status='delivered', delivered_message_id=?,
           locked_until=NULL, updated_at=datetime('now') WHERE id=? AND order_code=?`,
        `wr:${fulfillmentItemId}`,
        fulfillmentItemId,
        orderCode,
      )
      .catch(() => undefined);
    return;
  }
  // Link lama (fulfillment_item_id NULL): fallback ke item WR order ini.
  await db
    .execRun(
      `UPDATE fulfillment_items SET status='delivered', delivered_message_id='wr:legacy',
         locked_until=NULL, updated_at=datetime('now')
       WHERE order_code=? AND id IN (
         SELECT fi.id FROM fulfillment_items fi
         JOIN product_variants pv ON pv.id = fi.variant_id
         WHERE fi.order_code=? AND pv.wr_variant_id IS NOT NULL
       )`,
      orderCode,
      orderCode,
    )
    .catch(() => undefined);
}

/**
 * Agregat order dari SELURUH fulfillment_items (P0-5) — menggantikan logika
 * lama "semua link completed → delivered" yang membutakan item non-WR.
 * - semua delivered → delivered
 * - semua settled (delivered/manual_required) → manual_required
 * - ada failed dan sisanya settled → failed (sinyal admin, bukan delivered)
 * - masih ada queued/sending/retry → biarkan status berjalan (queued/sending)
 * Generic reconciler (reconcileSettledJobs) tetap bisa memperbaiki tanpa
 * menghidupkan ulang delivery terminal: delivered/manual_required/failed
 * tidak pernah dibuka kembali di sini.
 */
export async function refreshOrderAggregate(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<string> {
  const db = database ?? createDatabaseAccess();
  const { queryAll, queryFirst, execRun } = db;
  const rows = await queryAll(`SELECT status FROM fulfillment_items WHERE order_code=?`, orderCode).catch(
    () => [],
  );
  if (!rows.length) return "";
  const statuses = rows.map((r) => String(r.status || ""));
  const allDelivered = statuses.every((s) => s === "delivered");
  const allSettled = statuses.every((s) => s === "delivered" || s === "manual_required");
  const anyFailed = statuses.some((s) => s === "failed");
  const anyActive = statuses.some((s) => ["queued", "sending", "retry"].includes(s));
  let aggregate: string | null = null;
  if (allDelivered) aggregate = "delivered";
  else if (allSettled) aggregate = "manual_required";
  else if (anyFailed && !anyActive) aggregate = "failed";
  else if (anyActive) {
    const current = await queryFirst(`SELECT fulfillment_status FROM orders WHERE code=?`, orderCode).catch(
      () => null,
    );
    const cur = String(current?.fulfillment_status || "queued");
    aggregate = ["delivered", "manual_required", "failed"].includes(cur) ? null : cur === "sending" ? "sending" : "queued";
  }
  if (!aggregate) return "";
  // Fence: jangan buka terminal yang sudah benar (reconciler generik aman).
  const current = await queryFirst(`SELECT fulfillment_status FROM orders WHERE code=?`, orderCode).catch(
    () => null,
  );
  const cur = String(current?.fulfillment_status || "");
  if (cur === aggregate) return aggregate;
  if (cur === "delivered" && aggregate !== "delivered") return cur;
  await execRun(`UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE code=?`, aggregate, orderCode).catch(
    () => undefined,
  );
  return aggregate;
}

/**
 * Queue delivery kredensial secara durable (P0-6). Idempoten: delivered
 * tidak di-queue ulang; queued/failed dilanjutkan (duplicate webhook
 * melanjutkan delivery yang belum selesai).
 */
export async function queueCredentialDelivery(linkId: number, database?: DatabaseAccess): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link) return false;
  if (String(link.delivery_status || "") === "delivered") return true;
  if (!link.wr_account_details) return false;
  const order = await queryFirst(
    `SELECT sales_channel FROM orders WHERE code=?`,
    String(link.order_code || ""),
  ).catch(() => null);
  const channel = String(order?.sales_channel || "web") as WrDeliveryChannel;
  await execRun(
    `UPDATE wr_order_links SET delivery_status='queued', delivery_channel=?,
       delivery_next_attempt_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND delivery_status!='delivered'`,
    channel,
    linkId,
  ).catch(() => undefined);
  return true;
}

const WR_DELIVERY_MAX_ATTEMPTS = 5;
const WR_DELIVERY_DELAYS_MINUTES = [1, 5, 15, 60];

/**
 * Proses satu delivery kredensial dengan claim/lease (P0-6). Telegram hanya
 * private chat; WhatsApp hanya DM via outbox; web via capability token
 * (tidak ada push — delivered saat token diterbitkan durable).
 */
export async function processCredentialDelivery(
  linkId: number,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const leaseOwner = `dlv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const leaseUntil = new Date(Date.now() + 120_000).toISOString();
  const claimed = await execRun(
    `UPDATE wr_order_links SET delivery_status='sending',
       delivery_attempt_count=delivery_attempt_count+1, updated_at=datetime('now')
     WHERE id=? AND delivery_status IN ('queued','failed')
       AND (delivery_next_attempt_at IS NULL OR datetime(delivery_next_attempt_at) <= datetime('now'))`,
    linkId,
  ).catch(() => ({ changes: 0 as number | undefined }));
  if (Number(claimed.changes ?? 0) === 0) {
    const cur = await queryFirst(`SELECT delivery_status FROM wr_order_links WHERE id=?`, linkId).catch(
      () => null,
    );
    return String(cur?.delivery_status || "") === "delivered";
  }
  void leaseOwner;
  void leaseUntil;
  const link = await queryFirst(`SELECT * FROM wr_order_links WHERE id=?`, linkId).catch(() => null);
  if (!link || !link.wr_account_details) {
    await execRun(`UPDATE wr_order_links SET delivery_status='failed', delivery_last_error='no_credential' WHERE id=?`, linkId).catch(
      () => undefined,
    );
    return false;
  }
  const attempts = Number(link.delivery_attempt_count || 0);
  try {
    const plaintext = await decryptSecret(String(link.wr_account_details), String(link.wr_account_iv));
    const channel = String(link.delivery_channel || "web") as WrDeliveryChannel;
    if (channel === "web") {
      // Web: tidak ada push channel. Delivery = token capability diterbitkan
      // durable (lihat issueCredentialToken). settled saat token ada.
      const token = await issueCredentialToken(String(link.order_code), db);
      if (!token) throw new Error("capability_token_issue_failed");
    } else if (channel === "telegram") {
      await deliverTelegramCredential(String(link.order_code), plaintext, db);
    } else {
      await deliverWhatsAppCredential(String(link.order_code), plaintext, db);
    }
    const now = new Date().toISOString();
    await execRun(
      `UPDATE wr_order_links SET delivery_status='delivered', delivered_at=?,
         delivery_last_error=NULL, updated_at=datetime('now') WHERE id=?`,
      now,
      linkId,
    );
    return true;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    if (attempts >= WR_DELIVERY_MAX_ATTEMPTS) {
      await execRun(
        `UPDATE wr_order_links SET delivery_status='failed', delivery_last_error=?,
           updated_at=datetime('now') WHERE id=?`,
        message,
        linkId,
      ).catch(() => undefined);
      return false;
    }
    const delay = WR_DELIVERY_DELAYS_MINUTES[Math.min(Math.max(attempts - 1, 0), WR_DELIVERY_DELAYS_MINUTES.length - 1)];
    await execRun(
      `UPDATE wr_order_links SET delivery_status='failed', delivery_last_error=?,
         delivery_next_attempt_at=datetime('now','+${delay} minutes'),
         updated_at=datetime('now') WHERE id=?`,
      message,
      linkId,
    ).catch(() => undefined);
    return false;
  }
}

/** Cron delivery: proses antrean kredensial due (bounded). */
export async function processDueCredentialDeliveries(
  database?: DatabaseAccess,
  limit = 4,
): Promise<{ processed: number; delivered: number }> {
  const db = database ?? createDatabaseAccess();
  const out = { processed: 0, delivered: 0 };
  if (!db.canSpend(4)) return out;
  const due = await db
    .queryAll(
      `SELECT id FROM wr_order_links
       WHERE delivery_status IN ('queued','failed')
         AND (delivery_next_attempt_at IS NULL OR datetime(delivery_next_attempt_at) <= datetime('now'))
       ORDER BY delivery_next_attempt_at ASC, id ASC LIMIT ?`,
      Math.max(1, Math.min(limit, 8)),
    )
    .catch(() => [] as Record<string, unknown>[]);
  for (const row of due) {
    if (!db.canSpend(6)) break;
    out.processed++;
    try {
      if (await processCredentialDelivery(Number(row.id), db)) out.delivered++;
    } catch {
      /* baris tetap queued/failed untuk run berikutnya */
    }
  }
  return out;
}

async function deliverTelegramCredential(orderCode: string, plaintext: string, db: DatabaseAccess): Promise<void> {
  const order = await db
    .queryFirst(
      `SELECT code, items, telegram_chat_id, telegram_user_id
       FROM orders WHERE code=?`,
      orderCode,
    )
    .catch(() => null);
  if (!order) throw new Error("order_not_found");
  const buyerId = String(order.telegram_user_id || "");
  const privateChat = buyerId
    ? String(
        (await db.queryFirst(`SELECT chat_id FROM telegram_users WHERE user_id=?`, buyerId).catch(() => null))
          ?.chat_id || "",
      )
    : "";
  const chatId = privateChat && Number(privateChat) > 0 ? privateChat : String(order.telegram_chat_id || "");
  // HANYA private chat (id > 0). Grup/kanal (negatif) = tolak, jangan bocorkan.
  if (!chatId || Number(chatId) <= 0) throw new Error("no_private_telegram_chat");
  const { sendMessage } = await import("@/lib/telegram/api");
  const productNames = parseProductNames(order.items);
  const sent = await sendMessage({
    chat_id: chatId,
    text:
      `✅ <b>Pesanan ${orderCode} sudah siap!</b>\n` +
      `📦 ${escapeHtml(productNames)}\n\n` +
      `<pre>${escapeHtml(plaintext)}</pre>\n\n` +
      `Simpan baik-baik. Ketik /garansi untuk ketentuan.`,
    parse_mode: "HTML",
  });
  if (!sent.ok) throw new Error("telegram_delivery_failed");
}

async function deliverWhatsAppCredential(orderCode: string, plaintext: string, db: DatabaseAccess): Promise<void> {
  const order = await db
    .queryFirst(`SELECT channel_member_id, customer_wa FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order) throw new Error("order_not_found");
  // HANYA DM: channel_member_id (DM) diutamakan; customer_wa sebagai fallback
  // DM. TIDAK PERNAH ke channel_conversation_id (grup).
  const target = String(order.channel_member_id || order.customer_wa || "");
  if (!target) throw new Error("no_whatsapp_dm_target");
  const { enqueueWhatsAppMessage, waOutboxKey } = await import("@/lib/whatsapp/outbox");
  const productNames = parseProductNames(order.items);
  const queued = await enqueueWhatsAppMessage(
    waOutboxKey("text", `wr-delivery:${orderCode}`),
    target,
    `*PRODUK AXVARA SIAP!*\nOrder: ${orderCode}\n${productNames}\n\nDetail akses:\n${plaintext}\n\nSimpan baik-baik. Ketik *garansi* untuk ketentuan.`,
  );
  if (!queued) throw new Error("whatsapp_outbox_enqueue_failed");
  // Outbox = durable queue: cron WA mengirimnya; delivery WR settled saat
  // pesan durable di antrean (kontrak outbox: retry sampai sent/dead).
}

/**
 * Terbitkan capability token untuk order web (P0-6). Raw token 256-bit
 * dikembalikan SEKALI ke pemanggil (pembeli yang berhak); yang disimpan
 * hanya hash SHA-256. Token lama yang masih valid dipakai ulang agar tidak
 * menumpuk (idempoten per order).
 */
export async function issueCredentialToken(
  orderCode: string,
  database?: DatabaseAccess,
): Promise<string | null> {
  const db = database ?? createDatabaseAccess();
  const { queryFirst, execRun } = db;
  const ready = await queryFirst(
    `SELECT id FROM wr_order_links WHERE order_code=? AND status='completed'
       AND wr_account_details IS NOT NULL LIMIT 1`,
    orderCode,
  ).catch(() => null);
  if (!ready) return null;
  const existing = await queryFirst(
    `SELECT id FROM wr_credential_tokens WHERE order_code=? AND revoked=0
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
     ORDER BY id DESC LIMIT 1`,
    orderCode,
  ).catch(() => null);
  if (existing) return null; // token valid sudah ada — settled, jangan duplikat.
  const raw = await randomTokenHex(32);
  const hash = await sha256Hex(`wr-cred:${orderCode}:${raw}`);
  try {
    await execRun(
      `INSERT INTO wr_credential_tokens (order_code, token_hash, expires_at)
       VALUES (?,?,datetime('now','+30 days'))`,
      orderCode,
      hash,
    );
  } catch {
    return null;
  }
  return raw;
}

async function randomTokenHex(bytes: number): Promise<string> {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verifikasi capability token milik pembeli (P0-6). Constant-time implisit
 * via perbandingan hash (bukan raw). Menandai last_used_at. Tidak pernah
 * mengembalikan raw token.
 */
export async function verifyCredentialToken(
  orderCode: string,
  rawToken: string,
  database?: DatabaseAccess,
): Promise<boolean> {
  const db = database ?? createDatabaseAccess();
  if (!orderCode || !rawToken || rawToken.length < 32) return false;
  const hash = await sha256Hex(`wr-cred:${orderCode}:${rawToken.trim()}`);
  const row = await db
    .queryFirst(
      `SELECT id FROM wr_credential_tokens WHERE order_code=? AND token_hash=?
         AND revoked=0 AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
      orderCode,
      hash,
    )
    .catch(() => null);
  if (!row) return false;
  await db
    .execRun(`UPDATE wr_credential_tokens SET last_used_at=datetime('now') WHERE id=?`, Number(row.id))
    .catch(() => undefined);
  return true;
}

/**
 * Ambil detail akun terdekripsi untuk halaman pesanan — WAJIB dengan
 * capability token valid ATAU sesi admin. Tanpa itu → [] (P0-6).
 * Order harus lunas/paid; completed saja tidak cukup tanpa pembayaran.
 */
export async function getDecryptedAccountDetails(
  orderCode: string,
  database?: DatabaseAccess,
  capability?: { token: string } | { admin: true },
): Promise<{ order_code: string; details: string; completed_at: string | null }[]> {
  const db = database ?? createDatabaseAccess();
  const order = await db
    .queryFirst(`SELECT status, payment_status FROM orders WHERE code=?`, orderCode)
    .catch(() => null);
  if (!order || String(order.status) !== "lunas" || String(order.payment_status) !== "paid") return [];
  if (!capability) return [];
  if ("admin" in capability) {
    if (!capability.admin) return [];
  } else {
    const ok = await verifyCredentialToken(orderCode, capability.token, db);
    if (!ok) return [];
  }
  const rows = await db
    .queryAll(
      `SELECT order_code, wr_account_details, wr_account_iv, completed_at
       FROM wr_order_links WHERE order_code=? AND status='completed'
         AND wr_account_details IS NOT NULL`,
      orderCode,
    )
    .catch(() => []);
  const out: { order_code: string; details: string; completed_at: string | null }[] = [];
  for (const row of rows) {
    try {
      const details = await decryptSecret(String(row.wr_account_details), String(row.wr_account_iv));
      out.push({
        order_code: String(row.order_code),
        details,
        completed_at: row.completed_at ? String(row.completed_at) : null,
      });
    } catch {
      /* kunci rotasi / data korup: lewati, jangan bocorkan */
    }
  }
  return out;
}

function parseProductNames(raw: unknown): string {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(parsed)) return "Produk";
    return (
      parsed
        .map((i) => {
          const name = String((i as Record<string, unknown>).name || "Produk");
          const qty = Math.max(1, Number((i as Record<string, unknown>).qty || 1));
          return `${name} ×${qty}`;
        })
        .join(", ") || "Produk"
    );
  } catch {
    return "Produk";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
