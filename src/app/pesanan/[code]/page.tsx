
"use client";
export const runtime = "edge";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { adminWaLink, adminTelegramLink } from "@/lib/site";


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
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    // Show local data instantly for fast render
    try {
      const all: Order[] = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
      const found = all.find((o) => o.code === code);
      if (found) setOrder(found);
    } catch {}
    // ALWAYS fetch server for authoritative status
    if (!code || typeof code !== "string") { setLoading(false); return; }
    fetch(`/api/orders?code=${encodeURIComponent(String(code))}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.status === 404) {
          setOrder(null);
          setFetchError(null);
          return;
        }
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        const o = j.order;
        setOrder({ code: o.code, name: o.customer_name, wa: o.customer_wa, method: o.payment_method, items: o.items, subtotal: o.subtotal, status: o.status });
        setFetchError(null);
      })
      .catch((e) => setFetchError(e instanceof Error ? e.message : "Gagal memuat pesanan"))
      .finally(() => setLoading(false));
  }, [code]);

  // Auto-refresh for pending orders
  const orderStatus = order?.status;
  useEffect(() => {
    if (orderStatus !== "pending" || !code) return;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/orders?code=${encodeURIComponent(String(code))}`);
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.order) {
          setOrder({ code: j.order.code, name: j.order.customer_name, wa: j.order.customer_wa, method: j.order.payment_method, items: j.order.items, subtotal: j.order.subtotal, status: j.order.status });
          setFetchError(null);
        } else {
          setFetchError(j.error || `Status terbaru gagal dimuat (${r.status})`);
        }
      } catch (error) {
        setFetchError(error instanceof Error ? error.message : "Status terbaru gagal dimuat");
      }
    }, 30000);
    return () => clearInterval(id);
  }, [orderStatus, code]);

  if (loading && !order) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <div className="w-8 h-8 mx-auto rounded-full border-2 border-white/20 border-t-[#00E5FF] animate-spin" />
        <p className="text-white/50 text-sm mt-4">Memuat pesanan…</p>
      </div>
    );
  }

  if (fetchError && !order) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-red-300 text-sm">{fetchError}</p>
        <button onClick={() => location.reload()} className="mt-3 text-[#00E5FF] text-sm">Coba lagi</button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-white/60">Pesanan tidak ditemukan</p>
        <Link href="/" className="text-[#00E5FF] text-sm mt-3 inline-block">Kembali ke beranda</Link>
      </div>
    );
  }

  const statusVisual = order.status === "lunas"
    ? { icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
    : order.status === "dibatalkan"
      ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
      : { icon: "/icons/ios11/clock-96.png", shell: order.status === "kadaluarsa" ? "bg-white/10" : "bg-[#FFB800]/15", filter: order.status === "kadaluarsa" ? "brightness(0) invert(1) opacity(.55)" : "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" };

  return (
    <div className="mx-auto max-w-[640px] px-4 sm:px-6 py-10">
      <div className="ax-glass-card rounded-[28px] p-6 sm:p-8 text-center">
        <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${statusVisual.shell}`}>
          <img src={statusVisual.icon} alt="" width={32} height={32} className="w-8 h-8 object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
        </div>
        <h1 className="mt-4 font-display font-bold text-2xl text-white">{order.status === "lunas" ? "Pembayaran Dikonfirmasi! 🎉" : order.status === "dibatalkan" ? "Pesanan Dibatalkan" : order.status === "kadaluarsa" ? "Pesanan Kedaluwarsa" : "Pesanan Diterima!"}</h1>
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{order.code}</p>
        {order.status === "lunas" ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/15 text-[#22C55E] text-xs font-semibold px-3 py-1.5 border border-[#22C55E]/20">
            <img src="/icons/ios11/checked-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(60%) sepia(60%) saturate(500%) hue-rotate(100deg) brightness(1.1)" }} draggable={false} /> Lunas — Pembayaran Dikonfirmasi
          </span>
        ) : order.status === "dibatalkan" ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-red-500/15 text-red-300 text-xs font-semibold px-3 py-1.5 border border-red-500/20">
            Dibatalkan
          </span>
        ) : order.status === "kadaluarsa" ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 text-white/50 text-xs font-semibold px-3 py-1.5 border border-white/10">
            Kedaluwarsa
          </span>
        ) : (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#FFB800]/15 text-[#FFB800] text-xs font-semibold px-3 py-1.5 border border-[#FFB800]/20">
            <img src="/icons/ios11/clock-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg) brightness(1.02)" }} draggable={false} /> Pending — Menunggu Verifikasi
          </span>
        )}
        <p className="mt-4 text-sm text-white/60 leading-6">
          {order.status === "lunas"
            ? <>Pembayaran <span className="text-white font-medium">{order.name}</span> sudah dikonfirmasi. Admin akan menghubungi kamu via WA ke <span className="text-white">{order.wa}</span> untuk pengiriman produk.</>
            : order.status === "dibatalkan"
              ? <>Pesanan ini dibatalkan. Hubungi admin jika kamu sudah melakukan transfer atau memerlukan bantuan.</>
              : order.status === "kadaluarsa"
                ? <>Pesanan melewati batas pembayaran 24 jam dan stok telah dilepas kembali. Silakan buat pesanan baru.</>
                : <>Terima kasih, <span className="text-white font-medium">{order.name}</span>! Admin akan memverifikasi bukti kamu dalam <span className="text-white">5–15 menit</span> dan <span className="text-white">menghubungi kamu via WA</span> ke <span className="text-white">{order.wa}</span> untuk pengiriman produk.</>}
        </p>

        {fetchError && (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-200">
            Status terbaru belum dapat diperiksa: {fetchError}
            <button onClick={() => location.reload()} className="ml-2 font-semibold text-[#00E5FF]">Coba lagi</button>
          </div>
        )}

        <div className="mt-6 ax-glass-card rounded-2xl p-4 text-left">
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
          <Link href="/" className="flex-1 h-11 rounded-xl ax-glass-card font-semibold text-white flex items-center justify-center hover:bg-white/10">
            Lanjut Belanja
          </Link>
          <a
            href={adminWaLink(`Halo AXVARA, saya sudah transfer untuk pesanan ${order.code} sebesar ${formatRupiah(order.subtotal)}`)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 h-11 rounded-xl bg-[#25D366] text-white font-semibold flex items-center justify-center gap-2 hover:bg-[#1DA851]"
          >
            <img src="/icons/ios11/chat-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert" draggable={false} /> WhatsApp Admin
          </a>
          <a
            href={adminTelegramLink()}
            target="_blank"
            rel="noreferrer"
            className="flex-1 h-11 rounded-xl bg-[#2AABEE] text-white font-semibold flex items-center justify-center gap-2 hover:bg-[#229ED9]"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
            Telegram Admin
          </a>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-white/35">
          Produk third-party AXVARA — simpan kode pesanan ini untuk klaim. Garansi berupa penggantian sesuai{" "}
          <Link href="/garansi-replace" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">ketentuan garansi</Link>{" "}
          & deskripsi tiap produk, bukan refund otomatis.
        </p>
      </div>
    </div>
  );
}
