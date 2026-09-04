// POST /api/admin/telegram/setup — Set/update Telegram webhook
// Admin-authenticated. Does NOT expose bot token.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { setWebhook, getWebhookInfo, deleteWebhook, setMyCommands } from "@/lib/telegram/api";

export const runtime = "edge";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json() as { action?: string };
  const siteUrl = process.env.SITE_URL ?? "https://axvara.tech";
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken || !webhookSecret) {
    return NextResponse.json({ error: "bot_not_configured" }, { status: 503 });
  }

  const webhookUrl = `${siteUrl}/api/telegram/webhook`;

  if (body.action === "delete") {
    const result = await deleteWebhook();
    return NextResponse.json({ ok: result.ok, description: result.description });
  }

  // Default: set webhook + register commands
  const result = await setWebhook(webhookUrl, webhookSecret);
  await setMyCommands(); // Register /start, /katalog, /pesanan, /bantuan in menu
  return NextResponse.json({
    ok: result.ok,
    description: result.description,
    webhook_url: webhookUrl,
  });
}

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({
      configured: false,
      webhook: null,
    });
  }

  const info = await getWebhookInfo();
  return NextResponse.json({
    configured: true,
    webhook: info.ok ? {
      url: info.result?.url ?? "",
      pending_update_count: info.result?.pending_update_count ?? 0,
      last_error_message: info.result?.last_error_message ?? null,
      last_error_date: info.result?.last_error_date
        ? new Date(info.result.last_error_date * 1000).toISOString()
        : null,
    } : null,
    klikqris_mode: process.env.KLIKQRIS_MODE ?? "sandbox",
    klikqris_configured: !!process.env.KLIKQRIS_API_KEY,
    bot_enabled: process.env.TELEGRAM_BOT_ENABLED === "true",
    payment_enabled: process.env.KLIKQRIS_PAYMENTS_ENABLED === "true",
    fulfillment_enabled: process.env.AUTO_FULFILLMENT_ENABLED === "true",
  });
}
