"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IosIcon } from "@/components/ui/IosIcon";

export function MobileBottomNav() {
  const pathname = usePathname();

  // Jangan tampilkan di admin panel atau halaman checkout
  if (pathname?.startsWith("/admin") || pathname?.startsWith("/checkout")) {
    return null;
  }

  // Jika sedang di detail produk, halaman detail produk sudah memiliki bottom buy action bar sendiri
  if (pathname?.startsWith("/produk/")) {
    return null;
  }

  const navItems = [
    {
      label: "Beranda",
      href: "/",
      icon: "home" as const,
      active: pathname === "/",
    },
    {
      label: "Artikel",
      href: "/artikel",
      icon: "news" as const,
      active: pathname?.startsWith("/artikel"),
    },
    {
      label: "Cara Order",
      href: "/cara-order",
      icon: "user-manual" as const,
      active: pathname === "/cara-order",
    },
    {
      label: "Katalog",
      href: "/#katalog",
      icon: "shopping-bag" as const,
      active: false,
    },
  ];

  return (
    <nav
      aria-label="Navigasi Bawah"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080C1E]/92 backdrop-blur-xl border-t border-white/10 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.6)]"
    >
      <div className="flex items-center justify-around">
        {navItems.map((item) => {
          const content = (
            <div
              className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all duration-200 ${
                item.active
                  ? "text-[#00E5FF]"
                  : "text-white/55 hover:text-white/90 active:scale-95"
              }`}
            >
              <div className="relative flex items-center justify-center h-6 w-6">
                <IosIcon
                  name={item.icon}
                  size={20}
                  tint={item.active ? "#00E5FF" : "white"}
                  className={item.active ? "" : "opacity-55"}
                />
              </div>
              <span
                className={`mt-1 text-[10.5px] tracking-tight leading-none ${
                  item.active ? "font-bold text-[#00E5FF]" : "font-medium"
                }`}
              >
                {item.label}
              </span>
              {item.active && (
                <span className="mt-1 w-1 h-1 rounded-full bg-[#00E5FF] shadow-[0_0_4px_#00E5FF]" />
              )}
            </div>
          );

          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex-1 flex justify-center"
            >
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
