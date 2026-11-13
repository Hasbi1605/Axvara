"use client";
import { Input, Label, NativeSelect } from "@/components/admin/ui";

import { useId } from "react";

// Field garansi bersama untuk tab Varian — dipakai baris multi-varian
// (ProductVariantRows) dan mode single (SingleVariantFields).
// Diekstrak 2026-09-28 agar kedua mode selalu paritas: sebelumnya blok ini
// hanya hidup di ProductVariantRows sehingga produk non-varian terkunci di
// "Tanpa Garansi" tanpa jalan keluar dari UI.

export type WarrantyValue = {
  warranty_type?: string;
  warranty_value?: number | null;
  warranty_unit?: string | null;
  warranty_label?: string | null;
};

export function warrantyPreviewLabel(w: WarrantyValue): string {
  if (w.warranty_type === "none") return "Tanpa Garansi";
  if (w.warranty_type === "custom") return w.warranty_label || "Kustom";
  const unit = w.warranty_unit === "day" ? "Hari" : w.warranty_unit === "year" ? "Tahun" : w.warranty_unit === "lifetime" ? "Selamanya" : "Bulan";
  return `${w.warranty_type === "full" ? "Full Garansi" : "Garansi Terbatas"} ${w.warranty_value ?? 1} ${unit}`;
}

export function WarrantyFields({
  value,
  onChange,
  disabled = false,
  wrLocked = false,
}: {
  value: WarrantyValue;
  onChange: (patch: Partial<WarrantyValue>) => void;
  disabled?: boolean;
  wrLocked?: boolean;
}) {
  const typeId = useId();
  const locked = disabled || wrLocked;
  const lockedInput = "h-9 w-full rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-muted cursor-not-allowed";
  const openInput = "h-9 w-full rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/50 focus:outline-none";
  return (
    <div className="pt-3">
      <Label htmlFor={typeId} className="block text-sm font-medium text-admin-muted mb-1.5">Masa Garansi{wrLocked ? " (WR)" : ""}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          id={typeId}
          value={value.warranty_type || "full"}
          disabled={locked}
          onChange={(e) => {
            const wType = e.target.value;
            onChange({
              warranty_type: wType,
              warranty_value: value.warranty_value ?? 1,
              warranty_unit: value.warranty_unit || "month",
            });
          }}
          className="h-9 rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg focus:border-admin-accent/50 focus:outline-none"
        >
          <option value="full" className="bg-admin-card">Full Garansi</option>
          <option value="limited" className="bg-admin-card">Garansi Terbatas</option>
          <option value="none" className="bg-admin-card">Tanpa Garansi</option>
          <option value="custom" className="bg-admin-card">Teks Kustom</option>
        </NativeSelect>

        {(value.warranty_type === "full" || value.warranty_type === "limited") && (
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={1}
              value={value.warranty_value ?? 1}
              readOnly={locked}
              onChange={(e) => {
                const val = Math.max(1, Number(e.target.value) || 1);
                onChange({ warranty_value: val });
              }}
              className={`h-9 w-16 rounded-xl border px-2 text-xs text-center focus:outline-none ${locked ? "bg-admin-subtle border-admin-border text-admin-muted cursor-not-allowed" : "bg-admin-subtle border-admin-border text-admin-fg focus:border-admin-accent/50"}`}
            />
            <NativeSelect
              value={value.warranty_unit || "month"}
              disabled={locked}
              onChange={(e) => onChange({ warranty_unit: e.target.value })}
              className="h-9 rounded-xl bg-admin-subtle border border-admin-border px-3 text-xs text-admin-fg focus:border-admin-accent/50 focus:outline-none"
            >
              <option value="day" className="bg-admin-card">Hari</option>
              <option value="month" className="bg-admin-card">Bulan</option>
              <option value="year" className="bg-admin-card">Tahun</option>
              <option value="lifetime" className="bg-admin-card">Selamanya</option>
            </NativeSelect>
          </div>
        )}

        {value.warranty_type === "custom" && (
          <Input
            value={value.warranty_label || ""}
            readOnly={locked}
            onChange={(e) => onChange({ warranty_label: e.target.value })}
            placeholder="Contoh: Garansi 24 Jam Ganti Akun"
            className={`h-9 flex-1 min-w-[200px] rounded-xl border px-3 text-xs focus:outline-none ${locked ? "bg-admin-subtle border-admin-border text-admin-muted cursor-not-allowed" : "bg-admin-subtle border-admin-border text-admin-fg placeholder:text-admin-muted focus:border-admin-accent/50"}`}
          />
        )}

        <span className="text-xs text-admin-accent/80 font-medium ml-auto pl-2 py-1">
          Hasil: {warrantyPreviewLabel(value)}
        </span>
      </div>
    </div>
  );
}
