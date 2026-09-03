// GET /api/admin/bot/health — Bot health check (no secrets)
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getWebhookInfo } from "@/lib/telegram/api";
import { queryFirst, queryAll } from "@/lib/db";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const health: Record<string, unknown> = {
    bot_configured: !!process.env.TELEGRAM_BOT_TOKEN,
    bot_enabled: process.env.TELEGRAM_BOT_ENABLED === "true",
    klikqris_mode: process.env.KLIKQRIS_MODE ?? "sandbox",
    klikqris_configured: !!process.env.KLIKQRIS_API_KEY,
    payment_enabled: process.env.KLIKQRIS_PAYMENTS_ENABLED === "true",
    fulfillment_enabled: process.env.AUTO_FULFILLMENT_ENABLED === "true",
    encryption_key_set: !!process.env.FULFILLMENT_ENCRYPTION_KEY,
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
      `SELECT payment_status, COUNT(*) as count FROM orders WHERE sales_channel='telegram' GROUP BY payment_status`,
    );
    health.telegram_orders = telegramOrders;

    const pendingJobs = await queryAll(
      `SELECT status, COUNT(*) as count FROM fulfillment_jobs GROUP BY status`,
    );
    health.fulfillment_jobs = pendingJobs;
  } catch { /* ok if tables don't exist yet */ }

  return NextResponse.json(health);
}
