// Daftar ikon kategori — single source of truth (tanpa "use client" agar bisa dipakai API Edge).
// Setiap value harus ada file-nya di /public/icons/ios11/{value}-{32,48,64,96}.png
export const CATEGORY_ICON_OPTIONS = [
  { value: "lightning-bolt", label: "Petir" },
  { value: "crown", label: "Mahkota" },
  { value: "shield", label: "Perisai" },
  { value: "packaging", label: "Paket" },
  { value: "star", label: "Bintang" },
  { value: "discount", label: "Diskon" },
  { value: "wallet", label: "Dompet" },
  { value: "bag", label: "Tas" },
  { value: "box", label: "Box" },
  { value: "shopping-bag", label: "Belanja" },
  { value: "qr-code", label: "QR" },
  { value: "home", label: "Home" },
] as const;

export type CategoryIconName = (typeof CATEGORY_ICON_OPTIONS)[number]["value"];

const VALUES = new Set<string>(CATEGORY_ICON_OPTIONS.map((o) => o.value));

export function isCategoryIconName(value: unknown): value is CategoryIconName {
  return typeof value === "string" && VALUES.has(value);
}

// Ikon lama (emoji) dari seed awal — dipetakan agar data lama tidak rusak tampilannya.
export const LEGACY_CATEGORY_ICON_MAP: Record<string, CategoryIconName> = {
  "⚡": "lightning-bolt",
  "◆": "crown",
  "◈": "shield",
  "⬢": "packaging",
  "◇": "star",
  "✦": "star",
};

export function resolveCategoryIconName(
  storedIcon?: string | null,
  slug?: string | null,
): CategoryIconName {
  if (isCategoryIconName(storedIcon)) return storedIcon;
  if (storedIcon && LEGACY_CATEGORY_ICON_MAP[storedIcon]) {
    // Jangan paksa emoji lama — kalau slug dikenal, pakai mapping slug agar
    // rename (bundle-hemat -> bundle-kucing) tidak ikut mengganti ikon.
    // Mapping slug di bawah tetap jadi fallback utama data lama.
  }
  switch (slug) {
    case "ai-gateway":
      return "lightning-bolt";
    case "akun-premium":
      return "crown";
    case "tools-pro":
      return "shield";
    case "bundle-hemat":
    case "bundle-kucing":
      return "packaging";
    default:
      if (storedIcon && LEGACY_CATEGORY_ICON_MAP[storedIcon])
        return LEGACY_CATEGORY_ICON_MAP[storedIcon];
      return "star";
  }
}
