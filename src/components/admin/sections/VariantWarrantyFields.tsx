"use client";

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
  const locked = disabled || wrLocked;
  const lockedInput = "h-9 w-full rounded-xl bg-white/[0.03] border border-white/5 px-3 text-xs text-white/50 cursor-not-allowed";
  const openInput = "h-9 w-full rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white placeholder:text-white/25 focus:border-[#00E5FF]/50 focus:outline-none";
  return (
    <div className="pt-3">
      <span className="block text-[10px] uppercase font-semibold text-white/40 mb-1.5">Masa Garansi{wrLocked ? " (WR)" : ""}</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
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
          className="h-9 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
        >
          <option value="full" className="bg-[#0F1430]">Full Garansi</option>
          <option value="limited" className="bg-[#0F1430]">Garansi Terbatas</option>
          <option value="none" className="bg-[#0F1430]">Tanpa Garansi</option>
          <option value="custom" className="bg-[#0F1430]">Teks Kustom</option>
        </select>

        {(value.warranty_type === "full" || value.warranty_type === "limited") && (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              value={value.warranty_value ?? 1}
              readOnly={locked}
              onChange={(e) => {
                const val = Math.max(1, Number(e.target.value) || 1);
                onChange({ warranty_value: val });
              }}
              className={`h-9 w-16 rounded-xl border px-2 text-xs text-center focus:outline-none ${locked ? "bg-white/[0.03] border-white/5 text-white/50 cursor-not-allowed" : "bg-white/[0.06] border-white/10 text-white focus:border-[#00E5FF]/50"}`}
            />
            <select
              value={value.warranty_unit || "month"}
              disabled={locked}
              onChange={(e) => onChange({ warranty_unit: e.target.value })}
              className="h-9 rounded-xl bg-white/[0.06] border border-white/10 px-3 text-xs text-white focus:border-[#00E5FF]/50 focus:outline-none"
            >
              <option value="day" className="bg-[#0F1430]">Hari</option>
              <option value="month" className="bg-[#0F1430]">Bulan</option>
              <option value="year" className="bg-[#0F1430]">Tahun</option>
              <option value="lifetime" className="bg-[#0F1430]">Selamanya</option>
            </select>
          </div>
        )}

        {value.warranty_type === "custom" && (
          <input
            value={value.warranty_label || ""}
            readOnly={locked}
            onChange={(e) => onChange({ warranty_label: e.target.value })}
            placeholder="Contoh: Garansi 24 Jam Ganti Akun"
            className={`h-9 flex-1 min-w-[200px] rounded-xl border px-3 text-xs focus:outline-none ${locked ? "bg-white/[0.03] border-white/5 text-white/50 cursor-not-allowed" : "bg-white/[0.06] border-white/10 text-white placeholder:text-white/20 focus:border-[#00E5FF]/50"}`}
          />
        )}

        <span className="text-[11px] text-[#00E5FF]/80 font-medium ml-auto pl-2 py-1">
          Hasil: {warrantyPreviewLabel(value)}
        </span>
      </div>
    </div>
  );
}
