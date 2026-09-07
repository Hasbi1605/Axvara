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
// Semua fungsi murni atas data DB/env agar gampang di-unit-test; route hanya
// mengambil baris dan memanggilnya.

export type ServiceLevel = "configured" | "healthy" | "degraded" | "unknown";

export type ServiceStatus = {
  level: ServiceLevel;
  detail: string;
};

export type QueueSample = {
  pending: number;
  failed: number;
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
  for (const row of rows) {
    const status = String(row.status || "");
    const count = Number(row.count || 0);
    if (["queued", "retry", "pending", "sending", "processing"].includes(status)) pending += count;
    if (["failed", "dead"].includes(status)) failed += count;
  }
  return { pending, failed, oldestPendingAt: oldestAt };
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
  return { level: "configured", detail: "Telegram terkonfigurasi, belum ada pengukuran kirim" };
}

export type WhatsAppSignals = {
  configured: boolean;
  enabled: boolean;
  gatewayReachable: boolean | null;
  lastSendOkAt: string | null;
  lastSendFailAt: string | null;
  queue: QueueSample;
};

export function evaluateWhatsApp(signals: WhatsAppSignals, now = Date.now()): ServiceStatus {
  if (!signals.configured || !signals.enabled) return { level: "unknown", detail: "WhatsApp belum dikonfigurasi/aktif" };
  if (signals.gatewayReachable === false) return { level: "degraded", detail: "Gateway Baileys tidak terjangkau" };
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
  lastMatchAt: string | null;
};

export function evaluateQris(signals: QrisSignals): ServiceStatus {
  if (!signals.configured || !signals.enabled) return { level: "unknown", detail: "QRIS dinamis belum dikonfigurasi/aktif" };
  if (signals.failed7d > 0) return { level: "degraded", detail: `QRIS: ${signals.failed7d} event gagal 7 hari` };
  if (signals.unmatched7d > 10) return { level: "degraded", detail: `QRIS: ${signals.unmatched7d} event tak cocok 7 hari` };
  if (signals.lastMatchAt) return { level: "healthy", detail: "QRIS Hook mencocokkan pembayaran" };
  return { level: "configured", detail: "QRIS terkonfigurasi, belum ada pembayaran cocok" };
}
