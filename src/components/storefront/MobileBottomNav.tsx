"use client";

// Bottom nav mobile (revisi 2026-09-25, keputusan owner): Beranda · Keranjang ·
// Pesanan · Bantuan. Dulu Beranda dan "Katalog" (/#katalog, halaman yang
// sama) memakan dua slot, Artikel satu slot, dan Cara Order satu slot.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IosIcon, type IosIconName } from "@/components/ui/IosIcon";
import { HelpSheet } from "@/components/storefront/HelpSheet";
import { useCart } from "@/stores/cart";
import { LOCAL_ORDERS_EVENT, LOCAL_ORDERS_KEY, freshPendingCodes } from "@/lib/local-orders";

const HELP_ROUTES = ["/cara-order", "/garansi-replace", "/artikel"];

type NavItem = {
  label: string;
  icon: IosIconName;
  active: boolean;
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  badge?: number;
  dot?: boolean;
  dialog?: boolean;
};

export function MobileBottomNav() {
  const pathname = usePathname() ?? "/";
  const cartLines = useCart((s) => s.items.length);
  const drawerOpen = useCart((s) => s.drawerOpen);
  const setDrawer = useCart((s) => s.setDrawer);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  // Keranjang & pesanan lokal baru dibaca setelah mount: HTML server tidak
  // tahu isi localStorage, jadi badge/titik tidak boleh ikut render pertama.
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const check = () => setHasPending(freshPendingCodes(Date.now()).length > 0);
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === LOCAL_ORDERS_KEY) check(); };
    check();
    window.addEventListener(LOCAL_ORDERS_EVENT, check);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener(LOCAL_ORDERS_EVENT, check);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", check);
    };
  }, [pathname]);

  useEffect(() => { setHelpOpen(false); }, [pathname]);

  // Admin & checkout tanpa nav; PDP punya bar beli sendiri.
  if (pathname.startsWith("/admin") || pathname.startsWith("/checkout") || pathname.startsWith("/produk/")) {
    return null;
  }

  const cartCount = mounted ? cartLines : 0;
  const pendingDot = mounted && hasPending;
  const navItems: NavItem[] = [
    { label: "Beranda", href: "/", icon: "home", active: pathname === "/" },
    {
      label: "Keranjang",
      icon: "shopping-bag",
      active: drawerOpen,
      onClick: () => setDrawer(true),
      badge: cartCount,
      ariaLabel: cartCount > 0 ? `Keranjang, ${cartCount} barang` : "Keranjang",
    },
    {
      label: "Pesanan",
      href: "/lacak-pesanan",
      icon: "purchase-order",
      active: pathname.startsWith("/lacak-pesanan") || pathname.startsWith("/pesanan"),
      dot: pendingDot,
      ariaLabel: pendingDot ? "Pesanan, ada pesanan belum dibayar" : "Pesanan",
    },
    {
      label: "Bantuan",
      icon: "chat",
      active: helpOpen || HELP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`)),
      onClick: () => setHelpOpen(true),
      dialog: true,
    },
  ];

  return (
    <>
      <nav
        aria-label="Navigasi Bawah"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080C1E]/92 backdrop-blur-xl border-t border-white/10 px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.6)]"
      >
        <div className="flex items-center justify-around">
          {navItems.map((item) => {
            const content = (
              <span
                className={`flex flex-col items-center justify-center py-1 px-2.5 rounded-xl transition-all duration-200 ${
                  item.active ? "text-[#00E5FF]" : "text-white/55 hover:text-white/90 active:scale-95"
                }`}
              >
                <span aria-hidden className="relative flex items-center justify-center h-6 w-6">
                  <IosIcon
                    name={item.icon}
                    size={20}
                    tint={item.active ? "#00E5FF" : "white"}
                    className={item.active ? "" : "opacity-55"}
                  />
                  {item.badge ? (
                    <span aria-hidden className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FFB800] text-[#080C1E] text-[10px] font-bold leading-[18px] text-center">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
                  {item.dot ? (
                    <span aria-hidden className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-[#FFB800] ring-2 ring-[#080C1E]" />
                  ) : null}
                </span>
                <span className={`mt-1 text-[10.5px] tracking-tight leading-none ${item.active ? "font-bold text-[#00E5FF]" : "font-medium"}`}>
                  {item.label}
                </span>
                {item.active && <span aria-hidden className="mt-1 w-1 h-1 rounded-full bg-[#00E5FF] shadow-[0_0_4px_#00E5FF]" />}
              </span>
            );
            return item.href ? (
              <Link
                key={item.label}
                href={item.href}
                aria-label={item.ariaLabel}
                aria-current={item.active ? "page" : undefined}
                className="flex-1 flex justify-center"
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                aria-label={item.ariaLabel}
                aria-haspopup={item.dialog ? "dialog" : undefined}
                aria-expanded={item.dialog ? helpOpen : undefined}
                className="flex-1 flex justify-center"
              >
                {content}
              </button>
            );
          })}
        </div>
      </nav>
      {helpOpen && <HelpSheet onClose={() => setHelpOpen(false)} />}
    </>
  );
}
