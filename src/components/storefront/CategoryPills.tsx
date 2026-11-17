"use client";
import { cn } from "@/lib/utils";
import { categories as fallbackCategories } from "@/lib/products";
import type { OrderableCategory } from "@/lib/product-order";
import { IosIcon, categoryIcon } from "@/components/ui/IosIcon";
import { useEffect, useState } from "react";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { marketCategoryName } from "@/lib/i18n/market-categories";

export function CategoryPills({ active, onChange, categories }: {
  active: string;
  onChange: (slug: string) => void;
  categories?: OrderableCategory[];
}) {
  const [fallback, setFallback] = useState<OrderableCategory[]>(fallbackCategories);
  const locale = useDisplayLocale();
  useEffect(() => {
    if (categories) return;
    const controller = new AbortController();
    fetch("/api/categories", { signal: controller.signal }).then(r => r.json()).then(body => {
      if (Array.isArray(body.categories)) setFallback(body.categories);
    }).catch(() => {});
    return () => controller.abort();
  }, [categories]);
  const items = [{ id: "all", slug: "semua", name: "Semua", icon: "star" }, ...(categories ?? fallback).filter(category => category.slug !== "semua")];
  return (
    <div className="relative flex gap-1.5 sm:gap-2 overflow-x-auto py-2 scrollbar-none" aria-label={locale === "en" ? "Product categories" : "Kategori produk"}>
      {items.map(category => {
        const selected = active === category.slug;
        return <button key={category.slug} data-category={category.slug} aria-pressed={selected} onClick={() => onChange(category.slug)} className={cn(
          "shrink-0 h-6 sm:h-9 px-2 sm:px-4 rounded-full text-[10px] sm:text-sm font-medium border transition flex items-center gap-1 sm:gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF]",
          selected ? "bg-white text-[#080C1E] border-white shadow" : "ax-glass-card text-white/70 hover:text-white hover:bg-white/10 border-white/10",
        )}>
          <span aria-hidden="true"><IosIcon name={categoryIcon(category.slug, category.icon)} size={10} className="sm:!w-3.5 sm:!h-3.5" tint={selected ? "black" : "white"} alt="" /></span>
          {category.slug === "semua" ? (locale === "en" ? "All" : "Semua") : marketCategoryName(category.slug, locale, category.name)}
        </button>;
      })}
    </div>
  );
}
