import type { Metadata } from "next";
import { Suspense } from "react";
import { WaHubClient } from "./wa-hub-client";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "AXVARA • Chat WhatsApp Admin",
  description: "Pilih nomor WhatsApp admin AXVARA yang aktif — AXVARA 1, 2, atau 3.",
  alternates: { canonical: "/wa" },
  robots: { index: false, follow: false },
};

export default function WaHubPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[480px] px-5 py-16 text-center text-white/60">Memuat…</div>}>
      <WaHubClient />
    </Suspense>
  );
}
