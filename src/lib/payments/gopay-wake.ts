// src/lib/payments/gopay-wake.ts — bangunkan poller GoPay di VPS (2026-10-10).
//
// Latar (insiden 1102, Workers Free ~10 ms CPU/request): poller dulu memanggil
// `/api/webhook/gopay/pending` tiap ~16 dtk walau tidak ada tagihan (±5.100
// request/hari). Poller kini tidur 60 dtk saat idle; Pages membangunkannya
// lewat `POST <GOPAY_POLLER_WAKE_URL>` (header `x-poller-secret`, secret SAMA
// dengan webhook) ketika:
//   - QR GoPay baru terbit / diterbitkan ulang, dan
//   - pembeli menekan "Cek Status Sekarang" (web) / "Periksa Pembayaran" (TG).
// Poller sendiri menjaga jarak minimum 10 dtk antar poll (anti-ban GoBiz),
// jadi spam klik tidak menambah hit ke GoPay.
//
// Best-effort: gagal/timeout TIDAK pernah menggagalkan request pembeli —
// jadwal idle 60 dtk tetap menjadi jaring pengaman.

import { isGopayQrisConfigured } from "@/lib/payments/dana-qris";

export const DEFAULT_GOPAY_POLLER_WAKE_URL = "https://wr-proxy.axvara.tech/gopay/wake";
const WAKE_TIMEOUT_MS = 1_500;
const ISOLATE_DEDUPE_MS = 3_000;
let lastWakeAt = 0;

/** Reset penanda dedupe per isolate (khusus test). */
export function resetGopayWakeForTest(): void {
  lastWakeAt = 0;
}

async function sendWake(reason: string): Promise<boolean> {
  const url = (process.env.GOPAY_POLLER_WAKE_URL || DEFAULT_GOPAY_POLLER_WAKE_URL).trim();
  const secret = (process.env.GOPAY_POLLER_SECRET || "").trim();
  if (!url || !secret) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-poller-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Jadwalkan wake tanpa menahan respons: pakai `waitUntil` Cloudflare bila
 * ada; di luar Pages (test/dev Node) menunggu langsung dengan timeout 1,5 dtk.
 * Mengembalikan false bila dilewati (GoPay mati / dedupe isolate).
 */
export async function scheduleGopayWake(reason: string): Promise<boolean> {
  if (!isGopayQrisConfigured()) return false;
  const now = Date.now();
  if (now - lastWakeAt < ISOLATE_DEDUPE_MS) return false;
  lastWakeAt = now;
  const task = sendWake(reason);
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    getRequestContext().ctx.waitUntil(task);
    return true;
  } catch {
    await task;
    return true;
  }
}
