import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <div data-slot="page-header" className={cn("flex min-h-36 flex-col items-start justify-start gap-3 md:min-h-[72px] md:flex-row md:justify-between", className)} {...props}>
    <div className="min-w-0 md:flex-1"><h2 className="text-xl font-semibold leading-7 text-admin-fg">{title}</h2>{description && <p className="mt-1 text-sm leading-5 text-admin-muted">{description}</p>}</div>
    {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
