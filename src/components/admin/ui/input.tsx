import * as React from "react";
import { cn } from "@/lib/utils";
export const inputStyles = "flex min-h-9 w-full rounded-md border border-admin-input bg-admin-card px-3 py-2 text-base text-admin-fg placeholder:text-admin-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn(inputStyles, "h-9 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-admin-fg", className)} {...props} />);
Input.displayName = "Input";
