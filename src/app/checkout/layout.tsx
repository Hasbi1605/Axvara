import type { Metadata } from "next";

// Halaman transaksi tidak untuk mesin pencari (dulu terindeks dengan judul beranda).
export const metadata: Metadata = {
  title: "Checkout | AXVARA",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
