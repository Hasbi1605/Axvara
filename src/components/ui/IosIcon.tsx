"use client";

/**
 * IosIcon — thin wrapper for Icons8 iOS 11 Glyph (filled) PNGs.
 * Icons8 iOS packs are pixel-perfect for Apple HIG, more premium than lucide for storefront.
 * Files: /public/icons/ios11/{name}-{size}.png  (32/48/64/96). Black glyph on transparent, tinted via CSS.
 * MCP: icons8 -> search_icons platform="ios11" + get_icon_png_url id=... + img.icons8.com/?id=...&format=png
 */
export type IosIconName =
  | "search"
  | "shopping-bag"
  | "lightning-bolt"
  | "shield"
  | "qr-code"
  | "wallet"
  | "discount"
  | "crown"
  | "star"
  | "packaging"
  // — admin panel (iOS 11 Glyph) —
  | "dashboard"
  | "box"
  | "purchase-order"
  | "category"
  | "news"
  | "image"
  | "full-image"
  | "picture"
  | "bot"
  | "chatbot"
  | "menu"
  | "external-link"
  | "exit"
  | "logout-rounded"
  | "edit"
  | "create-new"
  | "trash"
  | "delete"
  | "close"
  | "plus"
  | "minus"
  | "chevron-left"
  | "chevron-right"
  | "chevron"
  | "arrow-right"
  | "left-arrow"
  | "right-arrow"
  | "back"
  | "arrow"
  | "bag"
  | "bank"
  | "clock"
  | "copy"
  | "credit-card"
  | "home"
  | "upload"
  | "link"
  | "settings"
  | "chat"
  | "checked"
  | "checked-v2"
  | "overview-pages-1";

function pickSize(px: number) {
  if (px <= 16) return 32;
  if (px <= 22) return 48;
  if (px <= 28) return 64;
  return 96;
}

export function IosIcon({
  name,
  size = 20,
  className = "",
  alt = "",
  tint,
}: {
  name: IosIconName;
  size?: number;
  className?: string;
  alt?: string;
  tint?: string; // css color for monochrome png via filter — fallback to currentColor via invert
}) {
  const fileSize = pickSize(size);
  const src = `/icons/ios11/${name}-${fileSize}.png`;
  // iOS glyph is pure black #000. To tint, use filter. White = invert(1). Cyan/Gold etc computed via drop-in.
  // Simplest: if tint is white-ish, invert; otherwise use CSS filter with tint via background + mask approach fallback to invert+ hue.
  const style: React.CSSProperties & { WebkitMaskImage?: string; WebkitMaskRepeat?: string; WebkitMaskSize?: string; WebkitMaskPosition?: string } = {};
  let filter: string | undefined;
  if (tint) {
    const t = tint.toLowerCase().trim();
    if (t === "white" || t === "#fff" || t === "#ffffff" || t.includes("255,255,255")) filter = "brightness(0) invert(1)";
    else if (t === "black" || t === "#000" || t === "#000000" || t === "#080c1e" || t === "#080C1E" || t.includes("8,12,30")) filter = "brightness(0)";
    else if (t === "#00e5ff" || t.includes("0,229,255")) filter = "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)";
    else if (t === "#ffb800" || t.includes("255,184,0")) filter = "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)";
    else filter = "brightness(0) invert(1)"; // default white
  } else {
    filter = undefined;
  }
  if (filter) style.filter = filter;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || name}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain", ...style }}
      draggable={false}
      loading="lazy"
    />
  );
}

// Single source ikon ada di @/lib/category-icons (edge-safe, dipakai API + UI).
// Re-export di bawah agar import lama tetap jalan.
export {
  CATEGORY_ICON_OPTIONS,
  LEGACY_CATEGORY_ICON_MAP,
  isCategoryIconName,
  resolveCategoryIconName,
} from "@/lib/category-icons";
import { resolveCategoryIconName } from "@/lib/category-icons";

// Kompatibilitas: kode lama memanggil categoryIcon(slug) / resolveCategoryIcon(stored, slug).
// Ikon prioritas dari kolom DB; slug hanya fallback data lama sehingga
// rename kategori tidak ikut mengganti ikon.
export function categoryIcon(slug: string, storedIcon?: string | null): IosIconName {
  return resolveCategoryIconName(storedIcon ?? null, slug);
}

export function resolveCategoryIcon(
  storedIcon?: string | null,
  slug?: string | null,
): IosIconName {
  return resolveCategoryIconName(storedIcon ?? null, slug ?? null);
}
