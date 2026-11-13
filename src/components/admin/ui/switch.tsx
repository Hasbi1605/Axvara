"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
export const Switch = React.forwardRef<React.ElementRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(({ className, ...props }, ref) => <Primitive.Root ref={ref} className={cn("peer inline-flex h-9 w-14 shrink-0 cursor-pointer items-center rounded-full border-4 border-admin-card bg-admin-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-admin-primary", className)} {...props}><Primitive.Thumb className="pointer-events-none block size-5 rounded-full bg-admin-card shadow-lg transition-transform data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-0" /></Primitive.Root>);
Switch.displayName = "Switch";
