"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";
import { useAdminPortal } from "./portal";
import { buttonVariants } from "./button";
export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;
export const AlertDialogContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, children, ...props }, ref) => {
  const container = useAdminPortal();
  if (!container) return null;
  return <Primitive.Portal container={container}><Primitive.Overlay className="fixed inset-0 z-50 bg-admin-bg/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" /><Primitive.Content ref={ref} aria-modal="true" className={cn("fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-admin-border bg-admin-card p-6 text-admin-fg shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)} {...props}>{children}</Primitive.Content></Primitive.Portal>;
});
AlertDialogContent.displayName = "AlertDialogContent";
export function AlertDialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex flex-col space-y-2 text-left", className)} {...props} />; }
export function AlertDialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />; }
export const AlertDialogTitle = React.forwardRef<React.ElementRef<typeof Primitive.Title>, React.ComponentPropsWithoutRef<typeof Primitive.Title>>(({ className, ...props }, ref) => <Primitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />);
AlertDialogTitle.displayName = "AlertDialogTitle";
export const AlertDialogDescription = React.forwardRef<React.ElementRef<typeof Primitive.Description>, React.ComponentPropsWithoutRef<typeof Primitive.Description>>(({ className, ...props }, ref) => <Primitive.Description ref={ref} className={cn("text-sm text-admin-muted", className)} {...props} />);
AlertDialogDescription.displayName = "AlertDialogDescription";
export const AlertDialogAction = React.forwardRef<React.ElementRef<typeof Primitive.Action>, React.ComponentPropsWithoutRef<typeof Primitive.Action>>(({ className, ...props }, ref) => <Primitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />);
AlertDialogAction.displayName = "AlertDialogAction";
export const AlertDialogCancel = React.forwardRef<React.ElementRef<typeof Primitive.Cancel>, React.ComponentPropsWithoutRef<typeof Primitive.Cancel>>(({ className, ...props }, ref) => <Primitive.Cancel ref={ref} className={cn(buttonVariants({ variant: "outline" }), className)} {...props} />);
AlertDialogCancel.displayName = "AlertDialogCancel";
