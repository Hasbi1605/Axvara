"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCart } from "@/stores/cart";
import { formatRupiah, generateOrderCode } from "@/lib/utils";
import { products } from "@/lib/products";


type Method = "qris" | "ewallet" | "bank";
type BankKey = "seabank" | "bca" | "mandiri" | "bri" | "bni";

const BANKS: { key: BankKey; label: string; no: string; holder: string; note: string; guide: string[] }[] = [
  { key: "seabank", label: "SeaBank", no: "901812349386", holder: "Brotherstore06", note: "Transfer BI-FAST / RTOL", guide: ["Buka aplikasi SeaBank / m-banking kamu", "Pilih Transfer → Antar Bank → SeaBank 801", "Masukkan 901812349386 a.n. Brotherstore06", "Transfer tepat Rp subtotal, simpan bukti"] },
  { key: "bca", label: "BCA", no: "— segara hadir", holder: "—", note: "Placeholder — akan diisi", guide: ["Buka BCA mobile / KlikBCA", "Transfer → BCA Virtual Account / Antar Rekening", "Masukkan nomor tujuan (segera diumumkan)", "Ikuti instruksi sampai selesai"] },
  { key: "mandiri", label: "Mandiri", no: "— segara hadir", holder: "—", note: "Placeholder", guide: ["Buka Livin' Mandiri", "Transfer → Rekening Mandiri / Antar Bank", "Masukkan nomor tujuan (segera diumumkan)", "Konfirmasi & simpan bukti"] },
  { key: "bri", label: "BRI", no: "— segara hadir", holder: "—", note: "Placeholder", guide: ["Buka BRImo", "Transfer → BRI / Antar Bank", "Masukkan nomor tujuan (segera diumumkan)", "Konfirmasi & simpan bukti"] },
  { key: "bni", label: "BNI", no: "— segara hadir", holder: "—", note: "Placeholder", guide: ["Buka BNI Mobile", "Transfer → Antar Rekening", "Masukkan nomor tujuan (segera diumumkan)", "Konfirmasi & simpan bukti"] },
];

export default function CheckoutPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cartItems = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);

  // Direct checkout from product card via ?buy=slug — isolate single product, not whole cart
  const buySlug = searchParams.get("buy");
  const buyProduct = buySlug ? products.find((p) => p.slug === buySlug) : null;
  const isDirect = !!buyProduct;
  const items = isDirect ? [{ ...buyProduct!, qty: 1, id: buyProduct!.id, price: buyProduct!.price, image: buyProduct!.image, name: buyProduct!.name }] : cartItems;
  const subtotal = items.reduce((a, b) => a + (b as { price: number; qty: number }).price * (b as { qty: number }).qty, 0);

  const [method, setMethod] = useState<Method | null>(null);
  const [bankKey, setBankKey] = useState<BankKey | null>(null);
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-white/60">Keranjang kosong</p>
        <a href="/#katalog" className="text-[#00E5FF] text-sm mt-3 inline-block">← Kembali belanja</a>
      </div>
    );
  }

  const copy = async (t: string, id: string) => {
    await navigator.clipboard.writeText(t);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim() || !wa.trim()) {
      setError("Nama dan No WA wajib diisi");
      return;
    }
    if (!method) {
      setError("Pilih metode pembayaran terlebih dahulu");
      return;
    }
    if (method === "bank" && !bankKey) {
      setError("Pilih bank tujuan terlebih dahulu");
      return;
    }
    if (!fileName) {
      setError("Upload bukti transfer terlebih dahulu");
      return;
    }
    setLoading(true);
    // MVP: simpan order ke localStorage (nanti ganti D1)
    const code = generateOrderCode();
    const payMethod = method === "bank" ? `bank:${bankKey}` : method!;
    const order = {
      code,
      name,
      wa,
      email,
      method: payMethod,
      items,
      subtotal,
      fileName,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const existing = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
    localStorage.setItem("axvara-orders", JSON.stringify([...existing, order]));
    if (!isDirect) clear();
    setTimeout(() => router.push(`/pesanan/${code}`), 400);
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <h1 className="font-display font-bold text-2xl text-white tracking-[-0.02em]">Checkout</h1>
      <p className="text-sm text-white/50">Isi data, pilih pembayaran, upload bukti — selesai.</p>

      <div className="mt-6 grid lg:grid-cols-[1fr_380px] gap-6">
        {/* Form */}
        <div className="ax-glass rounded-[24px] p-5 sm:p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-white">① Data Pembeli</h2>
            <div className="mt-3 grid gap-3">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama lengkap *" className="h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
              <input value={wa} onChange={(e) => setWa(e.target.value)} placeholder="No WA aktif * (08...)" className="h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (opsional)" className="h-11 px-4 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#00E5FF]/40" />
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white">② Metode Pembayaran</h2>
            <div className="mt-3 grid gap-3">
              <button onClick={() => setMethod("qris")} className={`text-left rounded-2xl border p-4 flex items-center justify-between transition ${method === "qris" ? "bg-[#00E5FF]/10 border-[#00E5FF]/40" : "ax-glass border-white/10 hover:bg-white/10"}`}>
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/qr-code-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)" }} draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white flex items-center gap-2">QRIS <span className="text-[10px] bg-[#00E5FF] text-[#080C1E] font-bold px-2 py-0.5 rounded-full">Paling Cepat</span></p>
                    <p className="text-xs text-white/45 mt-0.5">Scan untuk semua e-wallet & bank</p>
                  </div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${method === "qris" ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{method === "qris" && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
              </button>

              <button onClick={() => setMethod("ewallet")} className={`text-left rounded-2xl border p-4 flex items-center justify-between transition ${method === "ewallet" ? "bg-[#00E5FF]/10 border-[#00E5FF]/40" : "ax-glass border-white/10 hover:bg-white/10"}`}>
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/wallet-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain brightness-0 invert opacity-80" draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white">E-WALLET</p>
                    <p className="text-xs text-white/45 mt-0.5">DANA / Gopay / Shopeepay / OVO</p>
                  </div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${method === "ewallet" ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{method === "ewallet" && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
              </button>

              <button onClick={() => setMethod("bank")} className={`text-left rounded-2xl border p-4 flex items-center justify-between transition ${method === "bank" ? "bg-[#00E5FF]/10 border-[#00E5FF]/40" : "ax-glass border-white/10 hover:bg-white/10"}`}>
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/bank-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain brightness-0 invert opacity-80" draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white">TRANSFER BANK</p>
                    <p className="text-xs text-white/45 mt-0.5">SeaBank & bank lainnya</p>
                  </div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${method === "bank" ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{method === "bank" && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
              </button>
            </div>

            {/* Detail metode — hanya muncul setelah pilih, default null */}
            {method && (
              <div className="mt-4 ax-glass rounded-2xl p-4 animate-in fade-in">
                {method === "qris" && (
                  <div className="text-center">
                    <p className="text-xs text-white/50">Scan QRIS Brotherstore06 — NMID ID1022191087959 • A01</p>
                    <div className="mt-3 mx-auto w-full max-w-[300px] bg-white rounded-2xl p-2 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/qris/axvara-qris.jpg" alt="QRIS Brotherstore06 NMID ID1022191087959 A01" className="w-full h-auto rounded-xl" />
                    </div>
                    <a href="/qris/axvara-qris.jpg" download="AXVARA-QRIS-Brotherstore06.jpg" className="mt-2 inline-flex text-xs text-[#00E5FF] hover:underline">Download QRIS</a>
                    <p className="text-[11px] text-white/30 mt-1">Buka DANA/Gopay/Shopeepay → Scan → Bayar → Screenshot bukti</p>
                  </div>
                )}
                {method === "ewallet" && (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/50">Transfer ke E-Wallet</p>
                      <p className="font-mono font-bold text-white flex items-center gap-2">082135277434 <img src="/icons/ios11/wallet-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-60" draggable={false} /></p>
                      <p className="text-xs text-white/40">a.n. Brotherstore06 — DANA/Gopay/Shopeepay/OVO</p>
                      <p className="text-[11px] text-white/30 mt-1">Transfer tepat Rp subtotal & screenshot bukti.</p>
                    </div>
                    <button onClick={() => copy("082135277434", "ewallet")} className="h-9 px-4 rounded-full bg-white text-[#080C1E] text-sm font-semibold flex items-center gap-1.5 shrink-0">
                      <img src={copied === "ewallet" ? "/icons/ios11/checked-32.png" : "/icons/ios11/copy-32.png"} alt="" width={16} height={16} className="w-4 h-4 object-contain" draggable={false} /> {copied === "ewallet" ? "Disalin" : "Salin"}
                    </button>
                  </div>
                )}
                {method === "bank" && (
                  <div className="space-y-2">
                    <p className="text-xs text-white/40 mb-1">Pilih bank tujuan:</p>
                    {BANKS.map((b) => {
                      const active = bankKey === b.key;
                      const isLive = b.key === "seabank";
                      return (
                        <div key={b.key} className={`rounded-xl border overflow-hidden transition ${active ? "border-[#00E5FF]/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
                          <button onClick={() => setBankKey(b.key)} className="w-full flex items-center justify-between p-3 text-left">
                            <span className="flex items-center gap-2.5">
                              <img src="/icons/ios11/bank-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-60" draggable={false} />
                              <span>
                                <span className="text-sm font-semibold text-white flex items-center gap-2">{b.label} {!isLive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 border border-white/10">Segera</span>}</span>
                                <span className="text-xs font-mono text-white/60">{b.no}</span>
                              </span>
                            </span>
                            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{active && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
                          </button>
                          {active && (
                            <div className="px-3 pb-3 pt-1 border-t border-white/10">
                              <p className="text-xs text-white/50">a.n. {b.holder} • {b.note}</p>
                              <ol className="mt-2 space-y-1 text-xs text-white/60 list-decimal list-inside">
                                {b.guide.map((g, i) => (<li key={i}>{g}</li>))}
                              </ol>
                              {isLive && (
                                <button onClick={() => copy(b.no, b.key)} className="mt-2 h-8 px-3 rounded-full bg-white text-[#080C1E] text-xs font-semibold inline-flex items-center gap-1.5">
                                  <img src={copied === b.key ? "/icons/ios11/checked-32.png" : "/icons/ios11/copy-32.png"} alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain" draggable={false} /> {copied === b.key ? "Disalin" : "Salin No Rek"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!bankKey && <p className="text-[11px] text-white/30 text-center">Pilih salah satu bank di atas.</p>}
                    {bankKey && <p className="text-[11px] text-white/30">Bank lain placeholder — hubungi admin WA jika butuh metode lain.</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white">③ Upload Bukti Transfer *</h2>
            <label className="mt-3 flex flex-col items-center justify-center gap-2 ax-glass rounded-2xl border-dashed p-6 cursor-pointer hover:bg-white/10 transition text-center">
              <img src="/icons/ios11/upload-32.png" alt="" width={24} height={24} className="w-6 h-6 object-contain brightness-0 invert opacity-60" draggable={false} />
              <span className="text-sm text-white/70">{fileName ? fileName : "Klik untuk upload bukti (JPG/PNG, max 5MB)"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5 * 1024 * 1024) {
                    setError("File max 5MB");
                    return;
                  }
                  setFileName(f.name);
                  setError(null);
                }}
              />
            </label>
            <p className="text-[11px] text-white/30 mt-2">Pastikan bukti jelas: nominal, tanggal, dan tujuan transfer terlihat.</p>
          </div>

          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>}

          <button onClick={submit} disabled={loading} className="w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold hover:bg-[#00D0E8] disabled:opacity-50 transition">
            {loading ? "Memproses..." : `Bayar ${formatRupiah(subtotal)} — Buat Pesanan`}
          </button>
        </div>

        {/* Ringkasan */}
        <div className="ax-glass rounded-[24px] p-5 h-fit sticky top-[72px]">
          <h3 className="font-semibold text-white text-sm">Ringkasan Pesanan</h3>
          <div className="mt-4 space-y-3">
            {items.map((it) => (
              <div key={it.id} className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.image} alt={it.name} className="w-14 h-14 rounded-xl object-cover" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white leading-4 line-clamp-2">{it.name}</p>
                  <p className="text-xs text-white/50">Qty {it.qty} × {formatRupiah(it.price)}</p>
                </div>
                <span className="text-sm font-semibold text-white">{formatRupiah(it.price * it.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-white/10 flex justify-between">
            <span className="text-sm text-white/60">Total</span>
            <span className="font-display font-bold text-white text-lg">{formatRupiah(subtotal)}</span>
          </div>
          <p className="text-xs text-white/30 mt-3 text-center">Dengan membuat pesanan kamu setuju admin memverifikasi bukti secara manual.</p>
        </div>
      </div>
    </div>
  );
}
