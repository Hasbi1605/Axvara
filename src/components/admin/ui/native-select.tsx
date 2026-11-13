import * as React from "react";
import { cn } from "@/lib/utils";
import { inputStyles } from "./input";
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => <select ref={ref} className={cn(inputStyles, "h-9", className)} {...props} />);
NativeSelect.displayName = "NativeSelect";
