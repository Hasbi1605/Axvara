// src/lib/telegram/restock-alerts.ts — Per-product restock opt-in (Item 13).
//
// Buyer taps "🔔 Kabari saat restok" (callback `rst:<pid>`) on an out-of-stock
// variant. We store one pending subscription per (user, product) and the
// existing `cron/lite?job=notify_b` pass sends "✅ tersedia lagi" once the
// product (or its group winner) is purchasable again. No new cron/trigger.

import { createDatabaseAccess, type DatabaseAccess } from "@/lib/db-access";
import { purchasableStockSql } from "@/lib/catalog-availability";
import { notLoserProductSql } from "@/lib/supplier-pairs";
import { escapeHtml } from "@/lib/telegram/messages/format";

type Row = Record<string, unknown>;

/** Workers Paid path: cron sends up to 50 alerts per tick (well under 30 msg/s). */
export const RESTOCK_ALERTS_PER_TICK = 50;
export const RESTOCK_ALERTS_MAX_PER_USER = 20;

export type RestockSubscribeResult = { ok: boolean; status: "subscribed" | "already_subscribed" | "limit_reached" | "in_stock" | "unavailable" };

/** Is the product currently purchasable from a Telegram buyer's view? */
async function productPurchasable(db: DatabaseAccess, productId: number): Promise<{ exists: boolean; telegramEnabled: boolean; purchasable: boolean }> {
  const row = await db.queryFirst(
    `SELECT p.id, p.is_active, p.telegram_enabled,
            EXISTS(SELECT 1 FROM product_variants pv WHERE pv.product_id=p.id AND pv.is_active=1 AND ${purchasableStockSql("pv")}) AS purchasable
       FROM products p LEFT JOIN product_variants pv0 ON pv0.product_id=p.id
      WHERE p.id=? AND ${notLoserProductSql("p")} LIMIT 1`,
    productId,
  ).catch(() => null);
  if (!row) return { exists: false, telegramEnabled: false, purchasable: false };
  return {
    exists: true,
    telegramEnabled: Number(row.telegram_enabled) === 1 && Number(row.is_active) === 1,
    purchasable: Number(row.purchasable) === 1,
  };
}

/**
 * Subscribe the buyer to a restock alert. Idempotent (UNIQUE user+product);
 * capped at RESTOCK_ALERTS_MAX_PER_USER active rows. Never throws — callers
 * (callback router) treat any failure as "unavailable".
 */
export async function subscribeRestockAlert(
  userId: string,
  productId: number,
  database: DatabaseAccess = createDatabaseAccess(),
): Promise<RestockSubscribeResult> {
  const uid = String(userId ?? "").trim();
  if (!/^[1-9]\d*$/.test(uid) || !Number.isSafeInteger(productId) || productId <= 0) {
    return { ok: false, status: "unavailable" };
  }
  try {
    const state = await productPurchasable(database, productId);
    if (!state.exists || !state.telegramEnabled) return { ok: false, status: "unavailable" };
    if (state.purchasable) return { ok: false, status: "in_stock" };

    const existing = await database.queryFirst(
      `SELECT status FROM telegram_restock_alerts WHERE user_id=? AND product_id=?`,
      uid, productId,
    );
    if (existing && String(existing.status) === "pending") return { ok: true, status: "already_subscribed" };

    // Re-subscribe after a previous 'sent'/'cancelled' row is allowed; it just
    // flips back to pending (same UNIQUE key, no duplicate row).
    if (existing) {
      await database.execRun(
        `UPDATE telegram_restock_alerts SET status='pending', notified_at=NULL, created_at=datetime('now') WHERE user_id=? AND product_id=?`,
        uid, productId,
      );
      return { ok: true, status: "subscribed" };
    }

    const active = await database.queryFirst(
      `SELECT COUNT(*) AS n FROM telegram_restock_alerts WHERE user_id=? AND status='pending'`,
      uid,
    );
    if (Number(active?.n ?? 0) >= RESTOCK_ALERTS_MAX_PER_USER) return { ok: false, status: "limit_reached" };

    await database.execRun(
      `INSERT INTO telegram_restock_alerts (user_id, product_id, status) VALUES (?, ?, 'pending')
       ON CONFLICT(user_id, product_id) DO UPDATE SET status='pending', notified_at=NULL`,
      uid, productId,
    );
    return { ok: true, status: "subscribed" };
  } catch {
    return { ok: false, status: "unavailable" };
  }
}

function restockMessage(name: string, locale: "id" | "en"): string {
  const safe = escapeHtml(String(name).slice(0, 120));
  return locale === "en"
    ? `<b>✅ Back in stock</b>\n\n${safe} is available again.\n\nGrab it before it sells out.`
    : `<b>✅ Stok tersedia lagi</b>\n\n${safe} sudah tersedia kembali.\n\nAmbil sebelum habis.`;
}

/**
 * Cron pass (notify_b): find due pending alerts whose product is purchasable,
 * atomically claim each row, send the message, then settle. Telegram 403 means
 * the buyer blocked the bot → mark cancelled; 429 retry_after stops the batch.
 */
export async function processDueRestockAlerts(
  database: DatabaseAccess = createDatabaseAccess(),
  limit = RESTOCK_ALERTS_PER_TICK,
): Promise<{ sent: number; cancelled: number; deferred: number }> {
  const out = { sent: 0, cancelled: 0, deferred: 0 };
  if (process.env.TELEGRAM_BOT_ENABLED !== "true") return out;
  if (!database.canSpend(2)) return out;

  // Only pending rows whose product (or its group winner) is purchasable now.
  const due = await database.queryAll(
    `SELECT a.id, a.user_id, a.product_id, tu.is_blocked, tu.locale
       FROM telegram_restock_alerts a
       JOIN products p ON p.id=a.product_id
       LEFT JOIN telegram_users tu ON tu.user_id=a.user_id
      WHERE a.status='pending' AND p.is_active=1 AND p.telegram_enabled=1 AND ${notLoserProductSql("p")}
        AND EXISTS(SELECT 1 FROM product_variants pv WHERE pv.product_id=p.id AND pv.is_active=1 AND ${purchasableStockSql("pv")})
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT ?`,
    Math.max(1, Math.min(RESTOCK_ALERTS_PER_TICK, Math.floor(Number(limit) || 0))),
  ).catch(() => [] as Row[]);
  if (!due.length) return out;

  const { sendMessage } = await import("@/lib/telegram/api");
  const { cb } = await import("@/lib/telegram/keyboards");
  const productNames = await database.queryAll(
    `SELECT id, name FROM products WHERE id IN (${due.map(() => "?").join(",")})`,
    ...due.map((row) => Number(row.product_id)),
  ).catch(() => [] as Row[]);
  const nameById = new Map(productNames.map((row) => [Number(row.id), String(row.name)]));

  let processed = 0;
  for (const row of due) {
    if (!database.canSpend(3)) break;
    processed++;
    const id = Number(row.id);
    const userId = String(row.user_id);
    const productId = Number(row.product_id);
    if (Number(row.is_blocked) === 1) {
      await database.execRun(`UPDATE telegram_restock_alerts SET status='cancelled' WHERE id=? AND status='pending'`, id).catch(() => {});
      out.cancelled++;
      continue;
    }
    // Atomic claim before transport so a crashed/duplicate tick never sends twice.
    const claim = await database.execRun(
      `UPDATE telegram_restock_alerts SET status='sent', notified_at=datetime('now')
        WHERE id=? AND status='pending'`,
      id,
    ).catch(() => ({ changes: 0 }));
    if (!claim.changes) continue;
    const locale = String(row.locale ?? "") === "en" ? "en" : "id";
    const res = await sendMessage({
      chat_id: userId,
      text: restockMessage(nameById.get(productId) ?? "Produk", locale),
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: locale === "en" ? "🛒 View Product" : "🛒 Lihat Produk", callback_data: cb.product(productId) }]] },
    }).catch(() => ({ ok: false, error_code: 0 } as { ok: boolean; error_code?: number }));
    if (res.ok) {
      out.sent++;
      continue;
    }
    // Definite Telegram rejection: cancel on a blocked bot (403); otherwise
    // roll the claim back so a later tick can retry (429 already stops here).
    if (res.error_code === 403) {
      await database.execRun(`UPDATE telegram_restock_alerts SET status='cancelled' WHERE id=?`, id).catch(() => {});
      out.cancelled++;
      continue;
    }
    await database.execRun(`UPDATE telegram_restock_alerts SET status='pending', notified_at=NULL WHERE id=? AND status='sent'`, id).catch(() => {});
    out.deferred++;
    if (res.error_code === 429) break;
  }
  out.deferred += due.length - processed;
  return out;
}
