import type { Locale } from "@/lib/i18n/locale";

// src/components/pedia/StatusPill.tsx — Label status bahasa pembeli (§5.3).
const LABELS: Record<string, string> = {
  awaiting_payment: "Menunggu pembayaran",
  paid: "Pembayaran diterima",
  queued: "Pembayaran diterima",
  submitting: "Diproses",
  submitted: "Diproses",
  in_progress: "Berjalan",
  completed: "Selesai",
  partial: "Selesai sebagian",
  canceled: "Dibatalkan",
  needs_check: "Sedang kami cek",
  expired: "Kedaluwarsa",
};

const LABELS_EN: Record<string, string> = {
  awaiting_payment: "Waiting for payment",
  paid: "Payment received",
  queued: "Payment received",
  submitting: "Processing",
  submitted: "Processing",
  in_progress: "In progress",
  completed: "Completed",
  partial: "Partially completed",
  canceled: "Canceled",
  needs_check: "We are checking",
  expired: "Expired",
};

export function pediaStatusLabel(status: string, locale: Locale = "id"): string {
  return (locale === "en" ? LABELS_EN : LABELS)[status] ?? status;
}

export function StatusPill({ status, locale = "id" }: { status: string; locale?: Locale }) {
  const tone =
    status === "completed" ? "bg-emerald-400/15 text-emerald-300"
    : status === "awaiting_payment" ? "bg-[#FFB800]/15 text-[#FFCF55]"
    : status === "needs_check" ? "bg-violet-400/15 text-[var(--px-violet-strong)]"
    : status === "partial" || status === "canceled" ? "bg-amber-400/15 text-amber-300"
    : "bg-[#00E5FF]/15 text-[#00E5FF]";
  return (
    <span className={`inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-bold ${tone}`}>
      {pediaStatusLabel(status, locale)}
    </span>
  );
}
