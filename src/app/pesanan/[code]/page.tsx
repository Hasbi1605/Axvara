
"use client";
export const runtime = "edge";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";


type Order = {
  code: string;
  name: string;
  wa: string;
  method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  status: string;
};

export default function OrderSuccessPage() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    const all: Order[] = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
    setOrder(all.find((o) => o.code === code) || null);
  }, [code]);

  if (!order) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-white/60">Pesanan tidak ditemukan</p>
        <Link href="/" className="text-[#00E5FF] text-sm mt-3 inline-block">Kembali ke beranda</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] px-4 sm:px-6 py-10">
      <div className="ax-glass rounded-[28px] p-6 sm:p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-[#00E5FF]/15 flex items-center justify-center">
          <img src="/icons/ios11/checked-96.png" alt="" width={32} height={32} className="w-8 h-8 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)" }} draggable={false} />
        </div>
        <h1 className="mt-4 font-display font-bold text-2xl text-white">Pesanan Diterima!</h1>
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{order.code}</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#FFB800]/15 text-[#FFB800] text-xs font-semibold px-3 py-1.5 border border-[#FFB800]/20">
          <img src="/icons/ios11/clock-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)" }} draggable={false} /> Pending — Menunggu Verifikasi
        </span>
        <p className="mt-4 text-sm text-white/60 leading-6">
          Terima kasih, <span className="text-white font-medium">{order.name}</span>! Admin akan verifikasi bukti kamu dalam <span className="text-white">5–15 menit</span> dan kirim akses via WA ke <span className="text-white">{order.wa}</span>.
        </p>

        <div className="mt-6 ax-glass rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-[0.08em]">Ringkasan</p>
          <div className="mt-3 space-y-2">
            {order.items.map((it, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-white/70">{it.name} × {it.qty}</span>
                <span className="text-white font-medium">{formatRupiah(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 flex justify-between">
            <span className="text-sm text-white/60">Total • {order.method.toUpperCase()}</span>
            <span className="font-bold text-white">{formatRupiah(order.subtotal)}</span>
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Link href="/" className="flex-1 h-11 rounded-xl ax-glass font-semibold text-white flex items-center justify-center hover:bg-white/10">
            Lanjut Belanja
          </Link>
          <a
            href={`https://wa.me/6282135277434?text=Halo%20AXVARA,%20saya%20sudah%20transfer%20untuk%20pesanan%20${order.code}%20sebesar%20${encodeURIComponent(formatRupiah(order.subtotal))}`}
            target="_blank"
            className="flex-1 h-11 rounded-xl bg-[#25D366] text-white font-semibold flex items-center justify-center gap-2 hover:bg-[#1DA851]"
          >
            <img src="/icons/ios11/chat-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert" draggable={false} /> Hubungi Admin WA
          </a>
        </div>
      </div>
    </div>
  );
}
