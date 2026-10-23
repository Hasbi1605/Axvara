import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { bannerSettingsSchema } from "@/lib/banner-config";
import { readBannerSettings, saveBannerSettings } from "@/lib/banner-settings";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function PUT(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bannerSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Periksa jeda buka 0–10 detik, perpindahan 4–20 detik, dan frekuensi 1–10." }, { status: 400 });
  await saveBannerSettings(parsed.data);
  return NextResponse.json({ ok: true, settings: await readBannerSettings() }, { headers: { "Cache-Control": "private, no-store" } });
}
