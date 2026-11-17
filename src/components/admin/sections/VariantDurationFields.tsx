"use client";

import { useId } from "react";
import { Input, Label, NativeSelect } from "@/components/admin/ui";
import type { FormVariant } from "../product-types";

type DurationValue = Pick<FormVariant, "duration_value" | "duration_unit" | "duration_label">;

export function DurationFields({ value, onChange, wrLocked = false }: {
  value: DurationValue;
  onChange: (patch: DurationValue) => void;
  wrLocked?: boolean;
}) {
  const id = useId();
  const legacyUnit = value.duration_unit === "lifetime" || value.duration_unit === "custom";
  return (
    <div className="pt-3">
      <Label htmlFor={id} className="mb-2 block text-sm font-medium">Masa aktif{wrLocked ? " (WR)" : " (opsional)"}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          step={1}
          value={value.duration_value ?? ""}
          readOnly={wrLocked || legacyUnit}
          placeholder="Kosong"
          onChange={(e) => onChange(e.target.value === ""
            ? { duration_value: null, duration_unit: null, duration_label: null }
            : { duration_value: Math.max(0, Math.floor(Number(e.target.value) || 0)), duration_unit: value.duration_unit || "day", duration_label: null })}
          className="h-9 w-24 rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg read-only:text-admin-muted read-only:cursor-not-allowed"
        />
        <NativeSelect
          aria-label="Satuan masa aktif"
          value={value.duration_unit || ""}
          disabled={wrLocked}
          onChange={(e) => onChange(e.target.value
            ? { duration_unit: e.target.value, duration_value: value.duration_value ?? 1, duration_label: null }
            : { duration_unit: null, duration_value: null, duration_label: null })}
          className="h-9 rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg"
        >
          <option value="">Tidak diisi</option>
          <option value="day">Hari</option>
          <option value="month">Bulan</option>
          <option value="year">Tahun</option>
          {legacyUnit && <option value={value.duration_unit!}>{value.duration_unit === "lifetime" ? "Selamanya" : "Kustom"}</option>}
        </NativeSelect>
        {legacyUnit && value.duration_label && <span className="text-xs text-admin-muted">{value.duration_label}</span>}
      </div>
    </div>
  );
}
