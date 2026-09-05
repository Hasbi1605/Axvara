"use client";

export const runtime = "edge";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { adminWaLink, adminTelegramLink } from "@/lib/site";

type QrisInvoice = {
  payable_amount: number;
  unique_code: number;
  image_url: string;
  expires_at: string;
  status: string;
};

type Order = {
  code: string;
  name: string;
  wa: string;
  method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  status: string;
  qris?: QrisInvoice | null;
};

function fromApi(value: Record<string, unknown>): Order {
  return {
    code: String(value.code),
    name: String(value.customer_name),
    wa: String(value.customer_wa),
    method: String(value.payment_method),
    items: (value.items || []) as Order["items"],
    subtotal: Number(value.subtotal),
    status: String(value.status),
    qris: value.qris as QrisInvoice | null | undefined,
  };
}

function countdown(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function OrderSuccessPage() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchOrder = useCallback(async () => {
    if (!code || typeof code !== "string") return;
    const response = await fetch(`/api/orders?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (response.status === 404) {
      setOrder(null);
      setFetchError(null);
      return;
    }
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    setOrder(fromApi(body.order));
    setFetchError(null);
  }, [code]);

  useEffect(() => {
    setLoading(true);
    setFetchError(null);
    try {
      const all: Order[] = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
      const found = all.find((item) => item.code === code);
      if (found) setOrder(found);
    } catch { /* Server state remains authoritative. */ }
    void fetchOrder()
      .catch((error) => setFetchError(error instanceof Error ? error.message : "Gagal memuat pesanan"))
      .finally(() => setLoading(false));
  }, [code, fetchOrder]);

  const orderStatus = order?.status;
  const isDynamicQris = Boolean(order?.qris);
  useEffect(() => {
    if (orderStatus !== "pending") return;
    const interval = setInterval(() => {
      setNow(Date.now());
      void fetchOrder().catch((error) => setFetchError(error instanceof Error ? error.message : "Status terbaru gagal dimuat"));
    }, isDynamicQris ? 5_000 : 30_000);
    return () => clearInterval(interval);
  }, [orderStatus, isDynamicQris, fetchOrder]);

  useEffect(() => {
    if (!order?.qris || order.status !== "pending") return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [order?.qris, order?.status]);

  if (loading && !order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#00E5FF]" /><p className="mt-4 text-sm text-white/50">Memuat pesanan…</p></div>;
  }
  if (fetchError && !order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><p className="text-sm text-red-300">{fetchError}</p><button onClick={() => location.reload()} className="mt-3 text-sm text-[#00E5FF]">Coba lagi</button></div>;
  }
  if (!order) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center"><p className="text-white/60">Pesanan tidak ditemukan</p><Link href="/" className="mt-3 inline-block text-sm text-[#00E5FF]">Kembali ke beranda</Link></div>;
  }

  const isExpired = order.status === "kadaluarsa";
  const isPaid = order.status === "lunas";
  const isCancelled = order.status === "dibatalkan";
  const payableAmount = Number(order.qris?.payable_amount || order.subtotal);
  const statusVisual = isPaid
    ? { icon: "/icons/ios11/checked-96.png", shell: "bg-emerald-500/15", filter: "brightness(0) saturate(100%) invert(65%) sepia(51%) saturate(717%) hue-rotate(90deg)" }
    : isCancelled
      ? { icon: "/icons/ios11/close-96.png", shell: "bg-red-500/15", filter: "brightness(0) saturate(100%) invert(57%) sepia(55%) saturate(1800%) hue-rotate(322deg)" }
      : { icon: "/icons/ios11/clock-96.png", shell: isExpired ? "bg-white/10" : "bg-[#FFB800]/15", filter: isExpired ? "brightness(0) invert(1) opacity(.55)" : "brightness(0) saturate(100%) invert(72%) sepia(92%) saturate(1800%) hue-rotate(360deg)" };

  return (
    <div className="mx-auto max-w-[640px] px-4 py-10 sm:px-6">
      <div className="ax-glass-card rounded-[28px] p-6 text-center sm:p-8">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${statusVisual.shell}`}>
          <img src={statusVisual.icon} alt="" width={32} height={32} className="h-8 w-8 object-contain" style={{ filter: statusVisual.filter }} draggable={false} />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold text-white">{isPaid ? "Pembayaran Dikonfirmasi! 🎉" : isCancelled ? "Pesanan Dibatalkan" : isExpired ? "Pesanan Kedaluwarsa" : order.qris ? "Selesaikan Pembayaran QRIS" : "Pesanan Diterima!"}</h1>
        <p className="mt-2 font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{order.code}</p>
        {isPaid ? (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/20 bg-[#22C55E]/15 px-3 py-1.5 text-xs font-semibold text-[#22C55E]">Lunas — Terdeteksi Otomatis</span>
        ) : isCancelled ? (
          <span className="mt-3 inline-flex rounded-full border border-red-500/20 bg-red-500/15 px-3 py-1.5 text-xs font-semibold text-red-300">Dibatalkan</span>
        ) : isExpired ? (
          <span className="mt-3 inline-flex rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/50">Kedaluwarsa</span>
        ) : (
          <span className="mt-3 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/15 px-3 py-1.5 text-xs font-semibold text-[#FFB800]">Pending — Menunggu Pembayaran</span>
        )}

        <p className="mt-4 text-sm leading-6 text-white/60">
          {isPaid
            ? <>Pembayaran <span className="font-medium text-white">{order.name}</span> sudah diterima. Pesanan sekarang diproses.</>
            : isCancelled
              ? <>Pesanan ini dibatalkan. Hubungi admin jika kamu sudah melakukan transfer.</>
              : isExpired
                ? <>Batas pembayaran sudah habis dan stok telah dilepas. Silakan buat pesanan baru.</>
                : order.qris
                  ? <>Scan QRIS di bawah dan bayar <span className="font-semibold text-white">tepat sesuai total</span>. Status akan diperbarui otomatis.</>
                  : <>Terima kasih, <span className="font-medium text-white">{order.name}</span>! Admin akan memverifikasi bukti pembayaran dan menghubungi kamu.</>}
        </p>

        {order.qris && order.status === "pending" && (
          <section className="mt-6 rounded-2xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4" aria-label="QRIS dinamis">
            <div className="mx-auto max-w-[330px] rounded-2xl bg-white p-3">
              <img src={order.qris.image_url} alt={`QRIS dinamis pesanan ${order.code}`} className="h-auto w-full rounded-xl" />
            </div>
            <p className="mt-4 text-xs uppercase tracking-[0.12em] text-white/45">Total bayar</p>
            <p className="mt-1 font-display text-3xl font-bold text-white">{formatRupiah(payableAmount)}</p>
            <p className="mt-1 text-xs text-white/45">Termasuk kode unik <span className="font-mono text-[#00E5FF]">+{order.qris.unique_code}</span></p>
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-[#FFB800]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#FFB800]" />Berlaku {countdown(order.qris.expires_at, now)}</div>
            <a href={order.qris.image_url} download={`AXVARA-${order.code}-QRIS.png`} className="mt-4 inline-flex h-9 items-center rounded-xl border border-white/15 px-4 text-xs font-semibold text-white/70 hover:bg-white/10">Download QRIS</a>
            <p className="mt-3 text-[11px] leading-5 text-white/35">Jangan mengubah nominal. QRIS Hook DANA akan mencocokkan total secara otomatis.</p>
          </section>
        )}

        {fetchError && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-left text-xs text-amber-200">Status terbaru belum dapat diperiksa: {fetchError}</div>}

        <div className="ax-glass-card mt-6 rounded-2xl p-4 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Ringkasan</p>
          <div className="mt-3 space-y-2">{order.items.map((item, index) => <div key={index} className="flex justify-between gap-4 text-sm"><span className="text-white/70">{item.name} × {item.qty}</span><span className="font-medium text-white">{formatRupiah(item.price * item.qty)}</span></div>)}</div>
          <div className="mt-3 flex justify-between border-t border-white/10 pt-3"><span className="text-sm text-white/60">Total • {order.method.toUpperCase()}</span><span className="font-bold text-white">{formatRupiah(payableAmount)}</span></div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/" className="ax-glass-card flex h-11 flex-1 items-center justify-center rounded-xl font-semibold text-white hover:bg-white/10">Lanjut Belanja</Link>
          <a href={adminWaLink(`Halo AXVARA, saya ingin menanyakan pesanan ${order.code} sebesar ${formatRupiah(payableAmount)}`)} target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] font-semibold text-white hover:bg-[#1DA851]">WhatsApp Admin</a>
          <a href={adminTelegramLink()} target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#2AABEE] font-semibold text-white hover:bg-[#229ED9]">Telegram Admin</a>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-white/35">Produk third-party AXVARA — simpan kode pesanan untuk klaim. Garansi berupa penggantian sesuai <Link href="/garansi-replace" className="text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white">ketentuan garansi</Link>.</p>
      </div>
    </div>
  );
}
