"use client";

import { Button } from "@/components/admin/ui";
import type { Locale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

export function LanguageToggle({
  value,
  onChange,
  missingEnCount,
  compact = false,
  ariaLabel = "Pilih bahasa teks",
}: {
  value: Locale;
  onChange: (next: Locale) => void;
  missingEnCount?: number;
  compact?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-lg border border-admin-border bg-admin-subtle p-1"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={value === "id"}
        onClick={() => onChange("id")}
        className={cn(
          "h-7 rounded-md px-2.5 text-xs font-medium",
          value === "id"
            ? "bg-admin-card text-admin-fg shadow-sm hover:bg-admin-card"
            : "text-admin-muted hover:bg-transparent hover:text-admin-fg",
        )}
      >
        {compact ? "ID" : "Indonesia"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={value === "en"}
        onClick={() => onChange("en")}
        className={cn(
          "h-7 gap-1.5 rounded-md px-2.5 text-xs font-medium",
          value === "en"
            ? "bg-admin-card text-admin-fg shadow-sm hover:bg-admin-card"
            : "text-admin-muted hover:bg-transparent hover:text-admin-fg",
        )}
      >
        <span>{compact ? "EN" : "English"}</span>
        {typeof missingEnCount === "number" && missingEnCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-admin-warning">
            <span aria-hidden className="inline-block size-1.5 rounded-full bg-admin-warning" />
            {missingEnCount} kosong
          </span>
        )}
      </Button>
    </div>
  );
}
