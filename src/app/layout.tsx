import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/storefront/Navbar";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { MobileBottomNav } from "@/components/storefront/MobileBottomNav";
import { Spotlight } from "@/components/ui/Spotlight";
import { ToastProvider } from "@/components/ui/Toast";
import { RouteLoading } from "@/components/ui/RouteLoading";
import { PopupBanner } from "@/components/storefront/PopupBanner";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://axvara.tech"),
  title: "AXVARA — Satu tempat untuk semua tools premium",
  description: "Berbagai tools AI dan aplikasi premium dengan harga jauh lebih hemat dari official. Bergaransi.",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "AXVARA — Satu tempat untuk semua tools premium",
    description: "Berbagai tools AI dan aplikasi premium dengan harga jauh lebih hemat dari official. Bergaransi.",
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
            <RouteLoading />
          </Suspense>
          <PopupBanner />
          <main className="flex-1 min-h-[50vh]">{children}</main>
          <Footer />
          <MobileBottomNav />
        </ToastProvider>
      </body>
    </html>
  );
}
