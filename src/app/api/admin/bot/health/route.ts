// GET /api/admin/bot/health — Bot health check (no secrets)
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getWebhookInfo } from "@/lib/telegram/api";
import { queryAll } from "@/lib/db";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const health: Record<string, unknown> = {
    bot_configured: !!process.env.TELEGRAM_BOT_TOKEN,
    bot_enabled: process.env.TELEGRAM_BOT_ENABLED === "true",
    dana_qris_mode: "dynamic-qris",
    dana_qris_configured: process.env.DANA_QRIS_ENABLED === "true"
      && Boolean(process.env.DANA_STATIC_QRIS)
      && Boolean(process.env.DANA_WEBHOOK_SECRET),
    payment_enabled: process.env.DANA_QRIS_ENABLED === "true",
    fulfillment_enabled: process.env.AUTO_FULFILLMENT_ENABLED === "true",
    encryption_key_set: !!process.env.FULFILLMENT_ENCRYPTION_KEY,
    whatsapp_configured: !!process.env.WHATSAPP_GATEWAY_URL,
    whatsapp_enabled: process.env.WHATSAPP_ENABLED === "true",
    whatsapp_discovery: process.env.WHATSAPP_GROUP_DISCOVERY === "true",
    whatsapp_payment: process.env.WHATSAPP_GROUP_PAYMENT === "true",
    whatsapp_proof_intake: process.env.WHATSAPP_PROOF_INTAKE === "true",
    warung_rebahan_enabled: process.env.WARUNG_REBAHAN_ENABLED === "true",
    warung_rebahan_configured: process.env.WARUNG_REBAHAN_ENABLED === "true"
      && Boolean(process.env.WARUNG_REBAHAN_API_KEY?.trim()),
    warung_rebahan_sync: process.env.WARUNG_REBAHAN_SYNC_ENABLED !== "false",
    warung_rebahan_auto_order: process.env.WARUNG_REBAHAN_AUTO_ORDER_ENABLED === "true",
    warung_rebahan_sandbox: process.env.WARUNG_REBAHAN_SANDBOX === "true",
  };

  // Webhook info (if configured)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const info = await getWebhookInfo();
      if (info.ok && info.result) {
        health.webhook = {
          url: info.result.url || "(not set)",
          pending_updates: info.result.pending_update_count,
          last_error: info.result.last_error_message ?? null,
        };
      }
    } catch { health.webhook = { error: "check_failed" }; }
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

    // Antrean WR (no-op aman bila tabel belum ada — migrasi 0027 belum jalan).
    try {
      const wrQueue = await queryAll(
        `SELECT status, COUNT(*) as count FROM wr_order_links GROUP BY status`,
      );
      health.warung_rebahan_queue = wrQueue;
      const { queryFirst } = await import("@/lib/db");
      const wrSync = await queryFirst(
        `SELECT status, products_synced, variants_synced, created_at
         FROM wr_sync_log WHERE sync_type='products' ORDER BY id DESC LIMIT 1`,
      );
      health.warung_rebahan_last_sync = wrSync ?? null;
    } catch { /* tabel WR belum ada */ }

    // Event QRIS 7 hari terakhir: tak-cocok vs gagal — sinyal degraded.
    try {
      const { queryFirst } = await import("@/lib/db");
      const qrisEvents = await queryFirst(
        `SELECT COUNT(*) AS unmatched, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
                MAX(CASE WHEN status='matched' THEN processed_at ELSE NULL END) AS last_match
         FROM dana_webhook_events
         WHERE status IN ('received','ignored','failed') AND datetime(created_at)>=datetime('now','-7 days')`,
      );
      health.qris_events_7d = qrisEvents ?? null;
    } catch { /* tabel lama tetap kompatibel */ }
  } catch { /* ok if tables don't exist yet */ }

  return NextResponse.json(health);
}
