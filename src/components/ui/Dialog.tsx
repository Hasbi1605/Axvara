"use client";

import { useEffect, useRef, type ReactNode } from "react";
let openModals = 0;
let initialOverflow = "";

/** Native modal supplies focus containment, inert background and focus restoration. */
export function Dialog({ title, onClose, children, className = "", busy = false }: { title: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (openModals++ === 0) initialOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && dialog.close) dialog.close();
      if (--openModals === 0) document.body.style.overflow = initialOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={ref} aria-label={title} aria-modal="true" className={`admin-dialog ${className}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (!busy && event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>{children}</dialog>;
}
