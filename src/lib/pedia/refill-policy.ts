// src/lib/pedia/refill-policy.ts — Skema refill Pedia (2026-11-01).
//
// Dua jalur, ditentukan oleh layanan supplier asal order:
// - "api": IndoSMM menyediakan tombol refill lewat API (`api_refill=1`).
//   AXVARA mengirim `refill`, lalu cron memantau `refill_status`.
// - "manual": layanan bergaransi tetapi tanpa tombol API. Pengajuan pembeli
//   dicatat `manual_requested` dan admin meneruskannya ke CS IndoSMM
//   (tiket/WA dengan Order ID), lalu menandai hasilnya di panel admin.
// Aturan supplier: refill hanya selama masa garansi, maks 1 pengajuan / 24 jam,
// dan hanya menutup jumlah yang turun dari pesanan ini.
import { parseExpiry } from "@/lib/expiry";

export type PediaRefillMode = "api" | "manual" | "none";
export const REFILL_TERMINAL = ["completed", "rejected", "canceled", "cancelled", "supplier_rejected"] as const;
export const REFILL_COOLDOWN_MS = 24 * 3600 * 1000;

export type PediaRefillState = {
  mode: PediaRefillMode;
  days: number;
  eligible: boolean;
  /** Kode alasan bila tidak bisa diajukan sekarang. */
  reason: "no_refill" | "not_completed" | "expired" | "in_progress" | "cooldown" | "no_supplier_order" | null;
  ends_at: string | null;
  next_at: string | null;
  status: string | null;
  status_label: string | null;
  last_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Sedang diajukan",
  submitted: "Refill sedang diproses",
  manual_requested: "Diproses admin",
  needs_check: "Sedang diperiksa admin",
  completed: "Refill selesai",
  rejected: "Refill ditolak",
  supplier_rejected: "Refill ditolak",
  canceled: "Refill dibatalkan",
  cancelled: "Refill dibatalkan",
};

const STATUS_LABEL_EN: Record<string, string> = {
  requested: "Being requested",
  submitted: "Refill in progress",
  manual_requested: "Processed by admin",
  needs_check: "Being checked by admin",
  completed: "Refill completed",
  rejected: "Refill rejected",
  supplier_rejected: "Refill rejected",
  canceled: "Refill canceled",
  cancelled: "Refill canceled",
};

export function refillStatusLabel(status: unknown, locale: "id" | "en" = "id"): string | null {
  if (status == null) return null;
  return (locale === "en" ? STATUS_LABEL_EN : STATUS_LABEL)[String(status)] ?? (locale === "en" ? "Processing" : "Sedang diproses");
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Hitung status refill satu item. `apiRefill` dari mirror layanan supplier. */
export function pediaRefillState(item: Record<string, unknown>, snapshot: Record<string, unknown>, apiRefill: boolean, now = Date.now()): PediaRefillState {
  const days = Number(snapshot.refill_days ?? item.refill_days) || 0;
  const mode: PediaRefillMode = days <= 0 ? "none" : apiRefill ? "api" : "manual";
  const status = item.refill_status != null ? String(item.refill_status) : null;
  const lastMs = parseExpiry(String(item.refill_last_at ?? ""));
  const anchor = parseExpiry(String(snapshot.refill_anchor === "completed" ? item.completed_at ?? "" : item.created_at ?? ""));
  const endsMs = anchor !== null && days > 0 ? anchor + days * 86400000 : null;
  const nextMs = lastMs !== null ? lastMs + REFILL_COOLDOWN_MS : null;
  const idle = (status == null && item.refill_supplier_id == null && item.refill_last_at == null) || (status != null && (REFILL_TERMINAL as readonly string[]).includes(status));
  let reason: PediaRefillState["reason"] = null;
  if (mode === "none") reason = "no_refill";
  else if (item.status !== "completed" && item.status !== "partial") reason = "not_completed";
  else if (endsMs === null || now > endsMs) reason = "expired";
  else if (!idle) reason = "in_progress";
  else if (nextMs !== null && now < nextMs) reason = "cooldown";
  else if (mode === "api" && !item.supplier_order_id) reason = "no_supplier_order";
  return {
    mode, days, eligible: reason === null, reason,
    ends_at: endsMs !== null ? iso(endsMs) : null,
    next_at: nextMs !== null && now < nextMs ? iso(nextMs) : null,
    status, status_label: refillStatusLabel(status),
    last_at: lastMs !== null ? iso(lastMs) : null,
  };
}

export const REFILL_REASON_TEXT: Record<NonNullable<PediaRefillState["reason"]>, string> = {
  no_refill: "Layanan ini No Refill, jadi jumlah yang drop tidak diisi ulang.",
  not_completed: "Refill bisa diajukan setelah pesanan selesai.",
  expired: "Masa refill pesanan ini sudah berakhir.",
  in_progress: "Refill sebelumnya masih diproses.",
  cooldown: "Refill hanya bisa diajukan 1× per 24 jam.",
  no_supplier_order: "Pesanan belum siap direfill. Hubungi admin.",
};

const REFILL_REASON_TEXT_EN: Record<NonNullable<PediaRefillState["reason"]>, string> = {
  no_refill: "This service is No Refill, so dropped quantity is not topped up.",
  not_completed: "A refill can be requested once the order is complete.",
  expired: "The refill period for this order has ended.",
  in_progress: "The previous refill is still being processed.",
  cooldown: "A refill can only be requested once per 24 hours.",
  no_supplier_order: "The order is not ready for refill yet. Contact admin.",
};

export function refillReasonText(reason: NonNullable<PediaRefillState["reason"]>, locale: "id" | "en" = "id"): string {
  return (locale === "en" ? REFILL_REASON_TEXT_EN : REFILL_REASON_TEXT)[reason];
}
