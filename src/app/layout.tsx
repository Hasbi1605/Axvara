import type { Metadata } from "next";
// 2026-10-12: self-hosted variable fonts (public/fonts) via next/font/local.
// next/font/google fetch CSS Google saat build — gagal di CI bila runner tak
// bisa akses fonts.googleapis.com (TypeError null reading '1' di loader.js).
// File = variable font resmi Google (latin), weight direntang penuh.
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({ src: "../../public/fonts/inter-var-latin.woff2", variable: "--font-ax-sans", display: "swap" });
const spaceGrotesk = localFont({ src: "../../public/fonts/space-grotesk-var-latin.woff2", variable: "--font-ax-display", display: "swap" });
const jetbrainsMono = localFont({ src: "../../public/fonts/jetbrains-mono-var-latin.woff2", variable: "--font-ax-mono", display: "swap", preload: false });

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
