import * as React from "react";
import { cn } from "@/lib/utils";
import { inputStyles } from "./input";
import { ChevronDown } from "lucide-react";
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => {
  // Preserve caller sizing on the wrapper that anchors the chevron.
  const layout = className?.split(/\s+/).filter(token => /^(?:(?:sm|md|lg|xl|2xl):)?(?:w-|min-w-|max-w-|flex-|grow|shrink|basis-|col-|hidden$)/.test(token));
  return <span className={cn("relative grid w-full min-w-0 max-w-full", layout)}><select ref={ref} className={cn(inputStyles, "h-9", className, "appearance-none pr-9")} {...props} /><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-admin-muted" /></span>;
});
NativeSelect.displayName = "NativeSelect";
