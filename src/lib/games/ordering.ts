// src/lib/games/ordering.ts — gerbang pemesanan AXVARA Games (keputusan P9).
// Selama Digiflazz belum siap untuk transaksi nyata (mode testing ATAU
// kredensial kosong), katalog tetap terbaca tetapi quote/order baru ditutup
// dengan 503 `games_preview`. Satu helper agar semua route memakai aturan sama.
import type { Locale } from "@/lib/i18n/locale";

export function gamesOrderingOpen(env: Record<string, string | undefined> = process.env): boolean {
  if (String(env.DIGIFLAZZ_TESTING ?? "").trim() === "true") return false;
  const username = String(env.DIGIFLAZZ_USERNAME ?? "").trim();
  const key = String(env.DIGIFLAZZ_API_KEY ?? "").trim();
  return Boolean(username && key);
}

export function gamesPreviewMessage(locale: Locale): string {
  return locale === "en"
    ? "AXVARA Games ordering is opening soon."
    : "Pemesanan AXVARA Games segera dibuka.";
}

export function gamesPreviewResponse(locale: Locale): { error_code: "games_preview"; error: string } {
  return { error_code: "games_preview", error: gamesPreviewMessage(locale) };
}
