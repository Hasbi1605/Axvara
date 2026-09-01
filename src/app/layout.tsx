import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/storefront/Navbar";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { Spotlight } from "@/components/ui/Spotlight";
import { ToastProvider } from "@/components/ui/Toast";
import { RouteLoading } from "@/components/ui/RouteLoading";
import { PopupBanner } from "@/components/storefront/PopupBanner";
import { Suspense } from "react";

export const metadata: Metadata = {
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
    <html lang="id">
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
        </ToastProvider>
      </body>
    </html>
  );
}
