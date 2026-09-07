"use client";
import { useEffect } from "react";
import { IosIcon } from "@/components/ui/IosIcon";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Hapus",
  cancelLabel = "Batal",
  variant = "danger",
  loading,
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden p-4">
      <div className="absolute inset-0 bg-[#040612]/95 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative z-10 w-full max-w-[420px] rounded-[22px] border border-white/10 bg-[#0B1025] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.65)] sm:p-6">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${variant === "danger" ? "border-red-400/25 bg-red-500/10" : "border-[#00E5FF]/25 bg-[#00E5FF]/10"}`}>
            <IosIcon name={variant === "danger" ? "trash" : "info"} size={17} tint={variant === "danger" ? "#F87171" : "#00E5FF"} />
          </span>
          <h3 className="min-w-0 flex-1 font-semibold text-white">{title}</h3>
        </div>
        <p className="mt-3 text-sm leading-6 text-white/60">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus onClick={onClose} disabled={!!loading} className="h-10 px-4 rounded-full border border-white/10 bg-white/[0.06] text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={!!loading}
            className={`h-10 px-5 rounded-full text-sm font-bold inline-flex items-center gap-2 transition disabled:opacity-60 ${
              variant === "danger" ? "bg-red-500 text-white hover:bg-red-400" : "bg-white text-[#070a1e] hover:bg-white/90"
            }`}
          >
            {loading ? <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> : <IosIcon name={variant === "danger" ? "trash" : "checked"} size={13} tint={variant === "danger" ? "white" : "black"} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
