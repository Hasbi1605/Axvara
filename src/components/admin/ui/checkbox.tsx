"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
export const Checkbox = React.forwardRef<React.ElementRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(({ className, ...props }, ref) => <Primitive.Root ref={ref} className={cn("peer inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-admin-input bg-admin-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-admin-primary data-[state=checked]:bg-admin-primary data-[state=checked]:text-admin-inverse", className)} {...props}><Primitive.Indicator><Check className="size-4" /></Primitive.Indicator></Primitive.Root>);
Checkbox.displayName = "Checkbox";
