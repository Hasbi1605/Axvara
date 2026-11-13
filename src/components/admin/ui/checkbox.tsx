"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
export const Checkbox = React.forwardRef<React.ElementRef<typeof Primitive.Root>, React.ComponentPropsWithoutRef<typeof Primitive.Root>>(({ className, ...props }, ref) => <Primitive.Root ref={ref} className={cn("peer relative inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-admin-primary/60 bg-admin-card shadow-sm after:absolute after:-inset-2.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-admin-primary data-[state=checked]:bg-admin-primary data-[state=checked]:text-admin-inverse", className)} {...props}><Primitive.Indicator><Check className="size-3.5" /></Primitive.Indicator></Primitive.Root>);
Checkbox.displayName = "Checkbox";
