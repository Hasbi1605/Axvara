"use client";
import { useRef, useState } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/admin/ui/alert-dialog";
import { buttonVariants } from "@/components/admin/ui/button";
import { Loader2 } from "lucide-react";

type Props = { open: boolean; title: string; description: string; confirmLabel?: string; cancelLabel?: string; variant?: "danger" | "default"; loading?: boolean; error?: string; onConfirm: () => void; onClose: () => void };
export function ConfirmDialog({ open, title, description, confirmLabel = "Hapus", cancelLabel = "Batal", variant = "danger", loading, error, onConfirm, onClose }: Props) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <AlertDialog open={open} onOpenChange={value => { if (!value && !loading) onClose(); }}>
    <AlertDialogContent onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement | null; }} onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }} onEscapeKeyDown={event => { if (loading) event.preventDefault(); }}>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      {error && <p role="alert" className="break-words text-sm text-admin-danger">{error}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel><AlertDialogAction disabled={loading} className={buttonVariants({ variant: variant === "danger" ? "destructive" : "default" })} onClick={event => { event.preventDefault(); onConfirm(); }}>{loading && <Loader2 className="size-4 animate-spin" />}{confirmLabel}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}

/** Mount only while a target is selected. Keep the target and error visible until success or cancel. */
export function AsyncConfirmDialog({ onConfirm, onClose, ...props }: Omit<Props, "open" | "loading" | "error" | "onConfirm"> & { onConfirm: () => Promise<void> }) {
  const pending = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const confirm = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try { await onConfirm(); onClose(); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : "Tindakan gagal. Coba lagi."); }
    finally { pending.current = false; setLoading(false); }
  };
  return <ConfirmDialog {...props} open loading={loading} error={error} onClose={() => { if (!pending.current) onClose(); }} onConfirm={() => void confirm()} />;
}
