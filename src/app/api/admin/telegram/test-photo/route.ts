// GET /api/admin/telegram/test-photo — DEBUG SEMENTARA: panggil sendPhoto
// persis seperti handler /start ke PRIVATE @Axvara_bot (bukan grup) dan
// kembalikan respons mentah Telegram. HAPUS file ini setelah diagnosis.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendPhoto } from "@/lib/telegram/api";
import { welcomeMessage } from "@/lib/telegram/messages";
import { homeKeyboard } from "@/lib/telegram/keyboards";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const PRIVATE_CHAT_ID = 8264427120; // user Axvara (@Axvara_support), BUKAN grup

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const siteUrl = process.env.SITE_URL ?? "https://axvara.tech";
  const caption = welcomeMessage("Axvara", [
    { productId: 1, name: "Canva Pro / Premium", price: 2000, soldCount: 32 },
  ]);
  const photoUrl = `${siteUrl}/banners/tg-welcome.webp`;
  const started = Date.now();
  const res = await sendPhoto({
    chat_id: PRIVATE_CHAT_ID,
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
    target: "private @Axvara_bot",
  });
}
