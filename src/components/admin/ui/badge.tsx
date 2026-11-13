import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
export const badgeVariants = cva("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold", {
  variants: { variant: {
    default: "border-admin-primary bg-admin-primary text-admin-inverse",
    secondary: "border-admin-subtle bg-admin-subtle text-admin-muted",
    outline: "border-admin-border text-admin-fg",
    destructive: "border-admin-danger/25 bg-admin-danger/10 text-admin-danger",
    success: "border-admin-success/25 bg-admin-success/10 text-admin-success",
    warning: "border-admin-warning/25 bg-admin-warning/10 text-admin-warning",
    info: "border-admin-info/25 bg-admin-info/10 text-admin-info",
  } }, defaultVariants: { variant: "secondary" },
});
export function Badge({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
