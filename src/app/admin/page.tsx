"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatRupiah } from "@/lib/utils";

type Order = {
  code: string;
  name: string;
  wa: string;
  method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number;
  status: string;
  fileName?: string;
  createdAt: string;
};

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (localStorage.getItem("axvara-admin") === "1") setAuthed(true);
    setOrders(JSON.parse(localStorage.getItem("axvara-orders") || "[]"));
  }, []);

  const login = () => {
    if (email === "admin@axvara.id" && pass === "axvara123") {
      localStorage.setItem("axvara-admin", "1");
      setAuthed(true);
    } else alert("Email atau password salah — coba admin@axvara.id / axvara123");
  };

  const setStatus = (code: string, status: string) => {
    const all: Order[] = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
    const next = all.map((o) => (o.code === code ? { ...o, status } : o));
    localStorage.setItem("axvara-orders", JSON.stringify(next));
    setOrders(next);
  };

  if (!authed) {
    return (
      <div className="mx-auto max-w-[420px] px-4 py-16">
        <div className="ax-glass rounded-[24px] p-6">
          <h1 className="font-display font-bold text-white text-xl">Admin AXVARA</h1>
          <p className="text-xs text-white/50 mt-1">Login untuk kelola produk & pesanan</p>
          <div className="mt-5 space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30" />
            <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="Password" className="w-full h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30" />
            <button onClick={login} className="w-full h-11 rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold">Masuk</button>
            <p className="text-[11px] text-white/30 text-center">Demo: admin@axvara.id / axvara123</p>
          </div>
        </div>
      </div>
    );
  }

  const pending = orders.filter((o) => o.status === "pending").length;
  const lunas = orders.filter((o) => o.status === "lunas").length;
  const omzet = orders.filter((o) => o.status === "lunas").reduce((a, b) => a + b.subtotal, 0);

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-bold text-xl text-white">Dashboard Admin</h1>
        <button onClick={() => { localStorage.removeItem("axvara-admin"); location.reload(); }} className="text-xs text-white/50 hover:text-white">Keluar</button>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="ax-glass rounded-2xl p-4">
          <p className="text-xs text-white/50">Pending</p>
          <p className="text-2xl font-display font-bold text-[#FFB800]">{pending}</p>
        </div>
        <div className="ax-glass rounded-2xl p-4">
          <p className="text-xs text-white/50">Lunas</p>
          <p className="text-2xl font-display font-bold text-[#22C55E]">{lunas}</p>
        </div>
        <div className="ax-glass rounded-2xl p-4">
          <p className="text-xs text-white/50">Omzet</p>
          <p className="text-lg font-display font-bold text-white">{formatRupiah(omzet)}</p>
        </div>
      </div>

      <div className="mt-6 ax-glass rounded-[24px] overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-semibold text-white text-sm">Pesanan Masuk</h2>
          <span className="text-xs text-white/40">{orders.length} total</span>
        </div>
        {orders.length === 0 ? (
          <p className="p-8 text-center text-sm text-white/40">Belum ada pesanan — coba checkout sebagai pembeli dulu.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {orders.slice().reverse().map((o) => (
              <div key={o.code} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-xs font-bold text-[#00E5FF]">{o.code}</p>
                  <p className="text-sm text-white">{o.name} • {o.wa}</p>
                  <p className="text-xs text-white/50">{o.items.map((i) => `${i.name} ×${i.qty}`).join(", ")} • {o.method.toUpperCase()} • {formatRupiah(o.subtotal)}</p>
                  {o.fileName && <p className="text-xs text-white/30">Bukti: {o.fileName}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${o.status === "pending" ? "bg-[#FFB800]/15 text-[#FFB800] border border-[#FFB800]/20" : o.status === "lunas" ? "bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/20" : "bg-white/10 text-white/50"}`}>{o.status}</span>
                  {o.status === "pending" && (
                    <>
                      <button onClick={() => setStatus(o.code, "lunas")} className="h-8 px-3 rounded-full bg-[#22C55E] text-white text-xs font-bold">Konfirmasi Lunas</button>
                      <button onClick={() => setStatus(o.code, "dibatalkan")} className="h-8 px-3 rounded-full ax-glass text-xs">Batalkan</button>
                      <a href={`https://wa.me/${o.wa.replace(/^0/, "62")}?text=Halo%20${encodeURIComponent(o.name)}%2C%20pesanan%20${o.code}%20kamu%20sudah%20kami%20terima.`} target="_blank" className="h-8 px-3 rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center">WA</a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 ax-glass rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-white">Konfigurasi Pembayaran</h3>
        <p className="text-xs text-white/40 mt-1">Edit di <code>src/lib/products.ts</code> atau nanti via D1 payment_methods (admin settings).</p>
        <ul className="text-xs text-white/60 mt-2 space-y-1 list-disc list-inside">
          <li>E-Wallet: 082135277434 (DANA/Gopay/Shopeepay)</li>
          <li>SeaBank: 901812349386</li>
          <li>QRIS: public/qris/axvara-qris.png — NMID ID1022191087959</li>
        </ul>
      </div>

      <p className="mt-4 text-center">
        <Link href="/" className="text-sm text-white/40 hover:text-white">← Kembali ke toko</Link>
      </p>
    </div>
  );
}
