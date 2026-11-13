"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { useAdminPortal } from "./portal";
export const TooltipProvider = Primitive.Provider;
export const Tooltip = Primitive.Root;
export const TooltipTrigger = Primitive.Trigger;
export const TooltipContent = React.forwardRef<React.ElementRef<typeof Primitive.Content>, React.ComponentPropsWithoutRef<typeof Primitive.Content>>(({ className, sideOffset = 4, ...props }, ref) => {
  const container = useAdminPortal();
  if (!container) return null;
  return <Primitive.Portal container={container}><Primitive.Content ref={ref} sideOffset={sideOffset} className={cn("z-[70] max-w-xs rounded-md bg-admin-primary px-3 py-1.5 text-xs text-admin-inverse shadow-md animate-in fade-in-0 zoom-in-95", className)} {...props} /></Primitive.Portal>;
});
TooltipContent.displayName = "TooltipContent";
