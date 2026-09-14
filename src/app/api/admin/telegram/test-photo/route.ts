// GET /api/admin/telegram/test-photo — DEBUG SEMENTARA: panggil sendPhoto
// persis seperti handler /start dan kembalikan respons mentah Telegram.
// HAPUS file ini setelah diagnosis selesai.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendPhoto } from "@/lib/telegram/api";
import { welcomeMessage } from "@/lib/telegram/messages";
import { homeKeyboard } from "@/lib/telegram/keyboards";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const siteUrl = process.env.SITE_URL ?? "https://axvara.tech";
  const chatId = Number(request.nextUrl.searchParams.get("chat_id") || "-1003976957896");
  const caption = welcomeMessage("Axvara", [
    { productId: 1, name: "Canva Pro / Premium", price: 2000, soldCount: 32 },
  ]);
  const photoUrl = `${siteUrl}/banners/tg-welcome.webp`;
  const started = Date.now();
  const res = await sendPhoto({
    chat_id: chatId,
    photo: photoUrl,
    caption,
    parse_mode: "HTML",
    reply_markup: homeKeyboard(),
  });
  return NextResponse.json({
    ok: res.ok,
    description: res.description ?? null,
    elapsed_ms: Date.now() - started,
    photo_url: photoUrl,
    caption_chars: caption.length,
    site_url_env: process.env.SITE_URL ?? "(fallback)",
  });
}
