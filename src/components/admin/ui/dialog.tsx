"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminPortal } from "./portal";
import { Button } from "./button";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogPortal = ({ children, ...props }: React.ComponentPropsWithoutRef<typeof Primitive.Portal>) => {
  const container = useAdminPortal();
  return container ? <Primitive.Portal {...props} container={container}>{children}</Primitive.Portal> : null;
};
export const DialogOverlay = React.forwardRef<React.ElementRef<typeof Primitive.Overlay>, React.ComponentPropsWithoutRef<typeof Primitive.Overlay>>(({ className, ...props }, ref) => <Primitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-admin-bg/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0", className)} {...props} />);
DialogOverlay.displayName = "DialogOverlay";
export const DialogContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content> & { showClose?: boolean }>(({ className, children, showClose = true, ...props }, ref) => {
  return <DialogPortal><DialogOverlay /><Primitive.Content ref={ref} aria-modal="true" className={cn("fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-admin-border bg-admin-card p-6 text-admin-fg shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95", className)} {...props}>{children}{showClose && <Primitive.Close asChild><Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label="Tutup dialog"><X /></Button></Primitive.Close>}</Primitive.Content></DialogPortal>;
});
DialogContent.displayName = "DialogContent";
export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex flex-col space-y-1.5 text-left", className)} {...props} />; }
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />; }
export const DialogTitle = React.forwardRef<React.ElementRef<typeof Primitive.Title>, React.ComponentPropsWithoutRef<typeof Primitive.Title>>(({ className, ...props }, ref) => <Primitive.Title ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />);
DialogTitle.displayName = "DialogTitle";
export const DialogDescription = React.forwardRef<React.ElementRef<typeof Primitive.Description>, React.ComponentPropsWithoutRef<typeof Primitive.Description>>(({ className, ...props }, ref) => <Primitive.Description ref={ref} className={cn("text-sm text-admin-muted", className)} {...props} />);
DialogDescription.displayName = "DialogDescription";
