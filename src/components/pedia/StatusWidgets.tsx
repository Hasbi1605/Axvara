// src/components/pedia/ProgressRing.tsx — Cincin progres pesanan (PD-12).
// SVG 160px, stroke gradien Pedia, transisi dashoffset 600ms, aria-valuenow.
export function ProgressRing({ percent, done, total }: { percent: number; done: number; total: number }) {
  const size = 160;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progres ${Math.round(clamped)} persen`}
      className="relative mx-auto h-40 w-40"
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="pxring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00E5FF" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="url(#pxring)" strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * clamped) / 100}
          style={{ transition: "stroke-dashoffset 600ms var(--ease-out)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-bold text-white" style={{ fontVariantNumeric: "tabular-nums" }}>
          {Math.round(clamped)}%
        </span>
        <span className="text-xs text-white/55" style={{ fontVariantNumeric: "tabular-nums" }}>
          {done.toLocaleString("id-ID")} / {total.toLocaleString("id-ID")}
        </span>
      </div>
    </div>
  );
}

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
  canceled: "Dibatalkan supplier",
  needs_check: "Sedang kami cek",
  expired: "Kedaluwarsa",
};

export function pediaStatusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed" ? "bg-emerald-400/15 text-emerald-300"
    : status === "awaiting_payment" ? "bg-[#FFB800]/15 text-[#FFCF55]"
    : status === "needs_check" ? "bg-violet-400/15 text-[var(--px-violet-strong)]"
    : status === "partial" || status === "canceled" ? "bg-amber-400/15 text-amber-300"
    : "bg-[#00E5FF]/15 text-[#00E5FF]";
  return (
    <span className={`inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-bold ${tone}`}>
      {pediaStatusLabel(status)}
    </span>
  );
}

// src/components/pedia/OrderTimeline.tsx — Timeline 3–4 titik (PD-12).
export function OrderTimeline({ steps }: { steps: { label: string; done: boolean; active?: boolean }[] }) {
  return (
    <ol className="flex items-center gap-1">
      {steps.map((s, i) => (
        <li key={s.label} className="flex flex-1 items-center gap-1 last:flex-none">
          <span className="flex flex-col items-center gap-1">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                s.done ? "bg-[var(--px-violet)] text-white"
                : s.active ? "animate-pulse bg-[#00E5FF] text-[#070a1e]"
                : "bg-white/10 text-white/40"
              }`}
              aria-hidden="true"
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span className="text-[10px] text-white/55">{s.label}</span>
          </span>
          {i < steps.length - 1 && <span className="mb-5 h-px flex-1 bg-white/10" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}
