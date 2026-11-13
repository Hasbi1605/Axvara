import * as React from "react";
import { cn } from "@/lib/utils";
import { inputStyles } from "./input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => <textarea ref={ref} className={cn(inputStyles, "min-h-20", className)} {...props} />);
Textarea.displayName = "Textarea";
