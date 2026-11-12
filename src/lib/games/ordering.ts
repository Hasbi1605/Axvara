// src/lib/games/ordering.ts — gerbang pemesanan AXVARA Games.
// Pembelian nyata hanya dibuka bila owner opt-in eksplisit `GAMES_SK_ENABLED=true`,
// SK aktif + transport/kredensial tersedia, dan TIDAK memakai sandbox. Kredensial
// Digiflazz tidak lagi menjadi gerbang order baru (legacy tetap bisa dipulihkan
// oleh worker). Katalog tetap terbaca saat gerbang tertutup.
import type { Locale } from "@/lib/i18n/locale";

export function gamesOrderingOpen(env: Record<string, string | undefined> = process.env): boolean {
  if (String(env.GAMES_SK_ENABLED ?? "").trim() !== "true") return false;
  if (String(env.SEKALIPAY_ENABLED ?? "").trim() !== "true") return false;
  if (String(env.SEKALIPAY_SANDBOX ?? "").trim() === "true") return false;
  if (String(env.SEKALIPAY_PROXY_URL ?? "").trim() !== "") {
    return Boolean(String(env.SEKALIPAY_PROXY_TOKEN ?? "").trim());
  }
  return Boolean(String(env.SEKALIPAY_API_KEY ?? "").trim());
}

export function gamesPreviewMessage(locale: Locale): string {
  return locale === "en"
    ? "AXVARA Games ordering is opening soon."
    : "Pemesanan AXVARA Games segera dibuka.";
}

export function gamesPreviewResponse(locale: Locale): { error_code: "games_preview"; error: string } {
  return { error_code: "games_preview", error: gamesPreviewMessage(locale) };
}
