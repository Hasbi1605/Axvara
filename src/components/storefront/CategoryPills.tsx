"use client";
import { cn } from "@/lib/utils";
import { categories } from "@/lib/products";
import { IosIcon, categoryIcon } from "@/components/ui/IosIcon";

export function CategoryPills({
  active,
  onChange,
}: {
  active: string;
  onChange: (slug: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
      {categories.map((c) => {
        const isActive = active === c.slug;
        return (
          <button
            key={c.slug}
            onClick={() => onChange(c.slug)}
            className={cn(
              "shrink-0 h-9 px-4 rounded-full text-sm font-medium border transition flex items-center gap-1.5",
              isActive
                ? "bg-white text-[#080C1E] border-white shadow"
                : "ax-glass text-white/70 hover:text-white hover:bg-white/10 border-white/10"
            )}
          >
            <IosIcon name={categoryIcon(c.slug)} size={14} className={isActive ? "opacity-100" : "opacity-70"} tint={isActive ? "black" : "white"} alt="" />
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
