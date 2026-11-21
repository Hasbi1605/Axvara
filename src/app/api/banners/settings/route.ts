import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { readJsonBody } from "@/lib/http-body";
import { bannerSettingsSchema } from "@/lib/banner-config";
import { readBannerSettings, saveBannerSettings } from "@/lib/banner-settings";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export async function PUT(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const bounded = await readJsonBody(req, 8_000);
  if (!bounded.ok && bounded.response.status === 413) return bounded.response;
  const parsed = bannerSettingsSchema.safeParse(bounded.ok ? bounded.data : null);
  if (!parsed.success) return NextResponse.json({ error: "Periksa jeda buka 0–10 detik, perpindahan 4–20 detik, dan frekuensi 1–10." }, { status: 400 });
  await saveBannerSettings(parsed.data);
  return NextResponse.json({ ok: true, settings: await readBannerSettings() }, { headers: { "Cache-Control": "private, no-store" } });
}
