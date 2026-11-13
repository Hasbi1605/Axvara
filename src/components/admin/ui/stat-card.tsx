import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./card";

const tones = { secondary: "text-admin-muted", success: "text-admin-success", warning: "text-admin-warning", danger: "text-admin-danger", info: "text-admin-info" };

export function StatCard({ label, value, hint, tone = "secondary", className, ...props }: ComponentProps<typeof Card> & { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: keyof typeof tones }) {
  return <Card className={cn("min-w-0 p-4", className)} {...props}>
    <p className="text-sm font-medium text-admin-muted">{label}</p>
    <div className="mt-1 text-2xl font-semibold tabular-nums text-admin-fg">{value}</div>
    {hint && <p className={cn("mt-1 text-xs", tones[tone])}>{hint}</p>}
  </Card>;
}
