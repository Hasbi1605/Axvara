"use client";

/** The same track and knob as the Market product status control. */
export function AdminStatusSwitch({ checked, label, disabled, busy, describedBy, onChange }: {
  checked: boolean; label: string; disabled?: boolean; busy?: boolean; describedBy?: string; onChange: () => void;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-busy={busy}
    aria-describedby={describedBy} disabled={disabled} onClick={onChange}
    title={checked ? "Aktif — klik untuk nonaktifkan" : "Nonaktif — klik untuk aktifkan"}
    className={`toggle-btn relative inline-flex h-6 w-[46px] shrink-0 cursor-pointer items-center rounded-full border px-[2px] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00E5FF]/50 disabled:cursor-wait disabled:opacity-50 ${checked ? "border-[#16a34a] bg-[#22C55E] shadow-[0_0_14px_rgba(34,197,94,0.45)]" : "border-white/25 bg-white/20"}`}>
    <span aria-hidden="true" className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform duration-200 ${checked ? "translate-x-[20px]" : "translate-x-0"}`} />
  </button>;
}
