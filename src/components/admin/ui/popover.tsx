"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { useAdminPortal } from "./portal";
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export const PopoverClose = Primitive.Close;
export const PopoverContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, align = "center", sideOffset = 4, ...props }, ref) => {
  const container = useAdminPortal();
  if (!container) return null;
  return <Primitive.Portal container={container}><Primitive.Content ref={ref} align={align} sideOffset={sideOffset} className={cn("z-[60] w-72 rounded-md border border-admin-border bg-admin-card p-4 text-admin-fg shadow-md outline-none animate-in fade-in-0 zoom-in-95", className)} {...props} /></Primitive.Portal>;
});
PopoverContent.displayName = "PopoverContent";
