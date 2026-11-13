"use client";

import { useRef, type ReactNode } from "react";
import { Dialog as Root, DialogContent, DialogTitle } from "@/components/admin/ui/dialog";
import { cn } from "@/lib/utils";

/** Compatibility API for existing admin editors. */
export function Dialog({ title, onClose, children, className = "", busy = false }: { title: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean }) {
  const previousFocus = useRef(typeof document !== "undefined" ? document.activeElement as HTMLElement | null : null);
  return <Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent aria-label={title} aria-modal="true" aria-describedby={undefined} showClose={false} className={cn("max-w-[calc(100vw-2rem)]", className)}
      onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
      onInteractOutside={event => { if (busy) event.preventDefault(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (previousFocus.current?.isConnected) previousFocus.current.focus(); }}>
      <DialogTitle asChild><span className="sr-only">{title}</span></DialogTitle>{children}
    </DialogContent>
  </Root>;
}
