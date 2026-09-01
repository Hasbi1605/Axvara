"use client";
import { useEffect } from "react";

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#070a1e]/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[420px] ax-glass-strong rounded-[20px] p-5 sm:p-6 border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
        <h3 className="font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-white/60">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} disabled={!!loading} className="h-10 px-4 rounded-full ax-glass text-sm font-semibold text-white/80 hover:text-white disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={!!loading}
            className={`h-10 px-5 rounded-full text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60 ${
              variant === "danger" ? "bg-red-500 text-white hover:bg-red-600" : "bg-white text-[#070a1e]"
            }`}
          >
            {loading && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
