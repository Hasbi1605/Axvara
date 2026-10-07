import { Navbar } from "@/components/storefront/Navbar";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { MobileBottomNav } from "@/components/storefront/MobileBottomNav";
import { Spotlight } from "@/components/ui/Spotlight";
import { ToastProvider } from "@/components/ui/Toast";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { PopupBanner } from "@/components/storefront/PopupBanner";
import { PendingOrderReminder } from "@/components/storefront/PendingOrderReminder";
import { Suspense } from "react";
import type { Metadata } from "next";

// Layout toko pusat (2026-10-08): chrome toko yang dulu di root layout.
// Hanya berlaku untuk route (shop) — Pedia punya layout sendiri.
//
// Default metadata toko. JANGAN taruh `alternates.canonical`/`openGraph.url`
// di sini: halaman tanpa override akan mewarisinya dan menunjuk ke beranda.
const SITE_TITLE = "AXVARA — Satu tempat untuk semua tools premium";
const SITE_DESCRIPTION = "Akun premium, AI gateway, dan tools pro dengan harga jauh lebih hemat dari official. Bayar QRIS terverifikasi otomatis, bergaransi.";
const OG_IMAGE = { url: "/og/axvara-og.png", width: 1200, height: 630, alt: "AXVARA — Satu gerbang, semua tools premium" };

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "AXVARA",
    locale: "id_ID",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

// Layout toko pusat (2026-10-08): chrome toko yang dulu di root layout.
// Hanya berlaku untuk route (shop) — Pedia punya layout sendiri.
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Spotlight />
      <Navbar />
      <CartDrawer />
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <PopupBanner />
      <main className="flex-1 min-h-[50vh]">{children}</main>
      <Footer />
      <MobileBottomNav />
      <PendingOrderReminder />
    </ToastProvider>
  );
}
