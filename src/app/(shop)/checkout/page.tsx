"use client";

import { marketRefundNotice } from "@/lib/warranty-policy";
import { isPaymentMaintenanceEnabled } from "@/lib/payment-maintenance";
import { ManualOrderPanel } from "@/components/shared/PaymentMaintenanceNotice";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { checkoutContactKey } from "@/components/storefront/WrCredentialsPanel";
import { orderCheckoutPath, rememberCheckoutCredentialGrant, rememberDeviceForOrder } from "@/lib/order-access-client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { estimatedUnitPrice, useCart } from "@/stores/cart";
import { bulkCopy, quoteTotalSavings, quoteVariantQty, tierPriceChanges, usableBulkTiers, type BulkVariantFields, type TierExpectation } from "@/lib/bulk-display";
import type { BulkTier } from "@/lib/bulk-pricing";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { asPayLocale, isAvailableGateway, parsePayOptions, payCopy, reconcileSelection, usdFor, usdPreferenceCopy, usdPreferenceView, type PayLocale, type SelectionResult, type UsdPreferenceView } from "@/lib/payment-ui";
import { deriveNameFromEmail, formatRupiah } from "@/lib/utils";
import type { Product } from "@/lib/products";
import { fetchWithTimeout, FetchTimeoutError } from "@/lib/fetch-timeout";
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";
import { startNavigation } from "@/stores/navigation";
import { CheckoutSkeleton, InlineSpinner } from "@/components/storefront/Skeletons";
import { buyerDeliveryEtaJaspay, buyerDeliveryEtaPixel, formatVariantLabel } from "@/lib/catalog";
import { usePreferences } from "@/hooks/usePreferences";
import { useDisplayContext } from "@/hooks/useDisplayPrices";
import { useModalA11y } from "@/hooks/useModalA11y";
import { translateProductName } from "@/lib/i18n/product-name";
import { checkoutMessage } from "@/lib/i18n/checkout-copy";


type QuotedItem = { buyer_fields?: { muse_invite_code?: string; pv_fingerprint?: string; pv_email_masked?: string }; product_id: number; variant_id?: number; name: string; price: number; base_price?: number; applied_tier_min_qty?: number; qty: number; stock: number; image: string; queued_delivery?: boolean; automatic_processing?: boolean };
type QuoteIssue = { product_id?: number; slug?: string; variant_id?: number; min_qty?: number; type: string; message: string };
type PriceChange = { product_id: number; variant_id?: number; name: string; previous_price: number; current_price: number; message: string; tier?: boolean };

import { rowMatchesIssue } from "@/lib/checkout-line-identity";

type DirectProduct = Product & {
  buyerFieldKey?: "muse_invite_code" | null;
  pixelverifInput?: boolean;
  maxQty?: number | null;
  variantId?: number;
  variantLabel?: string;
  bulkTiers?: BulkTier[];
};

type CatalogVariant = BulkVariantFields & {
  id: number;
  label: string;
  duration_value?: number | null;
  duration_unit?: string | null;
  duration_label?: string | null;
  supplier_variant?: boolean;
  label_duration?: string | null;
  price: number;
  stock: number;
  min_qty?: number;
  max_qty?: number | null;
  buyer_field_key?: "muse_invite_code" | null;
  pixelverif_input?: boolean;
  fulfillment_mode?: string;
  inventory_available?: number | null;
};

function CheckoutInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cartItems = useCart((s) => s.items);
  const clear = useCart((s) => s.clear);
  const { locale: explicitLocale } = usePreferences();
  const { resolvedLocale } = useDisplayContext();

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
    // Produk + varian diambil paralel: dulu berurutan sehingga Beli Langsung
    // menunggu 3 round-trip (produk → varian → quote) di jaringan lambat.
    const catalogRequest = buyVariantId
      ? fetchWithTimeout(`/api/catalog?slug=${encodeURIComponent(buySlug)}`, {}, 25_000)
      : null;
    catalogRequest?.catch(() => undefined);
    fetchWithTimeout(`/api/products?active=1&slug=${encodeURIComponent(buySlug)}`, {}, 25_000)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(async (j) => {
        const found = (j.products as Product[] | undefined)?.[0];
        if (!found || found.slug !== buySlug) throw new Error("Produk tidak ditemukan atau sedang nonaktif.");
        if (found.variantCount && found.variantCount > 0) {
          if (!buyVariantId || !catalogRequest) {
            throw new Error("Pilih varian dari halaman detail produk terlebih dahulu.");
          }
          const catRes = await catalogRequest;
          if (!catRes.ok) throw new Error("Pilihan varian gagal dimuat.");
          const catData = await catRes.json() as { product?: { id?: number; slug?: string; variants?: (CatalogVariant & { product_id?: number })[] } };
          // Identitas varian diikat ke produk katalog (temuan audit: URL lama
          // ?buy=slug-lama&variant=<id-produk-lain> memakai varian produk lain
          // karena find() hanya mencocokkan id tanpa memastikan product_id).
          const catSlug = String(catData.product?.slug ?? "");
          const catProductId = Number(catData.product?.id ?? 0);
          const variant = (catData.product?.variants || []).find((v) => String(v.id) === buyVariantId);
          const variantProductId = Number(variant?.product_id ?? 0);
          if (catSlug && catSlug !== buySlug) {
            throw new Error("Varian tidak cocok dengan produk. Pilih ulang dari halaman produk.");
          }
          if (variant && found.id && catProductId && String(found.id) !== String(catProductId)) {
            throw new Error("Varian tidak cocok dengan produk. Pilih ulang dari halaman produk.");
          }
          if (variant && variantProductId && found.id && String(variantProductId) !== String(found.id)) {
            throw new Error("Varian tidak cocok dengan produk. Pilih ulang dari halaman produk.");
          }
          // Varian stok di bawah minimum (stock < min, stock !== -1) tidak
          // bisa dibeli dalam jumlah berapa pun — tolak di sini, bukan di
          // quote (paritas product-detail + QuickVariantModal + cart).
          //
          // Stok EFEKTIF (revisi sore 2026-10-02): unique memakai min(kolom,
          // inventory) — inline dengan helper yang sama dengan PDP agar
          // direct-checkout tidak lolos saat unit habis walau kolom > 0.
          const variantEff = variant && String(variant.fulfillment_mode ?? "manual").trim().toLowerCase() === "unique" && variant.inventory_available != null
            ? Math.min(Math.max(0, Number(variant.stock ?? 0)), Math.max(0, Number(variant.inventory_available)))
            : Number(variant?.stock ?? 0);
          const variantMin = Math.max(1, Number(variant?.min_qty ?? 1) || 1);
          if (!variant || variantEff === 0 || (variantEff !== -1 && variantEff < variantMin)) {
            throw new Error("Varian tidak tersedia. Pilih ulang dari halaman produk.");
          }
          setDirectProduct({
            ...found,
            price: variant.price,
            stock: variantEff === -1 ? undefined : variantEff,
            variantId: variant.id,
            variantLabel: formatVariantLabel(variant),
            minQty: Math.max(1, Number(variant.min_qty ?? 1) || 1),
            maxQty: variant.max_qty,
            buyerFieldKey: variant.buyer_field_key,
            pixelverifInput: variant.pixelverif_input === true,
            bulkTiers: usableBulkTiers(variant, variant.price),
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
      ? (buyProduct ? [{ ...buyProduct, qty: buyQty, id: buyProduct.id, price: buyProduct.price, image: buyProduct.image, name: buyProduct.name, variantId: buyProduct.variantId, variantLabel: buyProduct.variantLabel, minQty: (buyProduct as { minQty?: number }).minQty, bulkTiers: buyProduct.bulkTiers }] : [])
      : cartItems,
    [isDirect, buyProduct, buyQty, cartItems],
  );
  const subtotal = items.reduce((a, b) => a + b.price * b.qty, 0);
  // Jalur manual E-Wallet/Bank + upload bukti sudah pensiun (tidak dirender).
  // Metode = ID yang ditandatangani quote (qris | gateway | crypto) dan dikirim
  // apa adanya sebagai `payment_method`; tidak ada ID tebakan klien.
  const [method, setMethod] = useState<string | null>(null);
  const [payLocale, setPayLocale] = useState<PayLocale>("id");
  const [methodLocked, setMethodLocked] = useState(false);
  const [usdPref, setUsdPref] = useState<UsdPreferenceView>(null);
  const [selectionNotice, setSelectionNotice] = useState<SelectionResult["notice"]>(null);
  const selectedLabelRef = React.useRef<string | null>(null);
  const explicitDeselectRef = React.useRef(false);
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [museCode, setMuseCode] = useState("");
  const needsMuseCode = items.some(item => item.buyerFieldKey === "muse_invite_code");
  const [pvEmail, setPvEmail] = useState("");
  const [pvPassword, setPvPassword] = useState("");
  const [pvTotp, setPvTotp] = useState("");
  const pixelverifCount = items.filter(item => item.pixelverifInput === true).length;
  const needsPixelverif = pixelverifCount > 0;
  const multiplePixelverif = pixelverifCount > 1;
  // Matches PIXELVERIF_GMAIL_REGEX & PIXELVERIF_TOTP_REGEX in src/lib/pixelverif/purchase.ts.
  const pvValid = !multiplePixelverif
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(pvEmail.trim().toLowerCase())
    && pvPassword.length > 0 && pvPassword.length <= 200
    && /^[A-Z2-7]{16,64}={0,6}$/.test(pvTotp.replace(/[\s-]/g, "").toUpperCase());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);

  // --- Fix 1: Authoritative checkout quote ---
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quotedItems, setQuotedItems] = useState<QuotedItem[]>([]);
  const [quotedSubtotal, setQuotedSubtotal] = useState(0);
  const [quotedPaymentMethods, setQuotedPaymentMethods] = useState<unknown[]>([]);
  const [quoteIssues, setQuoteIssues] = useState<QuoteIssue[]>([]);
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const issueDialogRef = React.useRef<HTMLDivElement>(null);
  const issueCancelRef = React.useRef<HTMLButtonElement>(null);
  const closeIssueDialog = useCallback(() => setShowIssueDialog(false), []);
  const issueDialogOpen = showIssueDialog && (quoteIssues.length > 0 || priceChanges.length > 0);
  useModalA11y({ active: issueDialogOpen, containerRef: issueDialogRef, initialFocusRef: issueCancelRef, onClose: closeIssueDialog });
  const [quoteToken, setQuoteToken] = useState<string | null>(null);
  const [quoteAccepted, setQuoteAccepted] = useState(false);
  const uiLocale = explicitLocale ?? (quoteToken ? payLocale : resolvedLocale ?? payLocale);
  const en = uiLocale === "en";
  const text = (id: string, english: string) => en ? english : id;
  const message = (value: string) => checkoutMessage(value, uiLocale);
  // Email SELALU wajib (revamp 2026-09-23 ala Sekalipay): semua produk
  // Axvara digital — order tanpa email = macet. Flag server emailRequired
  // (migrasi 0033) tetap dibaca quote tapi tidak lagi mengubah validasi.
  // Ringkasan accordion mobile (Batch C): state HARUS di sini bersama hooks
  // lain — di bawah ada early return (direct loading/error, keranjang
  // kosong) dan hook setelah return = crash "Rendered more hooks".
  const [summaryOpen, setSummaryOpen] = useState(true);
  const quoteRequestId = React.useRef(0);
  const tierExpectRef = React.useRef<TierExpectation[]>([]);
  // Kode pesanan yang sudah dibuat: layar "membuka pembayaran" tampil sampai
  // /pesanan/[code] dirender, bukan kembali ke form (atau "Keranjang kosong").
  const [redirectCode, setRedirectCode] = useState<string | null>(null);
  const quoteStage = useLoadingStage(quoteLoading, [SLOW_MS]);
  const submitStage = useLoadingStage(loading, [4_000, 12_000]);
  const redirectStage = useLoadingStage(Boolean(redirectCode), [SLOW_MS]);
  // CTA sticky ditekan di dasar form panjang; tanpa ini layar pendek
  // "Pesanan dibuat" muncul di luar viewport dan pembeli hanya melihat footer.
  useEffect(() => {
    if (redirectCode) window.scrollTo({ top: 0 });
  }, [redirectCode]);

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
      const r = await fetchWithTimeout("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: quoteItems }),
      }, 25_000);
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
      const serverChanges = Array.isArray(j.changes) ? j.changes as PriceChange[] : [];
      // Perubahan harga TIER sungguhan (config berubah di server) ikut dilaporkan;
      // melewati ambang tier karena qty berubah tidak (lihat tierPriceChanges).
      const changes: PriceChange[] = [...serverChanges, ...tierPriceChanges(tierExpectRef.current, Array.isArray(j.items) ? j.items as QuotedItem[] : [], serverChanges)];
      setQuotedItems(j.items ?? []);
      setQuotedSubtotal(j.subtotal ?? 0);
      setQuotedPaymentMethods(Array.isArray(j.paymentMethods) ? j.paymentMethods : []);
      const quoteLocale = asPayLocale(j.displayPreferences?.locale ?? j.locale);
      setPayLocale(quoteLocale);
      setUsdPref(usdPreferenceView(j.displayPreferences, quoteLocale));
      setMethodLocked(false);
      setQuoteToken(j.quoteToken ?? null);
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

  // expected_price = harga DASAR baris (item.price tidak pernah dimutasi jadi
  // harga tier): quote server membandingkannya dengan harga dasar, sehingga
  // melewati ambang tier tidak memicu dialog "Perubahan Harga" palsu.
  const quoteRequestItems = useMemo(
    () => items.map((item) => ({
      slug: item.slug,
      variant_id: item.variantId,
      qty: Number(item.qty) || 1,
      expected_price: Number(item.price),
      ...(item.buyerFieldKey === "muse_invite_code" ? { buyer_fields: { muse_invite_code: museCode.trim() } } : {}),
      ...(item.pixelverifInput === true ? { buyer_fields: { pv_email: pvEmail.trim(), pv_password: pvPassword, pv_totp_secret: pvTotp.trim() } } : {}),
    })),
    [items, museCode, pvEmail, pvPassword, pvTotp],
  );
  // Estimasi satuan dari tier yang tersimpan (hanya baris yang membawa cache
  // tier; baris lama tanpa cache tidak menghasilkan peringatan tier).
  const tierExpectations: TierExpectation[] = items.flatMap((item) => {
    const row = item as typeof item & { bulkTiers?: BulkTier[] };
    return row.variantId !== undefined && row.bulkTiers !== undefined ? [{ variantId: row.variantId, unit: estimatedUnitPrice(items as never, row as never) }] : [];
  });
  tierExpectRef.current = tierExpectations;
  const quoteKey = JSON.stringify(quoteRequestItems);
  // Keranjang diperbarui melalui store; beli langsung melalui qty URL.
  const setQty = useCart((s) => s.setQty);
  // Pencocokan baris memakai helper modul rowMatchesIssue: variant_id bila
  // ada (kunci utama), plus product_id-atau-slug bila tersedia — TANPA pernah
  // mewajibkan slug yang hilang (issue product_id-only tanpa slug tetap pulih).
  const belowMinIssues = quoteIssues.filter((i) => i.type === "below_minimum");
  const issueText = (issue: QuoteIssue) => {
    if (!en) return issue.message;
    const name = items.find((item) => rowMatchesIssue(item, issue))?.name;
    const stock = issue.message.match(/stok tersisa (\d+) \(diminta (\d+)\)/);
    const known: Record<string, string> = {
      missing: "Item not found.", inactive: "Item unavailable.", out_of_stock: "Item sold out.",
      insufficient_stock: stock ? `Stock remaining: ${stock[1]} (requested: ${stock[2]}).` : "Insufficient stock.",
      invalid_quantity: "Invalid quantity.", variant_required: "Choose a variant.",
      below_minimum: `Minimum purchase: ${issue.min_qty ?? "—"}.`,
      pixelverif_blocked: "This Gmail was previously found ineligible for this offer and can't be ordered again. Use another Gmail.",
    };
    return known[issue.type] ? `${name ? `${name}: ` : ""}${known[issue.type]}` : issue.message;
  };
  const adjustToMinimum = () => {
    for (const issue of belowMinIssues) {
      const matches = items.filter((it) => rowMatchesIssue(it, issue));
      if (matches.length !== 1) continue;
      const target = matches[0];
      const m = Math.max(1, Math.floor(Number(issue.min_qty ?? target.minQty ?? 1)));
      if (m > target.qty) {
        if (isDirect) {
          // Beli Langsung tidak memakai store: ganti URL lalu navigasi ulang
          // agar searchParams berubah dan quote refetch dari qty baru.
          const url = new URL(window.location.href);
          url.searchParams.set("qty", String(m));
          router.replace(`${url.pathname}?${url.searchParams}`);
        } else {
          setQty(target.id, m, target.variantId);
        }
      }
    }
    setShowIssueDialog(false);
  };

  // Fetch quote whenever product identity, quantity, or snapshot price changes.
  // Debounce Pixel Verification credential edits (400 ms) so typing never fires
  // a quote POST per keystroke while still invalidating stale tokens immediately.
  useEffect(() => {
    if (items.length === 0 || directLoading || (needsMuseCode && !/^[A-Za-z0-9]{6}$/.test(museCode.trim())) || (needsPixelverif && !pvValid)) {
      quoteRequestId.current += 1;
      setQuoteLoading(false);
      setQuoteToken(null);
      setQuotedItems([]);
      setQuotedPaymentMethods([]);
      setQuoteError(null);
      setQuoteIssues([]);
      setShowIssueDialog(false);
      return;
    }
    if (!needsPixelverif) {
      void fetchQuote(quoteRequestItems);
      return;
    }
    const timer = window.setTimeout(() => {
      void fetchQuote(quoteRequestItems);
    }, 400);
    return () => window.clearTimeout(timer);
  // quoteKey intentionally represents the complete item contract.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, directLoading, fetchQuote]);

  // Auto-select QRIS (revamp 2026-09-23, kini dari ID quote): pilihan yang masih
  // ada dipertahankan; bila hilang, QRIS dipilih EKSPLISIT sebelum pesanan
  // dibuat (+ pemberitahuan), tanpa fallback rel tersembunyi. Hanya jalan
  // setelah quote valid (token ada) agar pilihan tidak terhapus saat quote
  // sedang dimuat/ditolak. Hook ini HARUS sebelum early return (aturan hooks).
  const payOptions = useMemo(() => parsePayOptions(quotedPaymentMethods), [quotedPaymentMethods]);
  const selectedOption = payOptions.find((option) => option.id === method) ?? null;
  const copyForLocale = payCopy(uiLocale);
  useEffect(() => {
    if (!quoteToken) return;
    // Deselect eksplisit (menutup grup terpilih) TIDAK boleh di-reseed ke QRIS.
    if (method === null && explicitDeselectRef.current) return;
    const result = reconcileSelection(payOptions, method, selectedLabelRef.current);
    if (result.selectedId !== method) setMethod(result.selectedId);
    if (result.notice) setSelectionNotice(result.notice);
  }, [payOptions, quoteToken, method]);
  useEffect(() => { selectedLabelRef.current = selectedOption?.label ?? selectedLabelRef.current; }, [selectedOption]);

  // Display items: prefer quoted (authoritative), fallback to cart snapshot.
  // Key komposit produk+varian (temuan audit: dua varian produk sama memakai
  // product_id yang sama sehingga React me-reuse baris dan qty tertukar).
  type DisplayLine = { id: unknown; slug: string; variantId?: number; name: string; price: number; qty: number; image: string; basePrice?: number; tierMin?: number; variantQty?: number };
  const displayItems: DisplayLine[] = quotedItems.length > 0
    ? quotedItems.map((qi) => ({ id: qi.product_id, slug: "", variantId: qi.variant_id, name: qi.name, price: qi.price, qty: qi.qty, image: qi.image, basePrice: qi.base_price, tierMin: qi.applied_tier_min_qty, variantQty: quoteVariantQty(quotedItems, qi) }))
    : items;
  // Hemat grosir HANYA dari quote server (base_price hadir bila tier berlaku);
  // total sudah terdiskon, jadi tidak ada baris pengurang tambahan.
  const bulkCopyId = bulkCopy(uiLocale);
  const bulkSavings = quotedItems.length > 0 ? quoteTotalSavings(quotedItems) : 0;
  const bulkLineNotes = (it: DisplayLine) => (
    <>
      {it.tierMin && it.basePrice !== undefined && it.basePrice > it.price && (
        <p className="text-[11px] text-white/45">{bulkCopyId.line(it.tierMin)}</p>
      )}
      {it.tierMin && it.variantQty !== undefined && it.variantQty > it.qty && (
        <p className="text-[11px] text-white/45">{bulkCopyId.aggregated(it.variantQty)}</p>
      )}
    </>
  );
  const bulkIncluded = bulkSavings > 0 ? <p className="text-[11px] text-emerald-300/80">{bulkCopyId.included(formatRupiah(bulkSavings))}</p> : null;
  const rowKeyOf = (it: { id: unknown; slug?: unknown; variantId?: unknown }) => `${String(it.slug ?? "")}|${String(it.id)}|${String(it.variantId ?? "")}`;
  // Nama produk Made By Order (dari quote server, bukan
  // tebakan client) — dipakai untuk peringatan waktu sebelum bayar.
  const queuedNames = quotedItems.filter((qi) => qi.queued_delivery === true && qi.automatic_processing !== true).map((qi) => qi.name);
  const automaticItems = quotedItems.filter((qi) => qi.queued_delivery === true && qi.automatic_processing === true);
  const automaticNames = automaticItems.map((qi) => qi.name);
  const automaticPixelOnly = automaticItems.length > 0 && automaticItems.every((qi) => Boolean(qi.buyer_fields?.pv_fingerprint));
  const displaySubtotal = quotedItems.length > 0 ? quotedSubtotal : subtotal;
  // Total dan biaya metode terpilih: angka dari quote server saja, tanpa
  // penjumlahan/gross-up lokal. Gateway hanya bila estimasinya dihitung dari
  // subtotal quote yang sama (gagal-tertutup); crypto menampilkan USD server.
  const gatewaySel = quotedItems.length > 0 && isAvailableGateway(selectedOption) && selectedOption.subtotalIdr === quotedSubtotal ? selectedOption : null;
  const cryptoSel = quotedItems.length > 0 && selectedOption?.kind === "crypto" && selectedOption.available ? selectedOption : null;
  const totalLabel = gatewaySel ? copyForLocale.totalRow : cryptoSel ? copyForLocale.usdTotal : "Total";
  const totalText = gatewaySel ? formatRupiah(gatewaySel.totalIdr) : cryptoSel ? usdFor(cryptoSel.usdText, uiLocale) : formatRupiah(displaySubtotal);
  // Preferensi USD: angka terkonversi HANYA dari server; bila tak tersedia, jujur tetap Rupiah.
  const usdCopy = usdPreferenceCopy(uiLocale);
  const usdPrefNote = quotedItems.length > 0 && usdPref && !cryptoSel ? (
    <p className="text-[11px] leading-4 text-white/50" data-testid="usd-preference-note">{usdPref.kind === "equivalent" ? usdCopy.equivalent(usdPref.text) : usdCopy.unavailable}</p>
  ) : null;
  const methodExtras = gatewaySel ? (
    <div className="space-y-1" data-testid="gateway-summary">
      <div className="flex justify-between gap-3 text-[13px] text-white/60" data-testid="gateway-subtotal">
        <span>{copyForLocale.subtotalRow}</span><span className="shrink-0 tabular-nums">{formatRupiah(gatewaySel.subtotalIdr)}</span>
      </div>
      <div className="flex justify-between gap-3 text-[13px] text-white/60" data-testid="gateway-fee">
        <span>{copyForLocale.feeRow(gatewaySel.label)}</span><span className="shrink-0 tabular-nums">{formatRupiah(gatewaySel.feeIdr)}</span>
      </div>
      <p className="text-[11px] text-white/50">{copyForLocale.gatewayFinalNote}</p>
    </div>
  ) : cryptoSel ? (
    // Revisi owner 6 Nov: rincian crypto cukup dua baris (Subtotal USD + Biaya layanan) di atas Total;
    // baris kurs dan catatan gas dihapus dari ringkasan (instruksi jaringan tetap di halaman pembayaran).
    <div className="space-y-1 text-[13px] text-white/60" data-testid="crypto-breakdown">
      {cryptoSel.baseText && (
        <div className="flex justify-between gap-3" data-testid="crypto-subtotal">
          <span>{copyForLocale.cryptoSubtotalRow}</span><span className="shrink-0 tabular-nums">{usdFor(cryptoSel.baseText, uiLocale)}</span>
        </div>
      )}
      {cryptoSel.surchargeText && (
        <div className="flex justify-between gap-3" data-testid="crypto-service-fee">
          <span>{copyForLocale.cryptoServiceFeeRow}</span><span className="shrink-0 tabular-nums">{usdFor(cryptoSel.surchargeText, uiLocale)}</span>
        </div>
      )}
    </div>
  ) : null;

  if (redirectCode) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-16 text-center" role="status" aria-live="polite">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#00E5FF]/10">
          <InlineSpinner className="h-8 w-8" />
        </div>
        <h1 className="mt-5 font-display text-xl font-bold text-white">{text("Pesanan dibuat", "Order created")}</h1>
        <p className="mt-1 font-mono text-sm font-bold tracking-[0.08em] text-[#00E5FF]">{redirectCode}</p>
        <p className="mt-3 text-sm leading-6 text-white/60">{selectedOption?.kind === "qris" || !selectedOption ? text("Membuka halaman pembayaran QRIS… Jangan tutup halaman atau buat pesanan ulang.", "Opening the QRIS payment page… Do not close this page or create another order.") : copyForLocale.redirect}</p>
        {redirectStage >= 1 && (
          <p className="mt-4 text-xs leading-5 text-[#FFD66B]/90">
            {text("Koneksi lambat. Pesananmu aman —", "Slow connection. Your order is safe —")}{" "}
            <a href={`/pesanan/${encodeURIComponent(redirectCode)}`} className="font-semibold text-[#00E5FF] underline underline-offset-2">{text("buka halaman pembayaran", "open the payment page")}</a>
          </p>
        )}
      </div>
    );
  }
  if (buySlug && !directError && (directLoading || !directProduct)) {
    return <CheckoutSkeleton label={text("Memuat produk…", "Loading product…")} />;
  }
  if (buySlug && directError) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <h1 className="text-red-300">{message(directError)}</h1>
        <Link prefetch={false} href="/#katalog" className="mt-3 inline-block text-sm text-[#00E5FF]">{text("Kembali ke katalog", "Back to catalog")}</Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16 text-center">
        <h1 className="text-white/60">{text("Keranjang kosong", "Your cart is empty")}</h1>
        <Link prefetch={false} href="/#katalog" className="text-[#00E5FF] text-sm mt-3 inline-block">{text("← Kembali belanja", "← Continue shopping")}</Link>
      </div>
    );
  }

  const submit = async () => {
    setError(null);
    setFieldErrors({});
    const fe: Record<string,string> = {};
    if (!wa.trim()) fe.wa = "No WA wajib diisi.";
    else if (!/^(\+62|62|0)8\d{8,13}$/.test(wa.trim().replace(/\s|-/g,""))) fe.wa = "No WA harus format 08… atau +62… (10–15 digit).";
    // Email SELALU wajib (revamp 2026-09-23 ala Sekalipay): semua produk
    // Axvara digital — order lunas tanpa email = macet. Minta SEBELUM bayar.
    if (!email.trim()) fe.email = "Tulis email aktif — detail pesanan & produk dikirim ke email ini.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fe.email = "Format email tidak valid.";
    if (Object.keys(fe).length) {
      setFieldErrors(fe); setError("Lengkapi data pembeli untuk melanjutkan.");
      const firstInvalid = fe.wa ? "wa" : "email";
      requestAnimationFrame(() => {
        const input = document.getElementById(`checkout-${firstInvalid}`);
        input?.focus({ preventScroll: true });
        const field = input?.closest("[data-checkout-field]") ?? input;
        const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        field?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
      });
      return;
    }
    if (!method) {
      setError("Pilih metode pembayaran terlebih dahulu");
      return;
    }
    if (!selectedOption || !selectedOption.available) {
      setError("Pilih metode pembayaran terlebih dahulu");
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
      // Bawa pembeli ke checkbox yang terlihat (mobile & desktop punya id
      // berbeda); di mobile checkbox jauh di atas sticky CTA.
      const box = ["checkout-agree-mobile", "checkout-agree"]
        .map((id) => document.getElementById(id))
        .find((el) => el && el.getClientRects().length > 0);
      box?.scrollIntoView({ behavior: "smooth", block: "center" });
      box?.focus({ preventScroll: true });
      return;
    }
    const emailClean = email.trim();
    // Nama layak tampil (bukan prefix email mentah) — lihat deriveNameFromEmail.
    const fallbackName = deriveNameFromEmail(emailClean);
    setLoading(true);
    // ID metode terpilih dari quote yang sama dengan quote_token; server
    // mencocokkannya dengan snapshot yang ditandatangani.
    const payMethod = selectedOption.id;
    // Nama dihapus dari form (revamp 2026-09-23 ala Sekalipay): fallback
    // dari prefix email agar kolom DB NOT NULL + notif admin tetap bernama.
    // Pixel credentials come from local form state only (quote response and
    // token carry just a fingerprint); Muse code keeps the quoted echo.
    const payloadItems = quotedItems.map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id,
      qty: item.qty,
      ...(item.buyer_fields?.muse_invite_code || item.buyer_fields?.pv_fingerprint ? {
        buyer_fields: {
          ...(item.buyer_fields?.muse_invite_code ? { muse_invite_code: item.buyer_fields.muse_invite_code } : {}),
          ...(item.buyer_fields?.pv_fingerprint ? { pv_email: pvEmail.trim(), pv_password: pvPassword, pv_totp_secret: pvTotp.trim() } : {}),
        },
      } : {}),
    }));
    let redirected = false;
    try {
      // 60 dtk: jalur ini menunggu stok + QRIS + notifikasi admin di server.
      const r = await fetchWithTimeout("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: fallbackName,
          customer_wa: wa.trim(),
          customer_email: email.trim(),
          items: payloadItems,
          payment_method: payMethod,
          proof_url: null,
          quote_token: quoteToken,
        }),
      }, 60_000);
      const j = await r.json().catch(() => ({}));
      // Harga berubah antara quote dan submit: jangan sekadar melempar teks
      // error mentah. Ambil harga terbaru supaya pembeli melihat nominal baru
      // dan bisa memutuskan, bukan buntu di pesan "Gagal buat pesanan".
      if (r.status === 409 && j.error === "price_changed") {
        setQuoteAccepted(false);
        await fetchQuote(quoteRequestItems);
        throw new Error(j.message || "Harga produk berubah. Periksa harga terbaru lalu lanjutkan.");
      }
      if (r.status === 409 && j.error_code === "checkout_order_closed") {
        setQuoteToken(null);
        setQuoteAccepted(false);
        setQuoteError("checkout_order_closed");
        return;
      }
      // Gateway/crypto gagal/ambigu: order + klaim lama dibiarkan expire (tidak
      // dibatalkan), tetapi quote lama TIDAK boleh dipakai untuk metode lain
      // (reuse orders.quote_id akan mengembalikan order lama). Kosongkan
      // metode+pilihan, ambil quote baru lewat jalur fetchQuote yang sama, dan
      // jangan submit ulang otomatis. Kontak/keranjang/persetujuan tetap.
      if (!r.ok && j.error_code === "payment_method_unavailable") {
        setError(typeof j.error === "string" && j.error ? j.error : "Metode pembayaran ini sedang gangguan. Silakan coba metode pembayaran lain.");
        // Jangan biarkan efek auto-select mengembalikan QRIS: pembeli wajib memilih metode lain sendiri.
        explicitDeselectRef.current = true;
        setMethod(null);
        setQuoteToken(null);
        await fetchQuote(quoteRequestItems);
        return;
      }
      if (!r.ok) throw new Error(j.error || `Gagal buat pesanan (${r.status})`);
      const code = j.code as string;
      // Also keep a local copy for UX fallback (pesanan page can fetch from server if local missing)
      // Tanpa WA/email: perangkat bersama tidak boleh menyimpan kontak pembeli
      // secara permanen (server sudah menyamarkannya di setiap respons).
      try {
        // `qris` dari respons create: halaman pesanan langsung menampilkan QR
        // tanpa menunggu round-trip GET pertama.
        const localOrder = { code, name: fallbackName, method: payMethod, items: displayItems, subtotal: j.subtotal ?? displaySubtotal, fileName: null, status: "pending", createdAt: new Date().toISOString(), qris: j.qris ?? null };
        const existing = JSON.parse(localStorage.getItem("axvara-orders") || "[]");
        localStorage.setItem("axvara-orders", JSON.stringify([...existing, localOrder]));
      } catch {}
      // Buka otomatis detail akun di halaman pesanan TAB INI, termasuk setelah
      // dimuat ulang: sessionStorage hilang sendiri saat tab ditutup.
      try { sessionStorage.setItem(checkoutContactKey(code), wa.trim()); } catch {}
      setRedirectCode(code);
      redirected = true;
      if (!isDirect) clear();
      const target = orderCheckoutPath(`/pesanan/${code}`, code, j.buyer_access_session);
      rememberCheckoutCredentialGrant(code, j.checkout_credential_grant);
      if (typeof j.checkout_credential_grant === "string" && j.checkout_credential_grant) void rememberDeviceForOrder(code, j.checkout_credential_grant);
      startNavigation(target, { overlay: false });
      router.push(target);
    } catch (e) {
      // Timeout/putus jaringan: server mungkin sudah membuat pesanan. Quote
      // token yang sama membuat percobaan ulang idempoten (orders.quote_id
      // UNIQUE → pesanan yang sama dikembalikan), jadi aman menekan Bayar lagi.
      if (e instanceof FetchTimeoutError || e instanceof TypeError) {
        // Kunci metode: percobaan ulang dengan metode lain bisa salah ikat ke
        // pesanan yang mungkin sudah dibuat; terbuka lagi setelah quote baru.
        setMethodLocked(true);
        setError("Koneksi terputus saat membuat pesanan. Tekan Bayar lagi — pesanan yang sama dilanjutkan, tidak dibuat dobel.");
      } else {
        setError(e instanceof Error ? e.message : "Gagal buat pesanan");
      }
    } finally {
      if (!redirected) setLoading(false);
    }
  };

  // Sticky bottom CTA (mobile) + rail CTA (desktop) memanggil submit yang
  // sama dengan tombol utama di kolom kiri — satu handler, tanpa duplikasi
  // logika validasi/quote.
  // `!agreed` sengaja TIDAK menonaktifkan tombol (audit ronde 4, W-M3):
  // tombol disabled tidak memanggil submit(), sehingga pesan "Centang
  // persetujuan…" di atas tidak pernah tampil dan sticky CTA mobile mati
  // tanpa penjelasan. Klik kini menjelaskan + membawa ke checkbox.
  const ctaDisabled = loading || quoteLoading || !selectedOption || !selectedOption.available || !quoteToken || !quoteAccepted || quoteIssues.length > 0;
  // Label bertahap: proses create (stok + QRIS) bisa belasan detik di
  // jaringan lambat; spinner dengan teks yang sama terlihat macet.
  const submitLabel = submitStage === 0 ? text("Membuat pesanan…", "Creating order…") : submitStage === 1 ? (selectedOption && selectedOption.kind !== "qris" ? copyForLocale.stagePrepare : text("Menyiapkan QRIS…", "Preparing QRIS…")) : text("Koneksi lambat, tetap di halaman ini…", "Slow connection, please stay on this page…");
  const ctaLabel = loading ? submitLabel : gatewaySel ? copyForLocale.ctaGateway(gatewaySel.totalIdr) : cryptoSel ? copyForLocale.ctaCrypto(cryptoSel.usdText) : copyForLocale.ctaQris(displaySubtotal);

  // --- Blok metode: SATU definisi, dirender di kolom kiri (revamp
  // 2026-09-23 ala Sekalipay: Metode ① → Data ②). Rail kanan desktop
  // TIDAK lagi memuatnya. Didefinisikan sebagai variabel agar
  // state/validasi tetap satu sumber.
  const paymentBlock = (
    <div>
      <h2 className="text-sm font-semibold text-white">{text("① Metode Pembayaran", "① Payment Method")}</h2>
      {needsPixelverif && !pvValid ? (
        <p className="mt-3 text-sm text-white/60" role="status">{text("Isi Email Gmail, Password, dan Kunci Setup 2FA di bagian Data untuk memuat harga dan metode pembayaran.", "Enter your Gmail address, password, and 2FA setup key in the Details section to load prices and payment methods.")}</p>
      ) : needsMuseCode && !/^[A-Za-z0-9]{6}$/.test(museCode.trim()) ? (
        <p className="mt-3 text-sm text-white/60" role="status">{text("Isi Kode Invite Muse (6 huruf/angka) untuk memuat harga dan metode pembayaran.", "Enter your Muse invite code (6 letters/numbers) to load prices and payment methods.")}</p>
      ) : quoteLoading ? (
        <div className="mt-3 text-sm text-white/50" role="status">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-[#00E5FF] animate-spin" />
            {text("Memuat harga & metode pembayaran…", "Loading prices and payment methods…")}
          </div>
          {quoteStage >= 1 && <p className="mt-2 text-xs text-[#FFD66B]/90">{text("Koneksi lambat — harga masih divalidasi server, tunggu sebentar.", "Slow connection — the server is still checking prices.")}</p>}
        </div>
      ) : quoteError ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2">
          <p className="text-sm text-red-300" role="alert">{quoteError === "checkout_order_closed" ? text("Pesanan ini sudah ditutup.", "This order is closed.") : message(quoteError)}</p>
          <button type="button" onClick={() => void fetchQuote(quoteRequestItems)} className="shrink-0 text-xs font-semibold text-[#00E5FF]">{quoteError === "checkout_order_closed" ? text("Ambil harga terbaru", "Get a new quote") : text("Coba lagi", "Try again")}</button>
        </div>
      ) : (
        <>
      <div className="mt-3">
        <PaymentMethodPicker
          options={payOptions}
          selectedId={method}
          onSelect={(id) => { explicitDeselectRef.current = id === null; setSelectionNotice(null); setMethod(id); }}
          locale={uiLocale}
          disabled={loading || methodLocked}
          notice={methodLocked ? copyForLocale.locked : selectionNotice ? (selectionNotice.kind === "fallback" ? (selectionNotice.unavailable ? copyForLocale.unavailableForTotalNotice(selectionNotice.fromLabel) : copyForLocale.fallbackNotice(selectionNotice.fromLabel)) : copyForLocale.clearedNotice) : null}
        />
      </div>
        </>
      )}
    </div>
  );

  // Checkbox S&K: SATU definisi fungsi agar bisa dirender 1x per viewport
  // (mobile di kolom kiri, desktop di rail) tanpa duplikat id + tetap satu
  // state `agreed`.
  const renderAgreeBlock = (inputId: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left">
      <input
        id={inputId}
        type="checkbox"
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]"
      />
      <span className="text-xs leading-5 text-white/60">
        {text("Saya paham AXVARA adalah", "I understand AXVARA is an")} <span className="font-semibold text-white">{text("third-party independen, bukan official store", "independent third party, not an official store")}</span>{text(", dan saya setuju dengan", ", and I agree to the")}{" "}
        <Link prefetch={false} href="/garansi-replace" target="_blank" rel="noreferrer" className="font-semibold text-[#00E5FF] hover:underline">{text("ketentuan layanan & garansi", "service and warranty terms")}</Link>{" "}
        {text("serta ketentuan di deskripsi tiap produk.", "and the terms in each product description.")}
        <span className="mt-1 block">{marketRefundNotice[uiLocale]}</span>
      </span>
    </label>
  );

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <h1 className="font-display font-bold text-2xl text-white tracking-[-0.02em]">Checkout</h1>
      <p className="text-sm text-white/50">{text("Pilih pembayaran, isi data, lalu selesaikan pesanan.", "Choose a payment method, enter your details, and complete your order.")}</p>

      {/* Ringkasan accordion — MOBILE ONLY (lg:hidden). Di desktop ringkasan
          hidup di rail kanan yang sticky; di mobile rail jatuh ke bawah dan
          CTA tenggelam — accordion di atas mengembalikan total ke viewport
          awal tanpa menambah field. */}
      <div className="mt-4 lg:hidden ax-glass-card rounded-[20px] overflow-hidden">
        <button
          type="button"
          onClick={() => setSummaryOpen((v) => !v)}
          aria-expanded={summaryOpen}
          aria-controls="checkout-summary-mobile"
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-white">{text("Ringkasan Pesanan", "Order Summary")}</span>
          <span className="flex items-center gap-2">
            {/* Total header hanya saat accordion TERTUTUP (pola struk:
                total tampil 1x per state). Saat terbuka, total pindah ke
                footer body agar tidak kembar 2x dalam satu pill.
                Pengecualian: saat quote loading body belum punya total,
                header tetap menampilkannya. */}
            {(!summaryOpen || quoteLoading) && (
              <span className="font-display font-bold text-white text-sm">{totalText}</span>
            )}
            <svg viewBox="0 0 24 24" className={`w-4 h-4 text-white/50 transition-transform ${summaryOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </button>
        {summaryOpen && (
          <div id="checkout-summary-mobile" className="px-4 pb-4">
            {quoteLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-[#00E5FF] animate-spin" />
                {text("Memuat…", "Loading…")}
              </div>
            ) : (
              <div className="space-y-3">
                {displayItems.map((it) => (
                  <div key={rowKeyOf(it)} className="flex gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.image} alt={translateProductName(it.name, uiLocale)} className="w-12 h-12 rounded-xl object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-white leading-4 line-clamp-2">{translateProductName(it.name, uiLocale)}</p>
                      {/* Subline qty: "Qty N × unit" hanya informatif bila
                          qty > 1 (kedua angka beda). Untuk qty 1, angka kanan
                          sudah = harga — jangan ulang lagi. */}
                      <p className="text-[11px] text-white/50">{it.qty > 1 ? `Qty ${it.qty} × ${formatRupiah(it.price)}` : `Qty ${it.qty}`}</p>
                      {bulkLineNotes(it)}
                    </div>
                    <span className="text-[13px] font-semibold text-white">{formatRupiah(it.price * it.qty)}</span>
                  </div>
                ))}
                {methodExtras}
                <div className="pt-3 border-t border-white/10 flex justify-between">
                  <span className="text-[13px] text-white/60">{totalLabel}</span>
                  <span className="font-display font-bold text-white">{totalText}</span>
                </div>
                {usdPrefNote}
                {bulkIncluded}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Keep the shared WA/email errors and focus handling on click and Enter. */}
      <form noValidate onSubmit={(event) => { event.preventDefault(); if (!ctaDisabled && !issueDialogOpen) void submit(); }} className="mt-6 grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        {/* Kiri — METODE + DATA + S&K (revamp 2026-09-23 ala Sekalipay:
            ① Metode di atas → ② Data minimal (WA + Email) → S&K mobile.
            Rail kanan desktop hanya ringkasan + S&K + CTA.) */}
        <div className="ax-glass-card rounded-[24px] p-5 sm:p-6 space-y-6">
          <div>
            {paymentBlock}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-white">{text("② Data Pembeli", "② Buyer Details")}</h2>
            <div className="mt-3 grid gap-3">
              <div data-checkout-field className="scroll-mt-28 scroll-mb-32">
                <label htmlFor="checkout-wa" className="block text-xs font-medium text-white/60 mb-1">{text("No WA aktif *", "Active WhatsApp number *")}</label>
                <input id="checkout-wa" type="tel" inputMode="tel" autoComplete="tel" value={wa} onChange={(e) => { setWa(e.target.value); setFieldErrors(f=> ({...f, wa: ""})); }} placeholder="08..." aria-invalid={!!fieldErrors.wa} aria-describedby={fieldErrors.wa ? "checkout-wa-hint checkout-wa-error" : "checkout-wa-hint"} className={`w-full h-11 px-4 rounded-xl bg-white/[0.06] border text-sm text-white placeholder:text-white/30 focus:outline-none ${fieldErrors.wa ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`} />
                <p id="checkout-wa-hint" className="mt-1.5 text-[11px] leading-4 text-white/40">{text("Nomor WhatsApp aktif untuk verifikasi dan bantuan. Produk tersedia lewat email atau halaman pesanan.", "An active WhatsApp number for verification and support. Find your product by email or on the order page.")}</p>
                {fieldErrors.wa && <p id="checkout-wa-error" className="mt-1.5 text-xs text-red-300">{message(fieldErrors.wa)}</p>}
              </div>
              <div data-checkout-field className="scroll-mt-28 scroll-mb-32">
                {needsMuseCode && <div className="mb-4">
                  <label htmlFor="checkout-muse-code" className="mb-1 block text-xs font-medium text-white/60">{en ? "Muse invite code" : "Kode Invite Muse"} *</label>
                  <input id="checkout-muse-code" value={museCode} onChange={e => { setQuoteToken(null); setMuseCode(e.target.value); }} required maxLength={32} pattern="\s*[A-Za-z0-9]{6}\s*" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="checkout-muse-hint" className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40" />
                  <p id="checkout-muse-hint" className="mt-1.5 text-xs text-white/50">{en ? "6 letters/numbers from Invite friends in Muse. Case is preserved. One code per checkout; quantity 1–30 = 1–30B tokens." : "6 huruf/angka dari Invite friends di Muse. Huruf besar/kecil dipertahankan. Satu kode per checkout; jumlah 1–30 = 1–30B token."}</p>
                </div>}
                {needsPixelverif && <div className="mb-4 grid gap-3">
                  {multiplePixelverif && (
                    <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs leading-5 text-red-200">
                      {en
                        ? "Only 1 Google activation variant can be ordered per checkout. Remove one variant from your cart to continue."
                        : "Hanya 1 varian layanan aktivasi Google yang bisa dipesan per checkout. Hapus salah satu varian di keranjang untuk melanjutkan."}
                    </p>
                  )}
                  <div>
                    <label htmlFor="checkout-pv-email" className="mb-1 block text-xs font-medium text-white/60">{en ? "Gmail address to activate" : "Email Gmail yang diaktivasi"} *</label>
                    <input id="checkout-pv-email" type="email" value={pvEmail} onChange={e => { setQuoteToken(null); setPvEmail(e.target.value); }} required maxLength={254} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="nama@gmail.com" className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40" />
                  </div>
                  <div>
                    <label htmlFor="checkout-pv-password" className="mb-1 block text-xs font-medium text-white/60">{en ? "Gmail password" : "Password Gmail"} *</label>
                    <input id="checkout-pv-password" type="password" value={pvPassword} onChange={e => { setQuoteToken(null); setPvPassword(e.target.value); }} required maxLength={200} autoComplete="new-password" className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40" />
                  </div>
                  <div>
                    <label htmlFor="checkout-pv-totp" className="mb-1 block text-xs font-medium text-white/60">{en ? "2FA setup key (TOTP secret)" : "Kunci Setup 2FA (TOTP secret)"} *</label>
                    <input id="checkout-pv-totp" value={pvTotp} onChange={e => { setQuoteToken(null); setPvTotp(e.target.value); }} required maxLength={120} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby="checkout-pv-hint" placeholder="JBSWY3DPEHPK3PXP" className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white focus:outline-none focus:border-[#00E5FF]/40" />
                    <p id="checkout-pv-hint" className="mt-1.5 text-xs text-white/50">{en ? "The setup key from your authenticator (not the 6-digit code). Stored encrypted, used once for activation, then deleted." : "Kunci setup dari aplikasi authenticator (bukan kode 6 digit). Tersimpan terenkripsi, dipakai sekali untuk aktivasi, lalu dihapus."}</p>
                  </div>
                </div>}
                <label htmlFor="checkout-email" className="block text-xs font-medium text-white/60 mb-1">Email *</label>
                <input id="checkout-email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setFieldErrors(f=> ({...f, email: ""})); }} placeholder={text("email@contoh.com", "email@example.com")} aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? "checkout-email-hint checkout-email-error" : "checkout-email-hint"} className={`w-full h-11 px-4 rounded-xl bg-white/[0.06] border text-sm text-white placeholder:text-white/30 focus:outline-none ${fieldErrors.email ? "border-red-500/50 focus:border-red-400/60" : "border-white/10 focus:border-[#00E5FF]/40"}`} />
                <p id="checkout-email-hint" className="mt-1.5 text-[11px] leading-4 text-white/40">{text("Detail pesanan & produk dikirim ke email ini. Gunakan email aktif yang bisa menerima pesan.", "Order and product details are sent here. Use an active email address.")}</p>
                {fieldErrors.email && <p id="checkout-email-error" className="mt-1.5 text-xs text-red-300">{message(fieldErrors.email)}</p>}
              </div>
            </div>
          </div>

          {/* Ekspektasi waktu SEBELUM bayar. Wajib di sini, bukan hanya di
              halaman pesanan: varian antrean butuh jam-jaman, dan pembeli yang
              baru tahu setelah uangnya masuk berhak merasa dibohongi.
              Copy 2026-09-19 (keputusan owner): framing positif "dibuat
              khusus", tanpa kata antre/ramai/sabar dan tanpa rentang
              6–12 jam — hanya janji plafon 12 jam. */}
          {automaticNames.length > 0 && (
            <div className="rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/[0.07] p-4">
              <h2 className="text-sm font-semibold text-[#FFD66B]">{text("Diproses otomatis", "Processed automatically")}</h2>
              <p className="mt-1 text-xs leading-5 text-white/60">
                <span className="font-semibold text-white">{automaticNames.length === 1 ? automaticNames[0] : `${automaticNames.length} ${text("produk", "products")}`}</span>
                {". "}{automaticPixelOnly
                  ? text(buyerDeliveryEtaPixel(), "Processed automatically by our bot after payment is confirmed. Estimated 1–5 minutes.")
                  : text(buyerDeliveryEtaJaspay(), "Made by order — created automatically by our bot after payment. Estimated 15 minutes–1 hour.")}
              </p>
            </div>
          )}
          {queuedNames.length > 0 && (
            <div className="rounded-2xl border border-[#FFB800]/25 bg-[#FFB800]/[0.07] p-4">
              <h2 className="text-sm font-semibold text-[#FFD66B]">Made By Order</h2>
              <p className="mt-1 text-xs leading-5 text-white/60">
                {queuedNames.length === 1 ? (
                  <><span className="font-semibold text-white">{queuedNames[0]}</span> {text("dibuat setelah pembayaran terkonfirmasi.", "is prepared after payment is confirmed.")}</>
                ) : (
                  <><span className="font-semibold text-white">{queuedNames.length} {text("produk", "products")}</span> {text("di pesanan ini dibuat setelah pembayaran terkonfirmasi.", "in this order are prepared after payment is confirmed.")}</>
                )}
                {" "}{text("Umumnya terkirim cepat, maksimal 12 jam pada jam layanan.", "Usually delivered quickly, within 12 hours during service hours.")}
              </p>
            </div>
          )}

          {/* S&K mobile — rail S&K desktop-only, jadi mobile butuh salinannya
              di sini. Satu state `agreed`, id berbeda agar tidak duplikat. */}
          <div className="lg:hidden">
            {renderAgreeBlock("checkout-agree-mobile")}
          </div>

          {error && <p role="alert" className="lg:hidden text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{message(error)}</p>}

          {/* Sticky bottom CTA — MOBILE ONLY. Di mobile rail kanan jatuh ke
              bawah; sticky ini menjaga tombol bayar selalu dalam jangkauan.
              Memakai handler + state disabled yang sama (tidak ada logika
              ganda). */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#080C1E]/90 backdrop-blur-xl border-t border-white/10 px-4 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
            {Object.values(fieldErrors).some(Boolean) && <p role="alert" className="mb-2 text-center text-xs text-red-200">{message("Lengkapi data pembeli untuk melanjutkan.")}</p>}
            <button type="submit" disabled={ctaDisabled} className="w-full h-12 rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold text-sm hover:bg-[#00D0E8] disabled:opacity-60 transition inline-flex items-center justify-center gap-2">
              {loading && <span className="w-4 h-4 rounded-full border-2 border-[#080C1E]/20 border-t-[#080C1E] animate-spin" />}
              {ctaLabel}
            </button>
          </div>
          {/* Spacer agar konten tidak tertutup sticky CTA mobile. */}
          <div className="lg:hidden h-[68px]" aria-hidden />
        </div>

        {/* Action rail kanan — DESKTOP ONLY (hidden lg:block). Revamp
            2026-09-23 ala Sekalipay: metode pindah ke kolom kiri; rail hanya
            ringkasan + S&K + CTA. Di mobile rail disembunyikan total agar
            tidak duplikat dengan accordion ringkasan + S&K kiri + sticky CTA
            (anomali screenshot owner: 2x ringkasan + 2x CTA). Mini-blok MBO
            dan trust sebaris Batch C awal DIHAPUS 2026-09-19 (redundan:
            estimasi sudah di kiri, trust sudah di hero). */}
        <aside className="hidden lg:block ax-glass-card rounded-[24px] p-5 h-fit lg:sticky lg:top-[72px] space-y-5" aria-label={text("Ringkasan dan pembayaran", "Summary and payment")}>
          <div>
            <h3 className="font-semibold text-white text-sm">{text("Ringkasan Pesanan", "Order Summary")}</h3>
            {quoteLoading ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-white/50">
                <span className="w-4 h-4 rounded-full border-2 border-white/20 border-t-[#00E5FF] animate-spin" />
                {text("Memuat…", "Loading…")}
              </div>
            ) : (
            <>
            <div className="mt-4 space-y-3">
              {displayItems.map((it) => (
                <div key={rowKeyOf(it)} className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.image} alt={translateProductName(it.name, uiLocale)} className="w-14 h-14 rounded-xl object-cover" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white leading-4 line-clamp-2">{translateProductName(it.name, uiLocale)}</p>
                    <p className="text-xs text-white/50">Qty {it.qty} × {formatRupiah(it.price)}</p>
                    {bulkLineNotes(it)}
                  </div>
                  <span className="text-sm font-semibold text-white">{formatRupiah(it.price * it.qty)}</span>
                </div>
              ))}
            </div>
            {methodExtras && <div className="mt-4">{methodExtras}</div>}
            <div className="mt-4 pt-4 border-t border-white/10 flex justify-between">
              <span className="text-sm text-white/60">{totalLabel}</span>
              <span className="font-display font-bold text-white text-lg">{totalText}</span>
            </div>
            {usdPrefNote && <div className="mt-1">{usdPrefNote}</div>}
            {bulkIncluded}
            </>
            )}
          </div>

          {error && <p role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{message(error)}</p>}

          {renderAgreeBlock("checkout-agree")}

          <div>
            <button type="submit" disabled={ctaDisabled} className="w-full h-[52px] rounded-xl bg-[#00E5FF] text-[#080C1E] font-bold hover:bg-[#00D0E8] disabled:opacity-60 transition inline-flex items-center justify-center gap-2">
              {loading && <span className="w-5 h-5 rounded-full border-2 border-[#080C1E]/20 border-t-[#080C1E] animate-spin" />}
              {ctaLabel}
            </button>
            {selectedOption && copyForLocale.railFootnote[selectedOption.kind] && <p className="text-xs text-white/30 mt-3 text-center">{copyForLocale.railFootnote[selectedOption.kind]}</p>}
          </div>
        </aside>
      </form>

      {/* Price-change / stock / minimum-qty issue dialog.
          Dialog memakai panel solid yang sama dengan modal admin
          (bg #0B1025, bukan glass transparan) agar konsisten. */}
      {issueDialogOpen && (
        <div ref={issueDialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" role="dialog" aria-modal="true" aria-labelledby="quote-change-title">
          <div className="rounded-2xl border border-white/10 bg-[#0B1025] p-6 max-w-md w-full space-y-4 shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
            <h3 id="quote-change-title" className="text-white font-semibold text-base">{belowMinIssues.length > 0 ? text("Sesuaikan Jumlah Pembelian", "Adjust Purchase Quantity") : text("Perubahan Harga / Stok", "Price / Stock Changed")}</h3>
            <p className="text-sm text-white/60">{belowMinIssues.length > 0 ? text("Produk ini punya minimal pembelian — naikkan jumlah ke batasnya untuk lanjut:", "This product has a minimum purchase quantity. Increase it to continue:") : text("Beberapa item berubah sejak kamu menambahkannya:", "Some items changed since you added them:")}</p>
            <ul className="space-y-2">
              {quoteIssues.map((issue) => (
                <li key={`issue-${issue.type}-${issue.slug ?? issue.product_id ?? "?"}-${issue.variant_id ?? 0}`} className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">{issueText(issue)}</li>
              ))}
              {priceChanges.map((change) => (
                <li key={`price-${change.product_id}-${change.variant_id ?? 0}`} className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                  {change.name}: {formatRupiah(change.previous_price)} → {formatRupiah(change.current_price)}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              {belowMinIssues.length > 0 ? (
                <button onClick={adjustToMinimum} className="flex-1 h-10 rounded-xl bg-[#00E5FF] text-[#080C1E] font-semibold text-sm">{text("Sesuaikan ke minimum", "Adjust to minimum")}</button>
              ) : quoteIssues.length === 0 && priceChanges.length > 0 ? (
                <button onClick={() => { setShowIssueDialog(false); setQuoteAccepted(true); useCart.getState().forgetBulkTiers(priceChanges.filter((c) => c.tier && c.variant_id !== undefined).map((c) => c.variant_id as number)); }} className="flex-1 h-10 rounded-xl bg-[#00E5FF] text-[#080C1E] font-semibold text-sm">{text("Setujui harga baru", "Accept new price")}</button>
              ) : null}
              <button ref={issueCancelRef} type="button" onClick={() => { setShowIssueDialog(false); if (isDirect || belowMinIssues.length === 0) router.push("/#katalog"); }} className="flex-1 min-h-11 rounded-xl border border-white/20 text-white/70 text-sm">{!isDirect && belowMinIssues.length > 0 ? text("Ubah manual", "Adjust manually") : text("Kembali belanja", "Continue shopping")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  if (isPaymentMaintenanceEnabled()) return <ManualOrderPanel />;
  return (
    <React.Suspense fallback={<CheckoutSkeleton />}>
      <CheckoutInner />
    </React.Suspense>
  );
}
