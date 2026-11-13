"use client";
import { Dialog } from "./Dialog";

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
  if (!open) return null;

  return (
    <Dialog title={title} onClose={onClose} busy={!!loading} className="w-[420px]">
        <h3 className="font-semibold text-admin-fg">{title}</h3>
        <p className="mt-3 text-sm leading-6 text-admin-muted">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button autoFocus onClick={onClose} disabled={!!loading} className="h-10 px-4 rounded-md border border-admin-border text-sm font-semibold text-admin-muted transition hover:bg-admin-subtle disabled:opacity-50">
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={!!loading}
            className={`h-10 px-5 rounded-full text-sm font-bold inline-flex items-center gap-2 transition disabled:opacity-60 ${
              variant === "danger" ? "bg-red-700 text-white hover:bg-red-800" : "bg-admin-primary text-admin-inverse hover:opacity-90"
            }`}
          >
            {loading && <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
            {confirmLabel}
          </button>
        </div>
    </Dialog>
  );
}
