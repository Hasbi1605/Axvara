"use client";
import { Toaster as Sonner, type ToasterProps } from "sonner";
export function Toaster(props: ToasterProps) {
  return <Sonner position="bottom-right" className="admin-toaster" style={{ zIndex: 100 }} toastOptions={{ unstyled: true, classNames: {
    toast: "pointer-events-auto flex w-full items-center gap-3 rounded-lg border border-admin-border bg-admin-card p-4 text-sm text-admin-fg shadow-lg",
    title: "font-medium", description: "text-admin-muted", error: "!border-admin-danger", success: "!border-admin-success", info: "!border-admin-info",
    actionButton: "rounded-md bg-admin-primary px-3 py-2 text-admin-inverse", cancelButton: "rounded-md bg-admin-subtle px-3 py-2 text-admin-fg",
  } }} {...props} />;
}
