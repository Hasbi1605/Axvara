// src/lib/service-health.ts — Status layanan jujur + pantau antrean (issue #13).
//
// Audit 7 Sep 2026: indikator sehat hanya menunjukkan env tersedia
// (`Boolean(TOKEN) && ENABLED`), sehingga gateway mati / sesi Baileys putus /
// antrean menumpuk tetap tampil hijau. Helper ini membedakan empat tingkat:
//
// - configured: env/flag lengkap, belum ada pengukuran.
// - healthy: ada bukti sukses baru-baru ini (marker kirim / webhook tanpa error).
// - degraded: ada bukti masalah (kegagalan kirim, antrean menua, error webhook).
// - unknown: env belum lengkap sehingga tidak bisa dinilai.
//
// Pembaca/evaluator murni atas data DB/env; penulisan sampel cron best-effort.

import type { DatabaseAccess } from "@/lib/db-access";

export type ServiceLevel = "configured" | "healthy" | "degraded" | "unknown";

export const TG_WEBHOOK_HEALTH_KEY = "tg_webhook_health";
export const WA_GATEWAY_HEALTH_KEY = "wa_gateway_health";
export const KLIKQRIS_POLL_HEALTH_KEY = "klikqris_health_poll_failed";

export async function saveServiceHealth(db: DatabaseAccess, key: string, value: string) {
  try {
    await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, key, value);
  } catch {
    // A failed sample write must not change payment/notification handling.
    console.warn("[cron-health] sample_write_failed", key);
  }
}

// GoPay and KlikQRIS already share the event ledger; unrelated IPNs and
// supplier events do not measure the QRIS rails.
export const QRIS_HEALTH_EVENTS_SQL = `SELECT SUM(CASE WHEN status IN ('received','ignored') THEN 1 ELSE 0 END) AS unmatched,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
  MAX(CASE WHEN status='matched' THEN processed_at END) AS last_match
  FROM dana_webhook_events WHERE provider IN ('gopay','klikqris')
    AND created_at >= date('now','-7 days') AND datetime(created_at) >= datetime('now','-7 days')`;

export function readTelegramWebhookHealth(value: unknown): { error: string | null; pending: number | null } {
  try {
    const sample = JSON.parse(String(value)) as { error?: unknown; pending?: unknown } | null;
    return {
      error: typeof sample?.error === "string" ? sample.error : null,
      pending: typeof sample?.pending === "number" && Number.isSafeInteger(sample.pending) && sample.pending >= 0 ? sample.pending : null,
    };
  } catch { return { error: null, pending: null }; }
}

export type ServiceStatus = {
  level: ServiceLevel;
  detail: string;
};

export type QueueSample = {
  pending: number;
  failed: number;
  /** Butuh tindakan manusia (manual_required) — degraded walau belum menua. */
  needsAction?: number;
  oldestPendingAt: string | null;
};

export type QueueThresholds = {
  /** Batas antrean pending sebelum dianggap menumpuk. */
  maxPending: number;
  /** Usia antrean tertua (menit) sebelum dianggap menua. */
  maxAgeMinutes: number;
};

export function summarizeQueue(rows: { status: string; count: number }[], oldestAt: string | null): QueueSample {
  let pending = 0;
  let failed = 0;
  let needsAction = 0;
  for (const row of rows) {
    const status = String(row.status || "");
    const count = Number(row.count || 0);
    // Review R11: manual_required adalah antrean butuh-tindakan (menunggu
    // handover admin) — degraded walau belum menua/menumpuk. Dicatat
    // terpisah agar evaluateQueue dapat menandainya tanpa menunggu
    // threshold usia.
    if (status === "manual_required") { needsAction += count; continue; }
    if (["queued", "retry", "pending", "sending", "processing"].includes(status)) pending += count;
    if (["failed", "dead"].includes(status)) failed += count;
  }
  return { pending, failed, needsAction, oldestPendingAt: oldestAt };
}

export function queueAgeMinutes(oldestAt: string | null, now = Date.now()): number | null {
  if (!oldestAt) return null;
  const parsed = Date.parse(String(oldestAt));
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((now - parsed) / 60_000));
}

export function evaluateQueue(
  sample: QueueSample,
  thresholds: QueueThresholds,
  label: string,
  now = Date.now(),
): ServiceStatus {
  if (sample.failed > 0) {
    return { level: "degraded", detail: `${label}: ${sample.failed} gagal perlu tindakan` };
  }
  if ((sample.needsAction ?? 0) > 0) {
    return { level: "degraded", detail: `${label}: ${sample.needsAction} menunggu serah terima manual` };
  }
  if (sample.pending > thresholds.maxPending) {
    return { level: "degraded", detail: `${label}: ${sample.pending} antre (batas ${thresholds.maxPending})` };
  }
  const age = queueAgeMinutes(sample.oldestPendingAt, now);
  if (age != null && sample.pending > 0 && age > thresholds.maxAgeMinutes) {
    return { level: "degraded", detail: `${label}: antrean tertua ${age} mnt` };
  }
  if (sample.pending > 0) {
    return { level: "configured", detail: `${label}: ${sample.pending} antre diproses` };
  }
  return { level: "healthy", detail: `${label}: antrean kosong` };
}

export type TelegramSignals = {
  configured: boolean;
  enabled: boolean;
  webhookError: string | null;
  webhookPending: number | null;
  lastSendOkAt: string | null;
  lastSendFailAt: string | null;
  queue: QueueSample;
};

export function evaluateTelegram(signals: TelegramSignals, now = Date.now()): ServiceStatus {
  if (!signals.configured || !signals.enabled) return { level: "unknown", detail: "Telegram belum dikonfigurasi/aktif" };
  if (signals.webhookError) return { level: "degraded", detail: `Webhook Telegram error: ${signals.webhookError}` };
  if (signals.webhookPending != null && signals.webhookPending > 50) {
    return { level: "degraded", detail: `Webhook Telegram menumpuk: ${signals.webhookPending} update` };
  }
  const failAge = queueAgeMinutes(signals.lastSendFailAt, now);
  const okAge = queueAgeMinutes(signals.lastSendOkAt, now);
  // Kegagalan kirim terakhir yang lebih baru dari keberhasilan terakhir = masalah aktif.
  if (signals.lastSendFailAt && (signals.lastSendOkAt == null || Date.parse(signals.lastSendFailAt) > Date.parse(signals.lastSendOkAt))) {
    return { level: "degraded", detail: `Kirim Telegram terakhir gagal${failAge != null ? ` ${failAge} mnt lalu` : ""}` };
  }
  if (signals.lastSendOkAt && okAge != null && okAge < 24 * 60) {
    return { level: "healthy", detail: `Telegram terkirim${okAge < 60 ? ` ${okAge} mnt lalu` : ""}` };
  }
  const queueVerdict = evaluateQueue(signals.queue, { maxPending: 25, maxAgeMinutes: 30 }, "Fulfillment Telegram", now);
  if (queueVerdict.level === "degraded") return queueVerdict;
  if (signals.webhookPending != null) return { level: "healthy", detail: `Webhook Telegram aktif: ${signals.webhookPending} update antre` };
  return { level: "configured", detail: "Telegram terkonfigurasi, belum ada pengukuran kirim" };
}

export type WhatsAppSignals = {
  configured: boolean;
  enabled: boolean;
  gatewayReachable: boolean | null;
  gatewayBlocked?: boolean;
  lastSendOkAt: string | null;
  lastSendFailAt: string | null;
  queue: QueueSample;
};

export function evaluateWhatsApp(signals: WhatsAppSignals, now = Date.now()): ServiceStatus {
  if (!signals.configured || !signals.enabled) return { level: "unknown", detail: "WhatsApp belum dikonfigurasi/aktif" };
  if (signals.gatewayBlocked) return { level: "degraded", detail: "Pengiriman gateway Baileys dijeda" };
  if (signals.gatewayReachable === false) return { level: "degraded", detail: "Gateway/sesi Baileys tidak tersambung" };
  if (signals.lastSendFailAt && (signals.lastSendOkAt == null || Date.parse(signals.lastSendFailAt) > Date.parse(signals.lastSendOkAt))) {
    return { level: "degraded", detail: "Kirim WhatsApp terakhir gagal" };
  }
  const queueVerdict = evaluateQueue(signals.queue, { maxPending: 25, maxAgeMinutes: 30 }, "Outbox WhatsApp", now);
  if (queueVerdict.level === "degraded") return queueVerdict;
  if (signals.gatewayReachable === true) return { level: "healthy", detail: "Gateway Baileys terjangkau" };
  return { level: "configured", detail: "WhatsApp terkonfigurasi; kesehatan sesi milik gateway eksternal" };
}

export type QrisSignals = {
  configured: boolean;
  enabled: boolean;
  unmatched7d: number;
  failed7d: number;
  klikQrisPollFailures?: number;
  lastMatchAt: string | null;
};

export function evaluateQris(signals: QrisSignals): ServiceStatus {
  if (!signals.configured || !signals.enabled) return { level: "unknown", detail: "QRIS dinamis belum dikonfigurasi/aktif" };
  if ((signals.klikQrisPollFailures ?? 0) > 0) return { level: "degraded", detail: `KlikQRIS: ${signals.klikQrisPollFailures} cek status gagal` };
  if (signals.failed7d > 0) return { level: "degraded", detail: `QRIS: ${signals.failed7d} event gagal 7 hari` };
  if (signals.unmatched7d > 10) return { level: "degraded", detail: `QRIS: ${signals.unmatched7d} event tak cocok 7 hari` };
  if (signals.lastMatchAt) return { level: "healthy", detail: "QRIS mencocokkan pembayaran" };
  return { level: "configured", detail: "QRIS terkonfigurasi, belum ada pembayaran cocok" };
}
