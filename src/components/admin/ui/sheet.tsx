"use client";
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Dialog, DialogTrigger, DialogClose, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "./dialog";
export const Sheet = Dialog;
export const SheetTrigger = DialogTrigger;
export const SheetClose = DialogClose;
export const SheetHeader = DialogHeader;
export const SheetFooter = DialogFooter;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
const sheetVariants = cva("top-0 h-dvh max-h-dvh translate-x-0 translate-y-0 rounded-none p-0", { variants: { side: {
  left: "left-0 right-auto w-[85vw] max-w-sm data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  right: "left-auto right-0 w-[85vw] max-w-sm data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
} }, defaultVariants: { side: "right" } });
export const SheetContent = React.forwardRef<React.ElementRef<typeof DialogContent>, React.ComponentPropsWithoutRef<typeof DialogContent> & VariantProps<typeof sheetVariants>>(({ side, className, ...props }, ref) => <DialogContent ref={ref} data-admin-sheet="" className={cn(sheetVariants({ side }), className)} {...props} />);
SheetContent.displayName = "SheetContent";
