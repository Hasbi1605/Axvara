import { Suspense } from "react";
import LacakPesananClient from "./lacak-pesanan-client";

export const runtime = "edge";

export const metadata = {
  title: "Lacak Pesanan | AXVARA",
  description: "Cek status pesanan AXVARA hanya dengan kode pesanan dan nomor WA — Pending, Lunas, Dibatalkan, atau Kedaluwarsa.",
  alternates: { canonical: "/lacak-pesanan" },
};

export default function LacakPesananPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[720px] px-4 py-16 text-center text-white/60">Memuat pelacakan…</div>}>
      <LacakPesananClient />
    </Suspense>
  );
}
