import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/storefront/Navbar";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { Spotlight } from "@/components/ui/Spotlight";

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
        <Spotlight />
        <Navbar />
        <CartDrawer />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
