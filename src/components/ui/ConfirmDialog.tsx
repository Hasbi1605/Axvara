"use client";
import { useRef } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogHeader, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from "@/components/admin/ui/alert-dialog";
import { buttonVariants } from "@/components/admin/ui/button";
import { Loader2 } from "lucide-react";

type Props = { open: boolean; title: string; description: string; confirmLabel?: string; cancelLabel?: string; variant?: "danger" | "default"; loading?: boolean; onConfirm: () => void; onClose: () => void };
export function ConfirmDialog({ open, title, description, confirmLabel = "Hapus", cancelLabel = "Batal", variant = "danger", loading, onConfirm, onClose }: Props) {
  const previousFocus = useRef<HTMLElement | null>(null);
  return <AlertDialog open={open} onOpenChange={value => { if (!value && !loading) onClose(); }}>
    <AlertDialogContent onOpenAutoFocus={() => { previousFocus.current = document.activeElement as HTMLElement | null; }} onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }} onEscapeKeyDown={event => { if (loading) event.preventDefault(); }}>
      <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel><AlertDialogAction disabled={loading} className={buttonVariants({ variant: variant === "danger" ? "destructive" : "default" })} onClick={event => { event.preventDefault(); onConfirm(); }}>{loading && <Loader2 className="size-4 animate-spin" />}{confirmLabel}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
