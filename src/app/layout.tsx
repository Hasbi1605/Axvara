import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
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

// Cross-platform type: Inter (body, ClearType-hinted for Windows) +
// Space Grotesk (display/harga) + JetBrains Mono (kode pesanan).
// Self-hosted via next/font (display:swap, latin only) — di iOS/Mac
// tetap terasa iOS-clean, di Chrome Windows tidak lagi jatuh ke Arial.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-ax-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-ax-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-ax-mono",
  display: "swap",
});

// Default seluruh situs. JANGAN taruh `alternates.canonical`/`openGraph.url`
// di sini: halaman tanpa override akan mewarisinya dan menunjuk ke beranda.
const SITE_TITLE = "AXVARA — Satu tempat untuk semua tools premium";
const SITE_DESCRIPTION = "Akun premium, AI gateway, dan tools pro dengan harga jauh lebih hemat dari official. Bayar QRIS terverifikasi otomatis, bergaransi.";
const OG_IMAGE = { url: "/og/axvara-og.png", width: 1200, height: 630, alt: "AXVARA — Satu gerbang, semua tools premium" };

export const metadata: Metadata = {
  metadataBase: new URL("https://axvara.tech"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "AXVARA",
  icons: { icon: "/favicon.svg" },
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen flex flex-col">
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
      </body>
    </html>
  );
}
