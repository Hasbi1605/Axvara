// src/lib/site-url.ts — Origin absolut situs untuk link di pesan Telegram/email.
//
// SITE_URL di worker Pages bisa berupa string kosong (ARCHITECTURE §16.4), jadi
// `process.env.SITE_URL ?? fallback` tidak menolong: hasilnya URL relatif dan
// Telegram menolak SELURUH pesan bila ada tombol ber-URL tanpa host. Nilai tanpa
// skema (mis. "axvara.tech") juga ditolak, jadi ikut jatuh ke fallback.
import { SITE } from "@/lib/site";

export function siteOrigin(): string {
  const raw = String(process.env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+/i.test(raw) ? raw : SITE.webUrl.replace(/\/+$/, "");
}
