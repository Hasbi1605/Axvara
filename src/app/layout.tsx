import type { Metadata } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-ax-sans", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-ax-display", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-ax-mono", display: "swap", preload: false });

// Root layout MINIMAL (2026-10-08, PEDIA §9.2): font + metadata global saja.
// Navbar/Footer toko ada di (shop)/layout; Pedia punya pedia/layout sendiri.
// Anak route TIDAK mewarisi chrome satu sama lain.
//
// JANGAN taruh OG/Canonical toko di sini (dahulu ada di root sebelum
// pemisahan): akan diwarisi Pedia. Metadata toko ada di (shop)/layout.
const SITE_TITLE = "AXVARA";
const SITE_DESCRIPTION = "Akun premium, AI gateway, dan tools pro dengan harga jauh lebih hemat dari official.";

export const metadata: Metadata = {
  metadataBase: new URL("https://axvara.tech"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "AXVARA",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen flex flex-col">{children}</body>
    </html>
  );
}
