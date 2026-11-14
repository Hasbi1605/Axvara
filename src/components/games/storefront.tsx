"use client";
import Link from "next/link";
import { CreditCard, Gamepad2, IdCard, Sparkles } from "lucide-react";
import type { GamesCatalogGame, GamesDetail } from "@/lib/games/catalog";
import { gamesCopy } from "@/lib/games/copy";
import { GameImage } from "./GameImage";

export const gamesFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#00E5FF]";
export type CatalogGame = Omit<GamesCatalogGame, "min_price"> & { min_price: number | null; sellable_count?: number; featured_rank?: number | null };
export type Category = "bestseller" | "special" | "promo" | "first_topup" | "pass" | "pack" | "topup" | "other";
export type StoreProduct = GamesDetail["products"][number] & { type_label?: string | null; region_code?: string | null; category?: Category; validation_available?: boolean };
export type StoreGame = GamesDetail["game"] & { description?: string | null; id_guide?: string | null };

// TEMP until G-BE merge: replace these presentation fallbacks with variant-kind exports.
export const CATEGORIES: Category[] = ["bestseller", "special", "promo", "first_topup", "pass", "pack", "topup", "other"];
const countries: Record<string, [string, string]> = {
  indonesia: ["Indonesia", "ID"], philippines: ["Filipina", "PH"], filipina: ["Filipina", "PH"],
  russia: ["Rusia", "RU"], rusia: ["Rusia", "RU"], turkey: ["Turki", "TR"], turki: ["Turki", "TR"],
  singapore: ["Singapura", "SG"], singapura: ["Singapura", "SG"], brazil: ["Brasil", "BR"], brasil: ["Brasil", "BR"],
  malaysia: ["Malaysia", "MY"], global: ["Global", "GLOBAL"],
};
export function typeLabel(product: StoreProduct) {
  if (product.type_label !== undefined) return product.type_label;
  const raw = product.product_type_name?.trim();
  return !raw || raw.toUpperCase() === "DIGITAL" ? null : countries[raw.toLowerCase()]?.[0] ?? raw;
}
export function regionCode(product: StoreProduct) {
  return product.region_code !== undefined ? product.region_code : countries[typeLabel(product)?.toLowerCase() ?? ""]?.[1] ?? null;
}
export function categoryOf(product: StoreProduct): Category {
  if (product.category && CATEGORIES.includes(product.category)) return product.category;
  if (CATEGORIES.includes(product.group as Category)) return product.group as Category;
  const name = product.name;
  if (/first top ?up|top ?up pertama|isi ulang pertama|double diamond/i.test(name)) return "first_topup";
  if (/weekly|twilight|starlight|startlight|\bpass\b|member|wdp/i.test(name)) return "pass";
  if (/\bpack\b|bundle|elite|epic|paket/i.test(name)) return "pack";
  if (!/gift|voucher/i.test(name) && /\d/.test(name) && /diamond|uc\b|vp\b|crystal|genesis|token|coin|cp\b|gold|gem|point|shell|primogem|oneiric|candy|robux/i.test(name)) return "topup";
  return "other";
}
export const cleanFieldLabel = (label: string) => label.trim().replace(/[\s:]+$/, "");
export const nicknameRegion = (nickname: string) => nickname.match(/\(([A-Z]{2})\)\s*$/i)?.[1].toUpperCase() ?? null;
// Old list responses lack stock/contract data: do not invent sellability from a price.
export const sellableCount = (game: CatalogGame) => game.sellable_count ?? 0;

export function GameCard({ game, t }: { game: CatalogGame; t: ReturnType<typeof gamesCopy> }) {
  const sellable = sellableCount(game) > 0 && game.min_price !== null;
  return <Link href={`/games/${game.slug}`} className={`group min-w-0 rounded-2xl ${!sellable ? "opacity-70" : ""} ${gamesFocus}`}>
    <GameImage src={game.icon} name={game.name} className="aspect-square w-full rounded-2xl border border-white/10 text-2xl" imageClassName="transition duration-300 group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none" />
    <span className="mt-3 block truncate font-display text-sm font-bold text-white sm:text-base">{game.name}</span>
    {sellable ? <span className="mt-1 block text-xs tabular-nums text-white/80">{t.startingAt} <span className="font-display">Rp{game.min_price!.toLocaleString("id-ID")}</span></span>
      : <span className="mt-1 inline-block rounded-full bg-white/5 px-2 py-1 text-[11px] text-white/55">{t.comingSoon}</span>}
  </Link>;
}

export function HowToTopUp({ t }: { t: ReturnType<typeof gamesCopy> }) {
  const icons = [Gamepad2, IdCard, CreditCard, Sparkles];
  return <section><h2 className="font-display text-2xl font-bold">{t.how}</h2><p className="mt-2 text-sm text-white/55">{t.howSub}</p>
    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">{t.steps.map((step, i) => { const Icon = icons[i]; return <div key={step} className="ax-glass rounded-2xl border border-white/10 p-5"><Icon size={20} strokeWidth={1.75} className="text-[#00E5FF]" /><span className="mt-6 block text-xs text-[#FFB800]">0{i + 1}</span><h3 className="mt-2 font-display text-sm font-bold sm:text-base">{step}</h3><p className="mt-2 text-xs leading-5 text-white/60">{t.stepDescriptions[i]}</p></div>; })}</div>
  </section>;
}
