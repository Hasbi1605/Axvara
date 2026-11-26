import { isActiveQrisConfigured, activeQrisProvider } from "@/lib/payments/qris";
// GET /api/admin/bot/health — Bot health check (no secrets)
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getWebhookInfo } from "@/lib/telegram/api";
import { TG_WEBHOOK_GUARD_STATE_KEY, parseWebhookGuardState } from "@/lib/telegram/webhook-guard";
import { TELEGRAM_CHANNEL_CONFIG_KEY, parseTelegramChannelConfig } from "@/lib/telegram/force-sub";
import { TELEGRAM_PROMO_SETTINGS_KEY } from "@/lib/telegram/promo-broadcast";
import { queryAll, queryFirst } from "@/lib/db";
import { QRIS_HEALTH_EVENTS_SQL } from "@/lib/service-health";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const health: Record<string, unknown> = {
    bot_configured: !!process.env.TELEGRAM_BOT_TOKEN,
    bot_enabled: process.env.TELEGRAM_BOT_ENABLED === "true",
    payment_enabled: isActiveQrisConfigured(),
    payment_provider: activeQrisProvider(),
    fulfillment_enabled: process.env.AUTO_FULFILLMENT_ENABLED === "true",
    encryption_key_set: !!process.env.FULFILLMENT_ENCRYPTION_KEY,
    whatsapp_configured: !!process.env.WHATSAPP_GATEWAY_URL,
    whatsapp_enabled: process.env.WHATSAPP_ENABLED === "true",
    // Alur pembeli WhatsApp dipensiunkan 13 November 2026 (hard off di kode,
    // bukan lewat env). Nilai selalu false agar admin menampilkannya mati.
    whatsapp_discovery: false,
    whatsapp_payment: false,
    whatsapp_proof_intake: false,
    whatsapp_buyer_flows: "retired",
    warung_rebahan_enabled: process.env.WARUNG_REBAHAN_ENABLED === "true",
    // Proxy mode (Opsi A): API key WR dipegang proxy Heroku — Pages cukup
    // proxy URL + proxy token + webhook secret. API key boleh kosong.
    warung_rebahan_configured: process.env.WARUNG_REBAHAN_ENABLED === "true"
      && Boolean(process.env.WARUNG_REBAHAN_PROXY_URL?.trim() || process.env.WARUNG_REBAHAN_API_KEY?.trim())
      && Boolean(process.env.WARUNG_REBAHAN_PROXY_URL?.trim() ? process.env.WARUNG_REBAHAN_PROXY_TOKEN?.trim() : true)
      && Boolean(process.env.WARUNG_REBAHAN_WEBHOOK_SECRET?.trim() || process.env.WARUNG_REBAHAN_API_KEY?.trim()),
    warung_rebahan_proxy_mode: Boolean(process.env.WARUNG_REBAHAN_PROXY_URL?.trim()),
    warung_rebahan_sync: process.env.WARUNG_REBAHAN_SYNC_ENABLED !== "false",
    warung_rebahan_auto_order: process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true",
    warung_rebahan_sandbox: process.env.WARUNG_REBAHAN_SANDBOX === "true",
  };

  // Webhook info (if configured)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    let lastAutoKickAt: string | null = null;
    try {
      const guardRow = await queryFirst(
        `SELECT value FROM store_settings WHERE key=?`,
        TG_WEBHOOK_GUARD_STATE_KEY,
      );
      const guardState = parseWebhookGuardState(guardRow?.value);
      if (guardState.last_kick_at && Number.isFinite(guardState.last_kick_at)) {
        lastAutoKickAt = new Date(guardState.last_kick_at).toISOString();
      }
    } catch { /* store_settings opsional */ }

    try {
      const info = await getWebhookInfo();
      if (info.ok && info.result) {
        health.webhook = {
          url: info.result.url || "(not set)",
          pending_updates: info.result.pending_update_count,
          pending_update_count: info.result.pending_update_count ?? 0,
          last_error: info.result.last_error_message ?? null,
          last_error_message: info.result.last_error_message ?? null,
          last_error_date: info.result.last_error_date
            ? new Date(info.result.last_error_date * 1000).toISOString()
            : null,
          last_auto_kick_at: lastAutoKickAt,
        };
      } else {
        health.webhook = { error: "check_failed", last_auto_kick_at: lastAutoKickAt };
      }
    } catch {
      health.webhook = { error: "check_failed", last_auto_kick_at: lastAutoKickAt };
    }
  }

  // Stats
  try {
    const telegramOrders = await queryAll(
      `SELECT status, COUNT(*) as count FROM orders WHERE sales_channel='telegram' GROUP BY status`,
    );
    health.telegram_orders = telegramOrders;

    const whatsappOrders = await queryAll(
      `SELECT payment_status, COUNT(*) as count FROM orders WHERE sales_channel='whatsapp' GROUP BY payment_status`,
    );
    health.whatsapp_orders = whatsappOrders;

    const pendingJobs = await queryAll(
      `SELECT status, COUNT(*) as count FROM fulfillment_jobs GROUP BY status`,
    );
    health.fulfillment_jobs = pendingJobs;

    // Usia antrean tertua per status (issue #13): kegagalan/usia antrean
    // adalah sinyal, bukan sekadar jumlah.
    try {
      const oldestJobs = await queryAll(
        `SELECT status, MIN(next_attempt_at) AS oldest_due, MAX(attempt_count) AS max_attempts
         FROM fulfillment_jobs WHERE status IN ('queued','retry','failed','manual_required','sending')
         GROUP BY status`,
      );
      health.fulfillment_queue_age = oldestJobs;
    } catch { /* kolom lama tetap kompatibel */ }

    const waOutbox = await queryAll(
      `SELECT status, COUNT(*) as count FROM whatsapp_outbox GROUP BY status`,
    );
    health.whatsapp_outbox = waOutbox;
    try {
      const oldestOutbox = await queryAll(
        `SELECT status, MIN(next_attempt_at) AS oldest_due, MAX(attempt_count) AS max_attempts
         FROM whatsapp_outbox WHERE status IN ('pending','failed','dead')
         GROUP BY status`,
      );
      health.whatsapp_outbox_age = oldestOutbox;
    } catch { /* tabel lama tetap kompatibel */ }

    // "Perlu tindakan" fulfillment (keputusan owner 13 November 2026): daftar
    // order yang macet atau butuh admin, plus jumlah pesan WhatsApp gagal 7
    // hari. Read-only — tidak menyentuh job/order/outbox.
    try {
      const { parsePaymentDisplaySnapshot } = await import("@/lib/commerce");
      const rows = await queryAll(
        `SELECT o.code, o.fulfillment_status, o.updated_at, o.variant_snapshot, o.items
         FROM orders o
         WHERE o.status='lunas' AND o.payment_status='paid'
           AND (
             o.fulfillment_status IN ('manual_required','failed')
             OR (o.fulfillment_status IN ('queued','retry') AND datetime(o.updated_at) <= datetime('now','-15 minutes'))
           )
         ORDER BY datetime(o.updated_at) ASC
         LIMIT 20`,
      );
      health.fulfillment_action = {
        orders: rows.map((row) => {
          const snapshot = parsePaymentDisplaySnapshot(row.variant_snapshot);
          let product = snapshot ? `${snapshot.productName || "Produk"} — ${snapshot.variantLabel}` : "";
          if (!product) {
            try {
              const items = JSON.parse(String(row.items || "[]")) as { name?: unknown }[];
              const name = String(items?.[0]?.name || "").trim();
              if (name) product = name;
            } catch { /* items lama/rusak: biarkan kosong */ }
          }
          return {
            code: String(row.code),
            product: product || "Produk tidak terbaca",
            status: String(row.fulfillment_status),
            updated_at: row.updated_at ? String(row.updated_at) : null,
          };
        }),
        total: rows.length,
        whatsapp_outbox_failed_7d: Number((await queryFirst(
          `SELECT COUNT(*) AS count FROM whatsapp_outbox
           WHERE status IN ('failed','dead') AND datetime(updated_at) >= datetime('now','-7 days')`,
        ))?.count || 0),
      };
    } catch { /* tabel lama tetap kompatibel */ }

    // Antrean WR (no-op aman bila tabel belum ada — migrasi 0027 belum jalan).
    try {
      const wrQueue = await queryAll(
        `SELECT status, COUNT(*) as count FROM wr_order_links GROUP BY status`,
      );
      health.warung_rebahan_queue = wrQueue;
      const wrSync = await queryFirst(
        `SELECT status, products_synced, variants_synced, created_at
         FROM wr_sync_log WHERE sync_type='products' ORDER BY id DESC LIMIT 1`,
      );
      health.warung_rebahan_last_sync = wrSync ?? null;
    } catch { /* tabel WR belum ada */ }

    // Event QRIS 7 hari terakhir: tak-cocok vs gagal — sinyal degraded.
    try {
      const qrisEvents = await queryFirst(QRIS_HEALTH_EVENTS_SQL);
      health.qris_events_7d = qrisEvents ? { ...qrisEvents, unmatched: Number(qrisEvents.unmatched || 0) } : null;
    } catch { /* tabel lama tetap kompatibel */ }

    // Pengaturan Channel Resmi Telegram (@axvaratech), Smart Force-Join & promo DM/channel.
    try {
      const channelRow = await queryFirst(
        `SELECT
           (SELECT value FROM store_settings WHERE key=?) AS channel_config,
           (SELECT value FROM store_settings WHERE key=?) AS dm_promo`,
        TELEGRAM_CHANNEL_CONFIG_KEY,
        TELEGRAM_PROMO_SETTINGS_KEY,
      );
      const cfg = parseTelegramChannelConfig(channelRow?.channel_config);
      health.telegram_channel = {
        ...cfg,
        dmPromoEnabled: String(channelRow?.dm_promo ?? "").trim().toLowerCase() !== "false",
      };
    } catch { /* store_settings opsional */ }
  } catch { /* ok if tables don't exist yet */ }

  return NextResponse.json(health);
}
