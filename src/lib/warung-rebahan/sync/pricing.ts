export function defaultMarkupPercent(): number {
  const raw = Number(process.env.WARUNG_REBAHAN_DEFAULT_MARKUP_PERCENT ?? 50);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 50;
}

export function defaultMarkupFixed(): number {
  const raw = Number(process.env.WARUNG_REBAHAN_DEFAULT_MARKUP_FIXED ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}

function defaultCategoryId(): number {
  const raw = Number(process.env.WARUNG_REBAHAN_DEFAULT_CATEGORY_ID ?? 2);
  return Number.isInteger(raw) && raw > 0 ? raw : 2;
}

/**
 * Harga jual = ceil(WR × (1 + %)) + fixed, dibulatkan ke kelipatan 500.
 * Contoh plan §15: 5000+50% → 7500; 3200+50% → 4800 → 5000.
 */
export function calculateSellPrice(
  wrPrice: number,
  markupPercent: number,
  markupFixed: number,
): number {
  const base = Math.ceil(wrPrice * (1 + markupPercent / 100)) + markupFixed;
  return Math.ceil(base / 500) * 500;
}

export function generateProductSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "produk-wr";
}

/** "7 Hari" → {7,day}; "1 Bulan" → {1,month}; "Lifetime" → lifetime. */
export function parseWrDuration(wrDuration: string | null | undefined): {
  value: number | null;
  unit: "day" | "month" | "year" | "lifetime" | "custom" | null;
  label: string;
} {
  const label = String(wrDuration ?? "").trim();
  if (!label) return { value: null, unit: null, label: "" };
  const lowered = label.toLowerCase();
  if (lowered.includes("lifetime") || lowered.includes("selamanya")) {
    return { value: null, unit: "lifetime", label };
  }
  const match = lowered.match(/(\d+)\s*(hari|day|minggu|week|bulan|month|tahun|year)/);
  if (!match) return { value: null, unit: "custom", label };
  const value = Number(match[1]);
  const raw = match[2];
  if (raw.startsWith("hari") || raw === "day") return { value, unit: "day", label };
  if (raw.startsWith("minggu") || raw === "week") return { value: value * 7, unit: "day", label };
  if (raw.startsWith("bulan") || raw === "month") return { value, unit: "month", label };
  return { value, unit: "year", label };
}

export function parseWrWarranty(wrWarranty: string | null | undefined): {
  type: "none" | "limited" | "full" | "custom";
  value: number | null;
  unit: "day" | "month" | "year" | "lifetime" | null;
  label: string;
} {
  const label = String(wrWarranty ?? "").trim();
  if (!label || /^(tanpa|no|none|-|tidak ada)/i.test(label)) {
    return { type: "none", value: null, unit: null, label };
  }
  const lowered = label.toLowerCase();
  if (lowered.includes("full")) {
    const duration = parseWrDuration(label);
    return {
      type: "full",
      value: duration.value,
      unit: duration.unit === "custom" ? null : duration.unit,
      label,
    };
  }
  const duration = parseWrDuration(label);
  if (duration.unit && duration.unit !== "custom") {
    return {
      type: "limited",
      value: duration.value,
      unit: duration.unit,
      label,
    };
  }
  return { type: "custom", value: null, unit: null, label };
}

/** Map kategori WR → category_id Axvara (migrasi 0046: taksonomi 6 kategori).
 *  1 AI & Chatbot · 2 Streaming & Hiburan · 3 Produktivitas & Office ·
 *  4 Bundle Hemat · 5 Desain & Video · 6 Developer & Tools. */
export function mapWrCategory(wrCategory: string | null | undefined): number {
  const lowered = String(wrCategory ?? "").trim().toLowerCase();
  if (lowered.includes("ai")) return 1;
  if (lowered.includes("stream")) return 2;
  if (lowered.includes("gam")) return 2;
  if (
    lowered.includes("design") ||
    lowered.includes("desain") ||
    lowered.includes("video") ||
    lowered.includes("canva") ||
    lowered.includes("edit")
  ) {
    return 5;
  }
  if (
    lowered.includes("vpn") ||
    lowered.includes("develop") ||
    lowered.includes("code") ||
    lowered.includes("tool")
  ) {
    return 6;
  }
  if (lowered.includes("productiv") || lowered.includes("educ")) {
    return 3;
  }
  return defaultCategoryId();
}
