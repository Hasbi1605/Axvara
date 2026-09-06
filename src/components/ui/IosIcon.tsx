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
  | "send"
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
  | "overview-pages-1"
  | "whatsapp"
  | "telegram-app"
  | "globe"
  | "email"
  | "refresh"
  | "download"
  | "info"
  | "user-manual";

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
  tint?: string; // css color for monochrome png via filter/mask — fallback to currentColor via invert
}) {
  const fileSize = pickSize(size);
  const src = `/icons/ios11/${name}-${fileSize}.png`;
  // iOS glyph is pure black #000. To tint, use filter for neutral/cyan/gold
  // (backward-compat) and exact mask tint for any other hex (brand colors).
  const style: React.CSSProperties & { WebkitMaskImage?: string; WebkitMaskRepeat?: string; WebkitMaskSize?: string; WebkitMaskPosition?: string } = {};
  let filter: string | undefined;
  let maskTint: string | undefined;
  if (tint) {
    const t = tint.toLowerCase().trim();
    if (t === "white" || t === "#fff" || t === "#ffffff" || t.includes("255,255,255")) filter = "brightness(0) invert(1)";
    else if (t === "black" || t === "#000" || t === "#000000" || t === "#080c1e" || t === "#080C1E" || t.includes("8,12,30") || t === "#07101f" || t.includes("7,16,31")) filter = "brightness(0)";
    else if (t === "#00e5ff" || t.includes("0,229,255") || t === "#5cefff") filter = "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)";
    else if (t === "#ffb800" || t.includes("255,184,0") || t === "#ffcf55" || t.includes("255,207,85") || t === "#ffda72" || t === "#ffd66b") filter = "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)";
    else if (t === "#22c55e" || t === "#34d399" || t.includes("52,197,94") || t === "#5cf08a") filter = "brightness(0) saturate(100%) invert(64%) sepia(62%) saturate(1200%) hue-rotate(95deg) brightness(1.02)";
    else if (t === "#25d366") filter = "brightness(0) saturate(100%) invert(65%) sepia(70%) saturate(900%) hue-rotate(95deg) brightness(1.05)";
    else if (t === "#229ed9" || t === "#6fd3ff") filter = "brightness(0) saturate(100%) invert(55%) sepia(85%) saturate(900%) hue-rotate(175deg) brightness(1.05)";
    else if (t === "#ef4444" || t === "#f87171" || t.includes("239,68,68") || t === "#fca5a5") filter = "brightness(0) saturate(100%) invert(45%) sepia(90%) saturate(2500%) hue-rotate(330deg) brightness(1.05)";
    else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)) maskTint = tint;
    else filter = "brightness(0) invert(1)"; // default white
  } else {
    filter = undefined;
  }
  if (filter) style.filter = filter;

  if (maskTint) {
    return (
      <span
        role="img"
        aria-label={alt || name}
        className={className}
        style={{
          width: size,
          height: size,
          display: "inline-block",
          flexShrink: 0,
          backgroundColor: maskTint,
          WebkitMaskImage: `url(${src})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          WebkitMaskPosition: "center",
          maskImage: `url(${src})`,
          maskRepeat: "no-repeat",
          maskSize: "contain",
          maskPosition: "center",
        }}
      />
    );
  }

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
import { resolveCategoryIconName as resolveCategoryIconNameImpl } from "@/lib/category-icons";

// Kompatibilitas: kode lama memanggil categoryIcon(slug) / resolveCategoryIcon(stored, slug).
// Ikon prioritas dari kolom DB; slug hanya fallback data lama sehingga
// rename kategori tidak ikut mengganti ikon.
export function categoryIcon(slug: string, storedIcon?: string | null): IosIconName {
  return resolveCategoryIconNameImpl(storedIcon ?? null, slug);
}

export function resolveCategoryIcon(
  storedIcon?: string | null,
  slug?: string | null,
): IosIconName {
  return resolveCategoryIconNameImpl(storedIcon ?? null, slug ?? null);
}

/**
 * BRAND_TINTS — warna khas aplikasi, dipakai konsisten untuk badge channel
 * dan tombol kontak WA/Telegram/Web di seluruh admin & storefront.
 * WhatsApp #25D366 · Telegram #229ED9 · Web/Globe cyan AXVARA · Email gold.
 */
export const BRAND_TINTS = {
  whatsapp: "#25D366",
  telegram: "#229ED9",
  web: "#00E5FF",
  email: "#FFB800",
} as const;

/**
 * ChannelBadge — badge kanal seragam iOS style: ikon + label + warna brand.
 * Dipakai di OrdersManager (tab filter + baris pesanan + dialog detail).
 */
export function ChannelBadge({
  channel,
  size = 12,
}: {
  channel: "web" | "telegram" | "whatsapp" | string;
  size?: number;
}) {
  const key = channel.toLowerCase();
  const icon: IosIconName =
    key === "whatsapp" ? "whatsapp" : key === "telegram" ? "telegram-app" : "globe";
  const label =
    key === "web" ? "Web" : key === "telegram" ? "Telegram" : key === "whatsapp" ? "WhatsApp" : channel;
  const shell =
    key === "whatsapp"
      ? "border-[#25D366]/30 bg-[#25D366]/10 text-[#5CF08A]"
      : key === "telegram"
        ? "border-[#229ED9]/30 bg-[#229ED9]/10 text-[#6FD3FF]"
        : "border-white/10 bg-white/[0.05] text-white/55";
  const tint = key === "whatsapp" ? BRAND_TINTS.whatsapp : key === "telegram" ? BRAND_TINTS.telegram : "white";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${shell}`}>
      <IosIcon name={icon} size={size} tint={tint} alt="" />
      {label}
    </span>
  );
}

/**
 * StatusBadge — badge status pesanan seragam iOS style: ikon + label + tone.
 * Pending = clock/gold · Lunas = checked/hijau · Batal/Kedaluwarsa = close/abu.
 */
export function StatusBadge({
  status,
  size = 11,
}: {
  status: string;
  size?: number;
}) {
  const key = status.toLowerCase();
  const tone =
    key === "pending"
      ? "border-[#FFB800]/25 bg-[#FFB800]/10 text-[#FFCF55]"
      : key === "lunas"
        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
        : key === "dibatalkan"
          ? "border-red-400/25 bg-red-500/10 text-red-300"
          : "border-white/10 bg-white/[0.05] text-white/45";
  const icon: IosIconName =
    key === "pending" ? "clock" : key === "lunas" ? "checked" : key === "dibatalkan" ? "close" : "info";
  const tint =
    key === "pending" ? BRAND_TINTS.email : key === "lunas" ? "#22C55E" : key === "dibatalkan" ? "#F87171" : "white";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${tone}`}>
      <IosIcon name={icon} size={size} tint={tint} alt="" />
      {status}
    </span>
  );
}

/**
 * MethodBadge — badge metode pembayaran seragam iOS style: ikon + label.
 * QRIS = qr-code/cyan · SeaBank/bank = bank/biru · E-Wallet = wallet/hijau.
 */
export function MethodBadge({
  method,
  size = 12,
}: {
  method: string;
  size?: number;
}) {
  const key = method.toLowerCase();
  const isQris = key.includes("qris");
  const isBank =
    !isQris &&
    (key.includes("seabank") ||
      key.includes("bank") ||
      key.includes("bca") ||
      key.includes("bri") ||
      key.includes("mandiri"));
  const icon: IosIconName = isQris ? "qr-code" : isBank ? "bank" : "wallet";
  const tint = isQris ? BRAND_TINTS.web : isBank ? BRAND_TINTS.telegram : BRAND_TINTS.whatsapp;
  const label = isQris ? "QRIS" : method.toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-bold uppercase text-white/60">
      <IosIcon name={icon} size={size} tint={tint} alt="" />
      {label}
    </span>
  );
}
