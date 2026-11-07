import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ketentuan Layanan & Garansi | AXVARA",
  description: "AXVARA adalah third-party independen. Pahami ketentuan garansi 1x24 jam–30 hari sebelum membeli.",
  alternates: { canonical: "/garansi-replace" },
};

export default function GaransiReplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
