import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <div className={cn("flex flex-wrap items-start justify-between gap-3", className)} {...props}>
    <div className="min-w-0"><h2 className="text-xl font-semibold text-admin-fg">{title}</h2>{description && <p className="mt-1 text-sm text-admin-muted">{description}</p>}</div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
