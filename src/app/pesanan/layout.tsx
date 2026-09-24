import type { Metadata } from "next";

// Tiap kode pesanan adalah URL pribadi pembeli: jangan pernah diindeks.
export const metadata: Metadata = {
  title: "Status Pesanan | AXVARA",
  robots: { index: false, follow: false },
};

export default function PesananLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
