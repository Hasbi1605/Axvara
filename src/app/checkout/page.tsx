"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/stores/cart";
import { formatRupiah } from "@/lib/utils";
import type { Product } from "@/lib/products";


type Method = "qris" | "ewallet" | "bank";

type QuotedItem = { product_id: number; variant_id?: number; name: string; price: number; qty: number; stock: number; image: string; queued_delivery?: boolean };
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
  min_qty?: number;
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
  // Qty dari PDP stepper (?qty=) ala marketplace. Tanpa param = 1 (perilaku
  // lama). Selalu di-clamp server oleh quote — ini hanya preferensi awal.
  const buyQtyRaw = searchParams.get("qty");
  const buyQty = (() => {
    const n = Math.floor(Number(buyQtyRaw));
    return Number.isFinite(n) && n >= 1 ? Math.min(100, n) : 1;
  })();
  React.useEffect(() => {
    if (!buySlug) { setDirectProduct(null); setDirectError(null); return; }
    setDirectProduct(null);
    setDirectError(null);
    setDirectLoading(true);
    // Exact slug (issue #14): sebelumnya q=slug memindai seluruh katalog
    // lewat LIKE; kini filter slug exact di server (1 baris).
    fetch(`/api/products?active=1&slug=${encodeURIComponent(buySlug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(async (j) => {
        const found = (j.products as Product[] | undefined)?.[0];
        if (!found || found.slug !== buySlug) throw new Error("Produk tidak ditemukan atau sedang nonaktif.");
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
            minQty: Math.max(1, Number(variant.min_qty ?? 1) || 1),
          } as DirectProduct & { minQty: number });
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
      ? (buyProduct ? [{ ...buyProduct, qty: buyQty, id: buyProduct.id, price: buyProduct.price, image: buyProduct.image, name: buyProduct.name, variantId: buyProduct.variantId, variantLabel: buyProduct.variantLabel, minQty: (buyProduct as { minQty?: number }).minQty }] : [])
      : cartItems,
    [isDirect, buyProduct, buyQty, cartItems],
  );
  const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
  // Beli Langsung kini membawa qty stepper PDP (?qty=), jadi quote
  // below_minimum hanya untuk keranjang lama di bawah min — tawarkan
  // penyesuaian inline ke min (ala Shopee: server authoritative, frontend
  // menjelaskan penyesuaian), bukan dead-end "kembali belanja".
  const directMinQty = isDirect && buyProduct ? Math.max(1, Number((buyProduct as { minQty?: number }).minQty ?? 1) || 1) : 1;

  // Maintenance sementara (2026-09-17): jalur manual E-Wallet/Bank
  // dinonaktifkan, QRIS saja. Field tetap tampil tapi disabled + badge
  // Maintenance di WEB; upload bukti disembunyikan. Backend (/api/orders)
  // menolak non-QRIS dengan 503 agar tidak bisa di-bypass client.
  const MANUAL_PAYMENTS_MAINTENANCE = true;
  const [method, setMethod] = useState<Method | null>(null);
  const [name, setName] = useState("");
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
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
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  // Email wajib? (migrasi 0033): true bila keranjang berisi varian WR
  // Invite/Link atau produk require_email=1. Dihitung server di quote agar
  // tidak bisa diakali client; form + API menegakkan sebelum bayar.
  const [emailRequired, setEmailRequired] = useState(false);
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
    setQuoteAccepted(false);
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
      setEmailRequired(j.emailRequired === true);
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
  // Cart store (untuk penyesuaian inline min): Beli Langsung tidak pakai
  // store, jadi penyesuaian di bawah hanya untuk mode keranjang.
  const setQty = useCart((s) => s.setQty);
  // below_minimum hanya dari keranjang lama di bawah min: tawarkan naikkan
  // ke min inline (qty + refetch quote), bukan dead-end.
  const belowMinIssues = quoteIssues.filter((i) => i.type === "below_minimum");
  const adjustToMinimum = () => {
    for (const issue of belowMinIssues) {
      const target = items.find((it) => Number(it.id) === Number(issue.product_id));
      if (!target) continue;
      const m = Math.floor(Number(issue.message.match(/minimal pembelian (\d+)/)?.[1] ?? 0));
      if (m > target.qty) setQty(target.id, m, target.variantId);
    }
    setShowIssueDialog(false);
  };

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
  // Nama produk yang dikerjakan sesuai antrean (dari quote server, bukan
  // tebakan client) — dipakai untuk peringatan waktu sebelum bayar.
  const queuedNames = quotedItems.filter((qi) => qi.queued_delivery === true).map((qi) => qi.name);
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

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    const fe: Record<string,string> = {};
    if (!name.trim()) fe.name = "Nama wajib diisi (min 3 karakter).";
    else if (name.trim().length < 3) fe.name = "Nama minimal 3 karakter.";
    if (!wa.trim()) fe.wa = "No WA wajib diisi.";
    else if (!/^(\+62|62|0)8\d{8,13}$/.test(wa.trim().replace(/\s|-/g,""))) fe.wa = "No WA harus format 08… atau +62… (10–15 digit).";
    // Email wajib bila keranjang butuh (Invite/Link WR atau produk
    // require_email): tanpa email valid, API menolak 422 dan WR 422 —
    // order lunas tanpa email = macet. Minta SEBELUM bayar.
    if (emailRequired && !email.trim()) fe.email = "Produk ini dikirim via email invite — tulis email aktif sebelum bayar.";
    else if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = "Format email tidak valid.";
    if (Object.keys(fe).length) { setFieldErrors(fe); setError("Periksa field yang ditandai."); return; }
    if (!method) {
      setError("Pilih metode pembayaran terlebih dahulu");
      return;
    }
    // Maintenance: jalur manual tidak bisa dipilih (button disabled), tapi
    // jaga lapis client bila state lama tersisa.
    if (MANUAL_PAYMENTS_MAINTENANCE && method !== "qris") {
      setError("E-Wallet & Transfer Bank sedang maintenance. Silakan bayar via QRIS.");
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
    if (!agreed) {
      setError("Centang persetujuan ketentuan third-party & garansi terlebih dahulu.");
      return;
    }
    setLoading(true);
    const payMethod = "qris" as const;
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
          proof_url: null,
          quote_token: quoteToken,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Gagal buat pesanan (${r.status})`);
      const code = j.code as string;
      // Also keep a local copy for UX fallback (pesanan page can fetch from server if local missing)
      try {
        const localOrder = { code, name, wa, email, method: payMethod, items: displayItems, subtotal: j.subtotal ?? displaySubtotal, fileName: null, status: "pending", createdAt: new Date().toISOString() };
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
                <label htmlFor="checkout-email" className="block text-xs font-medium text-white/60 mb-1">Email {emailRequired ? "(wajib — produk ini dikirim via email)" : "(opsional)"}</label>
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
              <div
                role="button"
                aria-disabled="true"
                aria-label="E-Wallet sedang maintenance"
                title="E-Wallet sedang maintenance"
                className="text-left rounded-2xl border p-4 flex items-center justify-between transition ax-glass-card border-white/10 opacity-50 cursor-not-allowed select-none"
              >
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/wallet-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain brightness-0 invert opacity-50" draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white flex items-center gap-2">E-WALLET <span className="text-[10px] bg-[#FFB800]/20 text-[#FFB800] border border-[#FFB800]/30 font-bold px-2 py-0.5 rounded-full">Maintenance</span></p>
                    <p className="text-xs text-white/45 mt-0.5">{pmEwallet.label}</p>
                  </div>
                </div>
                <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 border-white/20" />
              </div>
              )}

              {pmBanks.length > 0 && (
              <div
                role="button"
                aria-disabled="true"
                aria-label="Transfer Bank sedang maintenance"
                title="Transfer Bank sedang maintenance"
                className="text-left rounded-2xl border p-4 flex items-center justify-between transition ax-glass-card border-white/10 opacity-50 cursor-not-allowed select-none"
              >
                <div className="flex items-center gap-3">
                  <img src="/icons/ios11/bank-32.png" alt="" width={20} height={20} className="w-5 h-5 object-contain brightness-0 invert opacity-50" draggable={false} />
                  <div>
                    <p className="text-sm font-semibold text-white flex items-center gap-2">TRANSFER BANK <span className="text-[10px] bg-[#FFB800]/20 text-[#FFB800] border border-[#FFB800]/30 font-bold px-2 py-0.5 rounded-full">Maintenance</span></p>
                    <p className="text-xs text-white/45 mt-0.5">{pmBanks.map((b) => b.label).join(", ")}</p>
                  </div>
                </div>
                <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 border-white/20" />
              </div>
              )}
            </div>

            {/* Detail metode — hanya QRIS selama maintenance. Cabang
                ewallet/bank dihapus dari render agar tidak bisa diakses;
                kembalikan dari git bila maintenance selesai. */}
            {method === "qris" && pmQris && (
              <div className="mt-4 ax-glass-card rounded-2xl p-4 animate-in fade-in">
                  <div className="flex items-start gap-3 text-left">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10">
                      <img src="/icons/ios11/qr-code-32.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" draggable={false} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">QRIS dinamis dibuat setelah pesanan</p>
                      <p className="mt-1 text-xs leading-5 text-white/50">QR sudah termasuk nominal pembayaran. Setelah dibayar, status otomatis menjadi lunas—tanpa upload bukti.</p>
                    </div>
                  </div>
              </div>
            )}
              </>
            )}
          </div>

          {/* Verifikasi otomatis selalu tampil selama maintenance (QRIS saja);
              panel upload manual disembunyikan total di WEB. */}
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
            <h2 className="text-sm font-semibold text-emerald-300">③ Verifikasi Otomatis</h2>
            <p className="mt-1 text-xs leading-5 text-white/50">QRIS dan total bayar akan muncul di halaman pesanan. Biarkan halaman terbuka; status diperbarui otomatis setelah pembayaran diterima.</p>
          </div>

          {/* Ekspektasi waktu SEBELUM bayar. Wajib di sini, bukan hanya di
              halaman pesanan: varian antrean butuh jam-jaman, dan pembeli yang
              baru tahu setelah uangnya masuk berhak merasa dibohongi. */}
          {queuedNames.length > 0 && (
            <div className="rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/[0.07] p-4">
              <h2 className="text-sm font-semibold text-[#FFD66B]">Made By Order</h2>
              <p className="mt-1 text-xs leading-5 text-white/60">
                {queuedNames.length === 1 ? (
                  <><span className="font-semibold text-white">{queuedNames[0]}</span> dibuat setelah orderan masuk</>
                ) : (
                  <><span className="font-semibold text-white">{queuedNames.length} produk</span> di pesanan ini dibuat setelah orderan masuk</>
                )}
                {" "}— dikerjakan sesuai antrean, <span className="font-semibold text-white">estimasi 6–12 jam jika ramai, biasanya lebih cepat</span>, mohon bersabar.
              </p>
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
              serta ketentuan di deskripsi tiap produk.
            </span>
          </label>

          <button onClick={submit} disabled={loading || quoteLoading || method !== "qris" || !quoteToken || !quoteAccepted || quoteIssues.length > 0 || !agreed} className="w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold hover:bg-[#00D0E8] disabled:opacity-60 transition inline-flex items-center justify-center gap-2">
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
          <p className="text-xs text-white/30 mt-3 text-center">QRIS diverifikasi otomatis — pembayaran terkonfirmasi tanpa upload bukti.</p>
        </div>
      </div>

      {/* Price-change / stock / minimum-qty issue dialog.
          Dialog memakai panel solid yang sama dengan modal admin
          (bg #0B1025, bukan glass transparan) agar konsisten. */}
      {showIssueDialog && (quoteIssues.length > 0 || priceChanges.length > 0) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-labelledby="quote-change-title">
          <div className="rounded-2xl border border-white/10 bg-[#0B1025] p-6 max-w-md w-full space-y-4 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
            <h3 id="quote-change-title" className="text-white font-semibold text-base">{belowMinIssues.length > 0 ? "Sesuaikan Jumlah Pembelian" : "Perubahan Harga / Stok"}</h3>
            <p className="text-sm text-white/60">{belowMinIssues.length > 0 ? "Produk ini punya minimal pembelian — naikkan jumlah ke batasnya untuk lanjut:" : "Beberapa item berubah sejak kamu menambahkannya:"}</p>
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
              {belowMinIssues.length > 0 && !isDirect ? (
                <button onClick={adjustToMinimum} className="flex-1 h-10 rounded-xl bg-[#00E5FF] text-[#080C1E] font-semibold text-sm">Sesuaikan ke minimum</button>
              ) : quoteIssues.length === 0 && priceChanges.length > 0 ? (
                <button onClick={() => { setShowIssueDialog(false); setQuoteAccepted(true); }} className="flex-1 h-10 rounded-xl bg-[#00E5FF] text-[#080C1E] font-semibold text-sm">Setujui harga baru</button>
              ) : null}
              <button onClick={() => { setShowIssueDialog(false); if (belowMinIssues.length === 0) router.push("/#katalog"); }} className="flex-1 h-10 rounded-xl border border-white/20 text-white/70 text-sm">{belowMinIssues.length > 0 && !isDirect ? "Ubah manual" : "Kembali belanja"}</button>
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
