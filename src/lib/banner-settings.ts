import { execRun, queryFirst } from "@/lib/db";
import { bannerSettingsSchema, DEFAULT_BANNER_SETTINGS, type BannerSettings } from "./banner-config";

export async function readBannerSettings(): Promise<BannerSettings> {
  const row = await queryFirst("SELECT value FROM store_settings WHERE key=?", "banner_carousel");
  try { return bannerSettingsSchema.parse(JSON.parse(String(row?.value))); }
  catch { return { ...DEFAULT_BANNER_SETTINGS }; }
}
export async function saveBannerSettings(settings: BannerSettings) {
  await execRun("INSERT INTO store_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')", "banner_carousel", JSON.stringify(settings));
}
