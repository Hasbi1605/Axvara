"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/stores/cart";
import { formatRupiah } from "@/lib/utils";
import type { Product } from "@/lib/products";


type Method = "qris" | "ewallet" | "bank";

type QuotedItem = { product_id: number; variant_id?: number; name: string; price: number; qty: number; stock: number; image: string };
type QuotePaymentMethod = { id: string; label: string; account_number: string; account_name: string; qris_url: string | null };
type QuoteIssue = { product_id: number; type: string; message: string };
type PriceChange = { product_id: number; name: string; previous_price: number; current_price: number; message: string };

type DirectProduct = Product & {
  variantId?: number;
  variantLabel?: string;
};

type CatalogVariant = {
  id: number;
  label: string;
  price: number;
  stock: number;
};

function CheckoutInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cartItems = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);

  // Direct checkout from product card via ?buy=slug — fetch authoritative from D1 (B01)
  const [directProduct, setDirectProduct] = React.useState<DirectProduct | null>(null);
  const [directLoading, setDirectLoading] = React.useState(false);
  const [directError, setDirectError] = React.useState<string | null>(null);
  const buySlug = searchParams.get("buy");
  const buyVariantId = searchParams.get("variant");
  React.useEffect(() => {
    if (!buySlug) { setDirectProduct(null); setDirectError(null); return; }
    setDirectProduct(null);
    setDirectError(null);
    setDirectLoading(true);
    fetch(`/api/products?active=1&q=${encodeURIComponent(buySlug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(async (j) => {
        const found = (j.products as Product[] | undefined)?.find((p) => p.slug === buySlug);
        if (!found) throw new Error("Produk tidak ditemukan atau sedang nonaktif.");
        if (found.variantCount && found.variantCount > 0) {
          if (!buyVariantId) {
            throw new Error("Pilih varian dari halaman detail produk terlebih dahulu.");
          }
          const catRes = await fetch(`/api/catalog?slug=${encodeURIComponent(buySlug)}`);
          if (!catRes.ok) throw new Error("Pilihan varian gagal dimuat.");
          const catData = await catRes.json() as { product?: { variants?: CatalogVariant[] } };
          const variant = (catData.product?.variants || []).find((v) => String(v.id) === buyVariantId);
          if (!variant || variant.stock === 0) {
            throw new Error("Varian tidak tersedia. Pilih ulang dari halaman produk.");
          }
          setDirectProduct({
            ...found,
            price: variant.price,
            stock: variant.stock === -1 ? undefined : variant.stock,
            variantId: variant.id,
            variantLabel: variant.label,
          });
          return;
        }
        setDirectProduct(found);
      })
      .catch((error) => setDirectError(error instanceof Error ? error.message : "Gagal memuat produk."))
      .finally(() => setDirectLoading(false));
  }, [buySlug, buyVariantId]);
  const buyProduct = buySlug ? directProduct : null;
  const isDirect = Boolean(buySlug);
  const items = useMemo(
    () => isDirect
      ? (buyProduct ? [{ ...buyProduct, qty: 1, id: buyProduct.id, price: buyProduct.price, image: buyProduct.image, name: buyProduct.name, variantId: buyProduct.variantId, variantLabel: buyProduct.variantLabel }] : [])
      : cartItems,
    [isDirect, buyProduct, cartItems],
  );
  const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);

  const [method, setMethod] = useState<Method | null>(null);
  const [bankKey, setBankKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);

  // --- Fix 1: Authoritative checkout quote ---
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quotedItems, setQuotedItems] = useState<QuotedItem[]>([]);
  const [quotedSubtotal, setQuotedSubtotal] = useState(0);
  const [quotedPaymentMethods, setQuotedPaymentMethods] = useState<QuotePaymentMethod[]>([]);
  const [quoteIssues, setQuoteIssues] = useState<QuoteIssue[]>([]);
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const [quoteExpiresAt, setQuoteExpiresAt] = useState<string | null>(null);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const quoteRequestId = React.useRef(0);

  const fetchQuote = useCallback(async (quoteItems: { slug: string; variant_id?: number; qty: number; expected_price: number }[]) => {
    if (quoteItems.length === 0) return;
    const requestId = ++quoteRequestId.current;
    setQuoteLoading(true);
    setQuoteError(null);
    setQuoteIssues([]);
    setPriceChanges([]);
    setShowIssueDialog(false);
    setQuoteToken(null);
    setQuoteExpiresAt(null);
    setQuoteAccepted(false);
    setProofUrl(null);
    setFileName(null);
    try {
      const r = await fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: quoteItems }),
      });
      const j = await r.json().catch(() => ({}));
      if (requestId !== quoteRequestId.current) return;
      if (r.status === 409 && j.ok === false && Array.isArray(j.issues)) {
        setQuoteIssues(j.issues as QuoteIssue[]);
        setShowIssueDialog(true);
        setQuotedItems([]);
        setQuotedSubtotal(0);
        setQuotedPaymentMethods([]);
        return;
      }
      if (!r.ok) throw new Error(j.error || `Quote gagal (${r.status})`);
      const changes = Array.isArray(j.changes) ? j.changes as PriceChange[] : [];
      setQuotedItems(j.items ?? []);
      setQuotedSubtotal(j.subtotal ?? 0);
      setQuotedPaymentMethods(j.paymentMethods ?? []);
      setQuoteToken(j.quoteToken ?? null);
      setQuoteExpiresAt(j.quoteExpiresAt ?? null);
      setPriceChanges(changes);
      if (changes.length > 0) {
        setShowIssueDialog(true);
      } else {
        setQuoteAccepted(true);
      }
    } catch (err) {
      if (requestId !== quoteRequestId.current) return;
      setQuoteError(err instanceof Error ? err.message : "Gagal memuat harga");
    } finally {
      if (requestId === quoteRequestId.current) setQuoteLoading(false);
    }
  }, []);

  const quoteRequestItems = useMemo(
    () => items.map((item) => ({
      slug: item.slug,
      variant_id: item.variantId,
      qty: Number(item.qty) || 1,
      expected_price: Number(item.price),
    })),
    [items],
  );
  const quoteKey = JSON.stringify(quoteRequestItems);

  // Fetch quote whenever product identity, quantity, or snapshot price changes.
  useEffect(() => {
    if (items.length === 0 || directLoading) {
      quoteRequestId.current += 1;
      setQuoteLoading(false);
      setQuoteToken(null);
      setQuotedItems([]);
      setQuotedPaymentMethods([]);
      return;
    }
    void fetchQuote(quoteRequestItems);
  // quoteKey intentionally represents the complete item contract.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, directLoading, fetchQuote]);

  // Derived: payment method groups from quote
  // IDs from DB: "qris", "ewallet", "seabank", "bca", etc. — bank = anything not qris/ewallet
  const pmQris = quotedPaymentMethods.find((pm) => pm.id === "qris");
  const pmEwallet = quotedPaymentMethods.find((pm) => pm.id === "ewallet");
  const pmBanks = quotedPaymentMethods.filter((pm) => pm.id !== "qris" && pm.id !== "ewallet");

  // Display items: prefer quoted (authoritative), fallback to cart snapshot
  const displayItems = quotedItems.length > 0 ? quotedItems.map((qi) => ({ id: qi.product_id, name: qi.name, price: qi.price, qty: qi.qty, image: qi.image })) : items;
  const displaySubtotal = quotedItems.length > 0 ? quotedSubtotal : subtotal;

  if (buySlug && !directError && (directLoading || !directProduct)) {
    return <div className="mx-auto max-w-[640px] px-4 py-16 text-center text-white/60">Memuat produk…</div>;
  }
  if (buySlug && directError) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-red-300">{directError}</p>
        <Link href="/#katalog" className="mt-3 inline-block text-sm text-[#00E5FF]">Kembali ke katalog</Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <p className="text-white/60">Keranjang kosong</p>
        <Link href="/#katalog" className="text-[#00E5FF] text-sm mt-3 inline-block">← Kembali belanja</Link>
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
    setFieldErrors({});
    const fe: Record<string,string> = {};
    if (!name.trim()) fe.name = "Nama wajib diisi (min 3 karakter).";
    else if (name.trim().length < 3) fe.name = "Nama minimal 3 karakter.";
    if (!wa.trim()) fe.wa = "No WA wajib diisi.";
    else if (!/^(\+62|62|0)8\d{8,13}$/.test(wa.trim().replace(/\s|-/g,""))) fe.wa = "No WA harus format 08… atau +62… (10–15 digit).";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = "Format email tidak valid.";
    if (Object.keys(fe).length) { setFieldErrors(fe); setError("Periksa field yang ditandai."); return; }
    if (!method) {
      setError("Pilih metode pembayaran terlebih dahulu");
      return;
    }
    if (method === "bank" && !bankKey) {
      setError("Pilih bank tujuan terlebih dahulu");
      return;
    }
    const selectedPaymentId = method === "bank" ? bankKey : method;
    if (!selectedPaymentId || !quotedPaymentMethods.some((payment) => payment.id === selectedPaymentId)) {
      setError("Metode pembayaran berubah atau sudah tidak aktif. Muat ulang checkout.");
      return;
    }
    if (quoteLoading) {
      setError("Tunggu harga selesai dimuat.");
      return;
    }
    if (quoteError || !quoteToken || !quoteAccepted || quoteIssues.length > 0 || quotedItems.length === 0) {
      setError("Harga atau stok belum tervalidasi. Muat ulang checkout dan konfirmasi perubahan.");
      return;
    }
    if (method !== "qris" && !proofUrl) {
      setError("Upload bukti transfer terlebih dahulu (JPG/PNG/WebP max 5MB, wajib).");
      return;
    }
    if (proofUploading) {
      setError("Tunggu upload bukti selesai.");
      return;
    }
    if (!agreed) {
      setError("Centang persetujuan ketentuan third-party & garansi terlebih dahulu.");
      return;
    }
    setLoading(true);
    const payMethod = method === "bank" ? `bank:${bankKey}` as const : method!;
    const payloadItems = quotedItems.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      qty: item.qty,
    }));
    try {
      const r = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: name.trim(),
          customer_wa: wa.trim(),
          customer_email: email.trim() || undefined,
          items: payloadItems,
          payment_method: payMethod,
          proof_url: method === "qris" ? null : proofUrl,
          quote_token: quoteToken,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Gagal buat pesanan (${r.status})`);
      const code = j.code as string;
      // Also keep a local copy for UX fallback (pesanan page can fetch from server if local missing)
      try {
        const localOrder = { code, name, wa, email, method: payMethod, items: displayItems, subtotal: j.subtotal ?? displaySubtotal, fileName, status: "pending", createdAt: new Date().toISOString() };
        const existing = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
        localStorage.setItem("axvara-orders", JSON.stringify([...existing, localOrder]));
      } catch {}
      if (!isDirect) clear();
      router.push(`/pesanan/${code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal buat pesanan");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <h1 className="font-display font-bold text-2xl text-white tracking-[-0.02em]">Checkout</h1>
      <p className="text-sm text-white/50">Isi data, pilih pembayaran, lalu selesaikan pesanan.</p>

      <div className="mt-6 grid lg:grid-cols-[1fr_380px] gap-6">
        {/* Form */}
        <div className="ax-glass-card rounded-[24px] p-5 sm:p-6 space-y-6">
          <div>
            <h2 className="text-sm font-semibold text-white">① Data Pembeli</h2>
            <div className="mt-3 grid gap-3">
              <div>
                <label htmlFor="checkout-name" className="block text-xs font-medium text-white/60 mb-1">Nama lengkap *</label>
                <input id="checkout-name" value={name} onChange={(e) => { setName(e.target.value); setFieldErrors(f=> ({...f, name: ""})); }} placeholder="Nama lengkap" aria-invalid={!!fieldErrors.name} className={`w-full h-11 px-4 rounded-xl bg-white/[0.06] border text-sm text-white placeholder:text-white/30 focus:outline-none ${fieldErrors.name ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`} />
                {fieldErrors.name && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.name}</p>}
              </div>
              <div>
                <label htmlFor="checkout-wa" className="block text-xs font-medium text-white/60 mb-1">No WA aktif *</label>
                <input id="checkout-wa" value={wa} onChange={(e) => { setWa(e.target.value); setFieldErrors(f=> ({...f, wa: ""})); }} placeholder="08..." aria-invalid={!!fieldErrors.wa} className={`w-full h-11 px-4 rounded-xl bg-white/[0.06] border text-sm text-white placeholder:text-white/30 focus:outline-none ${fieldErrors.wa ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`} />
                {fieldErrors.wa && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.wa}</p>}
              </div>
              <div>
                <label htmlFor="checkout-email" className="block text-xs font-medium text-white/60 mb-1">Email (opsional)</label>
                <input id="checkout-email" value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors(f=> ({...f, email: ""})); }} placeholder="email@contoh.com" aria-invalid={!!fieldErrors.email} className={`w-full h-11 px-4 rounded-xl bg-white/[0.06] border text-sm text-white placeholder:text-white/30 focus:outline-none ${fieldErrors.email ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`} />
                {fieldErrors.email && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.email}</p>}
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white">② Metode Pembayaran</h2>
            {quoteLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-white/50">
                <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-[#00E5FF] animate-spin" />
                Memuat harga & metode pembayaran…
              </div>
            ) : quoteError ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2">
                <p className="text-sm text-red-300">{quoteError}</p>
                <button type="button" onClick={() => void fetchQuote(quoteRequestItems)} className="shrink-0 text-xs font-semibold text-[#00E5FF]">Coba lagi</button>
              </div>
            ) : (
              <>
            <div className="mt-3 grid gap-3">
              {pmQris && (
              <button type="button" aria-pressed={method === "qris"} onClick={() => setMethod("qris")} className={`text-left rounded-2xl border p-4 flex items-center justify-between transition ${method === "qris" ? "bg-[#00E5FF]/10 border-[#00E5FF]/40" : "ax-glass-card border-white/10 hover:bg-white/10"}`}>
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/qr-code-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(72%) sepia(68%) saturate(4000%) hue-rotate(145deg) brightness(1.05)" }} draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white flex items-center gap-2">QRIS <span className="text-[10px] bg-[#00E5FF] text-[#080C1E] font-bold px-2 py-0.5 rounded-full">Paling Cepat</span></p>
                    <p className="text-xs text-white/45 mt-0.5">Scan untuk semua e-wallet & bank</p>
                  </div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${method === "qris" ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{method === "qris" && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
              </button>
              )}

              {pmEwallet && (
              <button type="button" aria-pressed={method === "ewallet"} onClick={() => setMethod("ewallet")} className={`text-left rounded-2xl border p-4 flex items-center justify-between transition ${method === "ewallet" ? "bg-[#00E5FF]/10 border-[#00E5FF]/40" : "ax-glass-card border-white/10 hover:bg-white/10"}`}>
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/wallet-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain brightness-0 invert opacity-80" draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white">E-WALLET</p>
                    <p className="text-xs text-white/45 mt-0.5">{pmEwallet.label}</p>
                  </div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${method === "ewallet" ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{method === "ewallet" && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
              </button>
              )}

              {pmBanks.length > 0 && (
              <button type="button" aria-pressed={method === "bank"} onClick={() => setMethod("bank")} className={`text-left rounded-2xl border p-4 flex items-center justify-between transition ${method === "bank" ? "bg-[#00E5FF]/10 border-[#00E5FF]/40" : "ax-glass-card border-white/10 hover:bg-white/10"}`}>
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/bank-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain brightness-0 invert opacity-80" draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white">TRANSFER BANK</p>
                    <p className="text-xs text-white/45 mt-0.5">{pmBanks.map((b) => b.label).join(", ")}</p>
                  </div>
                </div>
                <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${method === "bank" ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{method === "bank" && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
              </button>
              )}
            </div>

            {/* Detail metode — hanya muncul setelah pilih, default null */}
            {method && (
              <div className="mt-4 ax-glass-card rounded-2xl p-4 animate-in fade-in">
                {method === "qris" && pmQris && (
                  <div className="flex items-start gap-3 text-left">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10">
                      <img src="/icons/ios11/qr-code-32.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" draggable={false} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">QRIS dinamis dibuat setelah pesanan</p>
                      <p className="mt-1 text-xs leading-5 text-white/50">Nominal unik sudah tertanam di QR. Setelah dibayar, QRIS Hook DANA mengubah status menjadi lunas otomatis—tanpa upload bukti.</p>
                    </div>
                  </div>
                )}
                {method === "ewallet" && pmEwallet && (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/50">Transfer ke E-Wallet</p>
                      <p className="font-mono font-bold text-white flex items-center gap-2">{pmEwallet.account_number} <img src="/icons/ios11/wallet-32.png" alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain brightness-0 invert opacity-60" draggable={false} /></p>
                      <p className="text-xs text-white/40">a.n. {pmEwallet.account_name}</p>
                      <p className="text-[11px] text-white/30 mt-1">Transfer tepat Rp subtotal & screenshot bukti.</p>
                    </div>
                    <button onClick={() => copy(pmEwallet.account_number, "ewallet")} className="h-9 px-4 rounded-full bg-white text-[#080C1E] text-sm font-semibold flex items-center gap-1.5 shrink-0">
                      <img src={copied === "ewallet" ? "/icons/ios11/checked-32.png" : "/icons/ios11/copy-32.png"} alt="" width={16} height={16} className="w-4 h-4 object-contain" draggable={false} /> {copied === "ewallet" ? "Disalin" : "Salin"}
                    </button>
                  </div>
                )}
                {method === "bank" && (
                  <div className="space-y-2">
                    <p className="text-xs text-white/40 mb-1">Pilih bank tujuan:</p>
                    {pmBanks.map((b) => {
                      const bKey = b.id.replace("bank:", "");
                      const active = bankKey === bKey;
                      return (
                        <div key={b.id} className={`rounded-xl border overflow-hidden transition ${active ? "border-[#00E5FF]/40 bg-white/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
                          <button onClick={() => setBankKey(bKey)} className="w-full flex items-center justify-between p-3 text-left">
                            <span className="flex items-center gap-2.5">
                              <img src="/icons/ios11/bank-32.png" alt="" width={16} height={16} className="w-4 h-4 object-contain brightness-0 invert opacity-60" draggable={false} />
                              <span>
                                <span className="text-sm font-semibold text-white">{b.label}</span>
                                <span className="text-xs font-mono text-white/60 ml-2">{b.account_number}</span>
                              </span>
                            </span>
                            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? "border-[#00E5FF] bg-[#00E5FF]" : "border-white/20"}`}>{active && <span className="w-2 h-2 rounded-full bg-[#080C1E]" />}</span>
                          </button>
                          {active && (
                            <div className="px-3 pb-3 pt-1 border-t border-white/10">
                              <p className="text-xs text-white/50">a.n. {b.account_name}</p>
                              <button onClick={() => copy(b.account_number, b.id)} className="mt-2 h-8 px-3 rounded-full bg-white text-[#080C1E] text-xs font-semibold inline-flex items-center gap-1.5">
                                <img src={copied === b.id ? "/icons/ios11/checked-32.png" : "/icons/ios11/copy-32.png"} alt="" width={14} height={14} className="w-3.5 h-3.5 object-contain" draggable={false} /> {copied === b.id ? "Disalin" : "Salin No Rek"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!bankKey && <p className="text-[11px] text-white/30 text-center">Pilih salah satu bank di atas.</p>}
                  </div>
                )}
              </div>
            )}
              </>
            )}
            {quoteToken && quoteExpiresAt && (
              <p className="mt-3 text-[11px] text-emerald-300/70">Harga dan rekening dikunci selama 60 menit untuk pesanan ini.</p>
            )}
          </div>

          {method === "qris" ? (
            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
              <h2 className="text-sm font-semibold text-emerald-300">③ Verifikasi Otomatis</h2>
              <p className="mt-1 text-xs leading-5 text-white/50">QRIS dan total bayar akan muncul di halaman pesanan. Biarkan halaman terbuka; status diperbarui otomatis setelah notifikasi DANA diterima.</p>
            </div>
          ) : (
          <div>
            <h2 className="text-sm font-semibold text-white">③ Upload Bukti Transfer *</h2>
            <label className={`mt-3 flex flex-col items-center justify-center gap-2 ax-glass-card rounded-2xl border-dashed p-6 cursor-pointer transition text-center ${proofUploading ? "opacity-60 pointer-events-none" : "hover:bg-white/10"}`}>
              <img src="/icons/ios11/upload-32.png" alt="" width={24} height={24} className="w-6 h-6 object-contain brightness-0 invert opacity-60" draggable={false} />
              <span className="text-sm text-white/70">{proofUploading ? "Mengupload..." : fileName ? fileName : "Klik untuk upload bukti (JPG/PNG/WebP, max 5MB)"}</span>
              {proofUrl && <span className="text-[11px] text-emerald-300">✓ Terupload</span>}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setProofUrl(null);
                  setFileName(null);
                  setError(null);
                  if (f.size > 5 * 1024 * 1024) { setError("File max 5MB"); e.target.value = ""; return; }
                  if (!["image/jpeg","image/jpg","image/png","image/webp"].includes(f.type)) { setError("Hanya JPG/PNG/WebP"); e.target.value = ""; return; }
                  setFileName(f.name);
                  setProofUploading(true);
                  try {
                    const fd = new FormData();
                    fd.append("file", f);
                    const r = await fetch("/api/proof/upload", { method: "POST", body: fd });
                    const j = await r.json().catch(()=> ({}));
                    if (!r.ok) throw new Error(j.error || `Upload gagal (${r.status})`);
                    setProofUrl(j.url);
                  } catch (err) { setError(err instanceof Error ? err.message : "Upload gagal"); setFileName(null); setProofUrl(null); }
                  finally { setProofUploading(false); }
                  e.target.value = "";
                }}
              />
            </label>
            <p className="text-[11px] text-white/30 mt-2">Pastikan bukti jelas: nominal, tanggal, dan tujuan transfer terlihat. Upload dulu sebelum buat pesanan.</p>
          </div>
          )}

          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>}

          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left">
            <input
              id="checkout-agree"
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]"
            />
            <span className="text-xs leading-5 text-white/60">
              Saya paham AXVARA adalah <span className="font-semibold text-white">third-party independen, bukan official store</span>, dan saya setuju dengan{" "}
              <Link href="/garansi-replace" target="_blank" rel="noreferrer" className="font-semibold text-[#00E5FF] hover:underline">ketentuan layanan & garansi</Link>{" "}
              serta ketentuan di deskripsi tiap produk. <span className="font-semibold text-white">DYOR, DWYOR.</span>
            </span>
          </label>

          <button onClick={submit} disabled={loading || proofUploading || (method !== "qris" && !proofUrl) || quoteLoading || !method || !quoteToken || !quoteAccepted || quoteIssues.length > 0 || !agreed} className="w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold hover:bg-[#00D0E8] disabled:opacity-60 transition inline-flex items-center justify-center gap-2">
            {loading && <span className="w-5 h-5 rounded-full border-2 border-[#080C1E]/20 border-t-[#080C1E] animate-spin" />}
            {loading ? "Memproses…" : `Bayar ${formatRupiah(displaySubtotal)} — Buat Pesanan`}
          </button>
        </div>

        {/* Ringkasan */}
        <div className="ax-glass-card rounded-[24px] p-5 h-fit sticky top-[72px]">
          <h3 className="font-semibold text-white text-sm">Ringkasan Pesanan</h3>
          {quoteLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-white/50">
              <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-[#00E5FF] animate-spin" />
              Memuat…
            </div>
          ) : (
          <>
          <div className="mt-4 space-y-3">
            {displayItems.map((it) => (
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
            <span className="font-display font-bold text-white text-lg">{formatRupiah(displaySubtotal)}</span>
          </div>
          </>
          )}
          <p className="text-xs text-white/30 mt-3 text-center">QRIS diverifikasi otomatis; transfer manual tetap ditinjau admin.</p>
        </div>
      </div>

      {/* Price-change / stock issue dialog */}
      {showIssueDialog && (quoteIssues.length > 0 || priceChanges.length > 0) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-labelledby="quote-change-title">
          <div className="ax-glass-card rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 id="quote-change-title" className="text-white font-semibold text-base">Perubahan Harga / Stok</h3>
            <p className="text-sm text-white/60">Beberapa item berubah sejak kamu menambahkannya:</p>
            <ul className="space-y-2">
              {quoteIssues.map((issue, i) => (
                <li key={i} className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">{issue.message}</li>
              ))}
              {priceChanges.map((change) => (
                <li key={change.product_id} className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                  {change.name}: {formatRupiah(change.previous_price)} → {formatRupiah(change.current_price)}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              {quoteIssues.length === 0 && priceChanges.length > 0 && (
                <button onClick={() => { setShowIssueDialog(false); setQuoteAccepted(true); }} className="flex-1 h-10 rounded-xl bg-[#00E5FF] text-[#080C1E] font-semibold text-sm">Setujui harga baru</button>
              )}
              <button onClick={() => { setShowIssueDialog(false); router.push("/#katalog"); }} className="flex-1 h-10 rounded-xl border border-white/20 text-white/70 text-sm">Kembali belanja</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <React.Suspense fallback={<div className="mx-auto max-w-[640px] px-4 py-16 text-center text-white/60">Memuat checkout…</div>}>
      <CheckoutInner />
    </React.Suspense>
  );
}
