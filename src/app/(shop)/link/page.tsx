import type { Metadata } from "next";
import { LinkBioClient } from "./link-bio-client";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "AXVARA • Link Bio",
  description: "Semua link AXVARA: katalog web, bot Telegram auto order 24 jam, grup WhatsApp, lacak pesanan, dan bantuan admin.",
  alternates: { canonical: "/link" },
  robots: { index: true, follow: true },
};

export default function LinkBioPage() {
  return <LinkBioClient />;
}
