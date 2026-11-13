"use client";

import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import { orderCheckoutPath } from "@/lib/order-access-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, pediaTargetMatches, type PediaPlatform, type PediaTargetKind } from "@/lib/pedia/link";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { ServiceChips, ServicePicker, shortServiceName } from "@/components/pedia/ServicePicker";
import { refillLabel } from "@/lib/pedia/terms";
import { ServiceInfoCard } from "@/components/pedia/ServiceInfoCard";
import { checkCustomComments, parseCustomComments, CUSTOM_COMMENT_MAX_CHARS, CUSTOM_COMMENT_MAX_TOTAL } from "@/lib/pedia/custom-comments";
import { usePediaPrices } from "@/components/pedia/usePediaPrices";
import { ArrowLeft, ArrowRight, Check, ChevronUp, ShieldCheck, X } from "lucide-react";
import { NeedPicker } from "@/components/pedia/NeedPicker";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { PaymentMethodPicker } from "@/components/storefront/PaymentMethodPicker";
import { parsePayOptions, reconcileSelection, type PayOption } from "@/lib/payment-ui";
import { pediaPlatform, pediaTargetExample } from "@/lib/pedia/platforms";
import { useDisplayLocale, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { fill, pediaChecklistText, pediaCopy, pediaNumber, pediaServiceText, pediaTargetKindLabel } from "@/lib/pedia/copy";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { pediaVariantNames, shortPediaName } from "@/lib/pedia/display-name";

const rupiah = (value: number, locale: "id" | "en" = "id") => `Rp${value.toLocaleString(locale === "en" ? "en-US" : "id-ID")}`;
const fieldClass = "mt-2 min-h-11 w-full rounded-xl border border-white/30 bg-white/[0.035] px-3.5 text-base text-white placeholder:text-white/55 focus:border-[#00E5FF] focus:outline-none md:text-sm";

/** Hasil order ambigu: retry memakai quote yang sama sehingga tidak ada tagihan kedua. */
export const RETRY_MESSAGE = "Pesanan belum berhasil dibuat. Tekan Coba lagi; kamu tidak akan ditagih dua kali.";
// Baris panduan supplier yang hanya mengulang alur checkout (pilih layanan, isi kontak, bayar, pantau).
const GENERIC_GUIDE_LINE = /pilih layanan dan jumlah|masukkan jumlah, bandingkan|baca ketentuan dan konfirmasi|isi kontak, periksa total|periksa ketentuan, isi whatsapp|setelah pembayaran terkonfirmasi|pantau proses melalui/i;
// Ketentuan yang paling sering memicu kendala tampil lebih dulu; sisanya dilipat.
const KEY_TERM = /refill|garansi|jangan|privat|tunggu/i;

export type PediaOrderDraft = { slug: string; targetKind: string; tierId: number | null; qty: number | null; target: string; checks: Record<string, boolean>; wa: string; email: string };

export function OrderClient({ product, initialTarget, initialDraft, ordersEnabled, embedded = false, withinPlatform = false, onLockedChange, products = [], onProductChange }: { product: PediaCatalogProduct; initialTarget: string; initialDraft?: PediaOrderDraft; ordersEnabled: boolean; embedded?: boolean; withinPlatform?: boolean; onLockedChange?: (locked: boolean) => void; products?: PediaCatalogProduct[]; onProductChange?: (slug: string, draft: PediaOrderDraft, selectedTierId?: number) => void }) {
  const draft = initialDraft?.slug === product.slug && initialDraft.targetKind === product.target_kind ? initialDraft : undefined;
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  const n = (value: number) => pediaNumber(value, locale);
  const [stage, setStage] = useState(1);
  const [quantityNotice, setQuantityNotice] = useState("");
  const [tierId, setTierId] = useState<number | null>(draft?.tierId ?? null);
  const [qty, setQty] = useState<number | null>(draft?.qty ?? null);
  const [target, setTarget] = useState(draft?.target ?? initialTarget);
  const [checks, setChecks] = useState<Record<string, boolean>>(draft?.checks ?? {});
  const [wa, setWa] = useState(draft?.wa ?? "");
  const [email, setEmail] = useState(draft?.email ?? "");
  const [comments, setComments] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [quote, setQuote] = useState<{ key: string; quote_token: string; total: number; payable: number; expires: number } | null>(null);
  // Fase B (2026-11-07): metode pembayaran dari quote bertanda tangan.
  const [methods, setMethods] = useState<{ key: string; options: PayOption[] } | null>(null);
  const [methodsBusy, setMethodsBusy] = useState(false);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [methodsAttempt, setMethodsAttempt] = useState(0);
  const [method, setMethod] = useState<string | null>("qris");
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  // Picker dimuat saat pembeli membuka bagian metode (QRIS tetap bawaan).
  const [methodsOpen, setMethodsOpen] = useState(false);
  const previousMethodLabel = useRef<string | null>(null);
  const tier = product.tiers.find((t) => t.id === tierId);
  const productCopy = product.description_md?.trim() ?? "";
  const productDescription = productCopy === `${product.name}. Pilih layanan dan jumlah, gunakan link yang sesuai, lalu lanjutkan ke pembayaran QRIS.` ? "" : pediaServiceText(productCopy, locale);
  const customComments = tier?.input_kind === "comments";
  const checklist = product.checklist ?? [];
  const platform = PEDIA_PLATFORM_LABEL[product.platform as PediaPlatform] ?? product.platform;
  const kind = pediaTargetKindLabel(product.target_kind as PediaTargetKind, locale);
  const productName = shortPediaName(product.name, "", locale);
  const variants = useMemo(() => (products.length ? products : [product]).filter((p) => p.metric === product.metric), [products, product]);
  const variantNames = useMemo(() => pediaVariantNames(variants, locale), [variants, locale]);
  const detected = detectPediaLink(target, product.platform);
  const kindOk = detected && pediaTargetMatches(product.target_kind, detected.targetKind, product);
  const targetOk = !!detected && detected.platform === product.platform && !!kindOk && target.trim().length <= 600;
  const waOk = /^(\+62|62|0)8\d{8,13}$/.test(wa.trim().replace(/\s|-/g, ""));
  const emailOk = z.string().email().max(160).safeParse(email.trim()).success;
  const key = JSON.stringify([product.slug, tierId, qty, target.trim(), wa.trim(), email.trim(), checks, agree, ordersEnabled, comments]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const inFlight = useRef(false);
  const quoteController = useRef<AbortController | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [summaryFits, setSummaryFits] = useState(false);
  const currentQuote = quote?.key === key ? quote : null;
  const [sheet, setSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sheetOpener = useRef<HTMLElement | null>(null);
  useEffect(() => { setSheet(false); }, [stage]);
  useEffect(() => {
    if (!sheet) return;
    const panel = sheetRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSheet(false); return; }
      if (event.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKey); sheetOpener.current?.focus({ preventScroll: true }); };
  }, [sheet]);
  // Harga acuan persetujuan: harga paket tersimpan bila jumlah persis paket,
  // selainnya total tepat dari endpoint harga server. Quote server tetap penentu
  // akhir (token JWE mengikat total persis); selisih apa pun memicu consent.
  const comparison = usePediaPrices(product.slug, qty, !embedded);
  const comparisonPrices = comparison?.prices ?? {};
  const quantityValid = !!tier && qty != null && Number.isSafeInteger(qty) && qty >= (tier.min_qty ?? 1) && qty <= (tier.max_qty ?? Infinity) && qty % (tier.quantity_step ?? product.step) === 0;
  const packageTotal = tier && qty && quantityValid ? (comparisonPrices[tier.id] ?? tier.prices[String(qty)] ?? 0) : 0;
  // Nominal tampilan (USD hanya tampilan; quote/charge tetap IDR/QRIS).
  const display = useDisplayPrices([packageTotal, currentQuote?.total ?? 0, currentQuote?.payable ?? 0].filter((value) => value > 0));
  const money = (value: number) => (display.currency === "USD" ? display.text(value) : rupiah(value, locale));
  const tierName = tier ? variantNames.get(tier.id) ?? shortServiceName(product.name, product.metric, tier, locale) : "";
  useEffect(() => { onLockedChange?.(attempted); }, [attempted, onLockedChange]);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const measure = () => setSummaryFits((summaryRef.current?.offsetHeight ?? Infinity) + 120 <= window.innerHeight);
    const observer = new ResizeObserver(measure);
    if (summaryRef.current) observer.observe(summaryRef.current);
    window.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const guideLines = (tier?.instructions ?? "").split(/\n+/).map((l) => l.trim()).filter((l) => l && !GENERIC_GUIDE_LINE.test(l));
  const termLines = (tier?.terms ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const keyTerms = termLines.filter((l) => KEY_TERM.test(l)).slice(0, 3);
  const shownTerms = keyTerms.length ? keyTerms : termLines.slice(0, 3);
  const moreTerms = termLines.filter((l) => !shownTerms.includes(l));
  const targetHelp = fill(t.orderTargetHelp, { example: pediaTargetExample(product.platform, product.target_kind).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), access: product.target_kind === "profile" ? t.orderTargetPublic : t.orderTargetContent });

  useEffect(() => {
    quoteController.current?.abort();
    setQuote(null);
    setError("");
    setErrors({});
    return () => { quoteController.current?.abort(); };
  }, [key]);

  // Quote ringan untuk daftar metode (tanpa kontak), disimpan sebagai promise
  // agar `pay()` memakai SATU quote yang sama (token tahan 30 menit). Kegagalan
  // tidak memblokir QRIS: create tetap default QRIS.
  const offerKey = JSON.stringify([product.slug, tierId, qty, target.trim(), comments]);
  const methodOptions = methods?.key === offerKey ? methods.options : [];
  type Prefetched = { quote_token: string; total: number; payable: number; expires: number };
  const prefetch = useRef<{ key: string; promise: Promise<{ options: PayOption[]; quote: Prefetched } | null> } | null>(null);
  useEffect(() => {
    if (!methodsOpen || stage !== 3 || !tier || qty == null || !quantityValid || !targetOk || attempted) return;
    const controller = new AbortController();
    setMethodsBusy(true);
    setMethodsError(null);
    const promise = (async () => {
      try {
        const response = await fetchWithTimeout("/api/pedia/quote", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_slug: product.slug, tier_id: tierId, quantity: qty, target: target.trim(), ...(customComments ? { comments } : {}) }),
          signal: controller.signal,
        }, 25_000);
        const data = await response.json();
        if (controller.signal.aborted) return null;
        const options = parsePayOptions(data.paymentMethods);
        if (!response.ok || options.length === 0 || typeof data.quote_token !== "string"
          || !Number.isFinite(data.total) || data.total <= 0 || !Number.isFinite(data.payable)) {
          throw new Error(data.message ?? data.error ?? t.orderMethodsNone);
        }
        const quote: Prefetched = {
          quote_token: data.quote_token, total: data.total, payable: data.payable,
          // Token berlaku 30 menit; beri margin 1 menit seperti alur lama.
          expires: Date.now() + 29 * 60_000,
        };
        setMethods({ key: offerKey, options });
        return { options, quote };
      } catch (cause) {
        if (!controller.signal.aborted) setMethodsError(cause instanceof Error ? cause.message : t.orderMethodsNone);
        return null;
      } finally {
        if (!controller.signal.aborted) setMethodsBusy(false);
      }
    })();
    prefetch.current = { key: offerKey, promise };
    return () => { controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methodsOpen, stage, offerKey, methodsAttempt, attempted, quantityValid, targetOk]);

  // Pilihan mengikuti daftar bertanda tangan; QRIS dipilih eksplisit bila pilihan hilang.
  useEffect(() => {
    if (!methodOptions.length) return;
    const previous = methodOptions.find((option) => option.id === method);
    const result = reconcileSelection(methodOptions, method, previousMethodLabel.current);
    previousMethodLabel.current = previous?.label ?? previousMethodLabel.current;
    if (result.selectedId !== method) setMethod(result.selectedId);
    setSelectionNotice(result.notice
      ? (result.notice.kind === "fallback"
        ? fill(t.orderMethodFallback, { label: result.notice.fromLabel })
        : fill(t.orderMethodCleared, { label: result.notice.fromLabel }))
      : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods]);

  const validate = (throughStage = 3) => {
    const next: Record<string, string> = {};
    if (!tier) next.tier = t.errTier;
    if (qty == null || !Number.isSafeInteger(qty)) {
      next.quantity = t.errQtyEmpty;
    } else if (!tier) {
      next.quantity = t.errQtyNoTier;
    } else if (qty < (tier.min_qty ?? 1) || qty > (tier.max_qty ?? Infinity) || qty % (tier.quantity_step ?? product.step) !== 0) {
      next.quantity = fill(t.errQtyRange, {
        qty: n(qty), min: n(tier.min_qty ?? 1), max: n(tier.max_qty ?? 0),
        step: (tier.quantity_step ?? product.step) > 1 ? fill(t.errQtyStep, { step: n(tier.quantity_step ?? product.step) }) : "",
      });
    }
    if (throughStage >= 2 && !targetOk) next.target = fill(t.errTarget, { kind: kind.toLowerCase(), platform });
    if (throughStage >= 2 && customComments) { const checked = checkCustomComments(comments, qty); if (!checked.ok) next.comments = checked.error; }
    if (throughStage >= 2 && !checklist.every((c) => checks[c.id])) next.requirements = t.errRequirements;
    if (throughStage >= 3 && !waOk) next.wa = t.errWa;
    if (throughStage >= 3 && !emailOk) next.email = t.errEmail;
    if (throughStage >= 3 && !agree) next.agree = t.errAgree;
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      const field = document.getElementById(`pedia-${first}`);
      const focus = (field?.querySelector("input:not(:disabled)") as HTMLElement | null) ?? field;
      focus?.focus({ preventScroll: true });
      focus?.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    }
    return !first;
  };

  const pay = async () => {
    if (!ordersEnabled || inFlight.current || !validate()) return;
    inFlight.current = true;
    const requestKey = key;
    const controller = new AbortController();
    quoteController.current = controller;
    setError("");
    let navigating = false;
    let orderStarted = false;
    let serverMessage: string | null = null;
    try {
      let readyQuote = currentQuote;
      if (!readyQuote && prefetch.current?.key === offerKey) {
        const prefetched = await prefetch.current.promise;
        if (controller.signal.aborted || latestKey.current !== requestKey) return;
        if (prefetched) readyQuote = { key: requestKey, ...prefetched.quote };
      }
      if (!readyQuote || (!attempted && readyQuote.expires <= Date.now())) {
        setQuote(null);
        setBusy("Memeriksa harga...");
        const response = await fetchWithTimeout("/api/pedia/quote", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ product_slug: product.slug, tier_id: tierId, quantity: qty, target: target.trim(), ...(customComments ? { comments } : {}) }),
        }, 25_000);
        const data = await response.json();
        if (controller.signal.aborted || latestKey.current !== requestKey) return;
        if (!response.ok) throw new Error(data.message ?? data.error ?? "Harga belum dapat diperiksa. Coba lagi.");
        if (typeof data.quote_token !== "string" || !data.quote_token || !Number.isFinite(data.total) || data.total <= 0 || !Number.isFinite(data.payable) || data.payable < 0 || data.payable > data.total) throw new Error("Respons harga tidak valid. Coba lagi.");
        readyQuote = { key: requestKey, quote_token: data.quote_token, total: data.total, payable: data.payable, expires: Date.now() + 29 * 60_000 };
        setQuote(readyQuote);
        if (data.total !== packageTotal) return;
      }
      if (latestKey.current !== requestKey || controller.signal.aborted) return;
      // An uncertain response must retry this token and these locked contact details.
      orderStarted = true;
      setAttempted(true);
      setBusy("Membuka pembayaran...");
      const response = await fetchWithTimeout("/api/pedia/orders", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_wa: wa.trim(), customer_email: email.trim(), quote_token: readyQuote.quote_token, payment_method: method ?? "qris" }),
      }, 60_000);
      const data = await response.json();
      if (!response.ok) {
        // Rail gateway/crypto bermasalah (kontrak Market): JANGAN pindah ke
        // halaman pesanan (metode di sana terkunci). Tampilkan pesan server,
        // buang quote, muat ulang daftar metode, dan jangan memilih ulang
        // metode yang gagal — pembeli memilih metode lain; submit berikut
        // memakai quote BARU (bukan quote_id order yang gagal).
        if (response.status === 503 && data.error_code === "payment_method_unavailable") {
          setQuote(null);
          // Buang quote yang di-prefetch untuk rail yang gagal: submit berikut
          // WAJIB mengambil /api/pedia/quote baru (token baru), bukan memakai ulang.
          prefetch.current = null;
          setMethods(null);
          setMethodsAttempt((value) => value + 1);
          setAttempted(false);
          // QRIS = default aman (bukan metode berbiaya yang baru gagal);
          // pilihan eksplisit pembeli berikutnya menggantikannya.
          setMethod("qris");
          serverMessage = data.error ?? null;
          throw new Error(data.error ?? t.orderMethodsNone);
        }
        if (response.status >= 500 && typeof data.code === "string" && /^AXP-\d{8}-[A-Z0-9]{8}$/.test(data.code)) setRecoveryCode(data.code);
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          setAttempted(false);
          setQuote(null);
          if (data.code === "quote_stale") {
            setMethods(null);
            setMethodsAttempt((value) => value + 1);
          }
        }
        // 4xx: alasan pasti dari server (harga berubah, batas, dll.) tetap ditampilkan.
        if (response.status < 500) serverMessage = data.message ?? data.error ?? null;
        throw new Error(data.message ?? data.error ?? "Pesanan belum dapat dilanjutkan.");
      }
      if (typeof data.code !== "string" || !/^AXP-[A-Z0-9-]+$/.test(data.code)) throw new Error("Respons pesanan belum lengkap. Coba lanjutkan lagi dengan data yang sama.");
      try {
        const stored = JSON.parse(localStorage.getItem("axp-orders") ?? "[]");
        const list = Array.isArray(stored) ? stored : [];
        localStorage.setItem("axp-orders", JSON.stringify([{ code: data.code, name: product.name }, ...list.filter((o) => o.code !== data.code)].slice(0, 20)));
      } catch { /* Device history is optional. */ }
      rememberPediaContact(data.code, email.trim());
      location.assign(orderCheckoutPath(`/pedia/pesanan/${data.code}`, data.code, data.buyer_access_session));
      navigating = true;
      // Keep the lock until navigation, including a second click from the mobile CTA.
      return;
    } catch (e) {
      if (!orderStarted && (controller.signal.aborted || latestKey.current !== requestKey)) return;
      // 2026-11-01 (owner): hasil ambigu (5xx/timeout/respons rusak) memakai satu kalimat
      // sederhana. Retry memakai quote yang sama, jadi tidak membuat tagihan kedua.
      setError(orderStarted ? serverMessage ?? RETRY_MESSAGE : e instanceof Error ? e.message : t.orderConnectionLost);
    } finally {
      if (!navigating) { inFlight.current = false; setBusy(""); }
    }
  };

  // Di mobile pesan error berada di bawah form dan bisa tertutup bar bawah.
  useEffect(() => {
    if (!error || !errorRef.current) return;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    errorRef.current.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [error]);
  const inlineError = (id: string) => errors[id] ? <p id={`pedia-${id}-error`} role="alert" className="mt-2 text-sm text-red-300">{errors[id]}</p> : null;
  const priceText = currentQuote ? money(currentQuote.payable) : packageTotal > 0 ? money(packageTotal) : !tier ? t.orderChooseService : !qty ? t.orderFillQty : !quantityValid ? t.orderCheckQty : embedded || comparison ? t.priceUnavailable : t.priceChecking;
  const brandColor = pediaPlatform(product.platform)?.color ?? "#00E5FF";
  const stageLabels = t.orderSteps.split("|");
  const [agreeBefore, agreeAfter] = t.orderAgree.split("{link}");
  const recoveryText = fill(t.orderRecovery, { code: recoveryCode || "{code}" });
  const [recoveryBefore, recoveryAfter] = recoveryCode ? recoveryText.split(recoveryCode) : ["", ""];
  const summary = (withCta = true) => <>
    <div className="flex items-center gap-3 border-b border-white/10 p-5 max-xl:pr-16" style={{ background: `linear-gradient(115deg, ${brandColor}26, #0F143080 70%), #080C1E` }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]"><PlatformIcon id={product.platform} size={25} /></span>
      <div className="min-w-0"><h2 className="text-xs text-white/65">{t.orderSummary}</h2><p className="mt-1 text-sm font-semibold text-white">{productName}</p></div>
    </div>
    <div className="p-4">
      {tier ? <>
        <p className="text-sm font-semibold leading-5 text-white">{tierName || t.orderSelectedService}</p>
        <div className="mt-2"><ServiceChips t={tier} eta productName={product.name} /></div>
        <dl className="mt-4 space-y-2.5 text-[13px] text-white/65">
          {qty != null && <div className="flex justify-between gap-4"><dt>{t.orderQtyRow}</dt><dd className="text-right tabular-nums text-white">{n(qty)}</dd></div>}
          {tier.eta_finish && <div className="flex justify-between gap-4"><dt>{t.orderEtaFinish}</dt><dd className="text-right text-white/70">{tier.eta_finish}</dd></div>}
          {targetOk && <div><dt>{t.orderTargetRow}</dt><dd className="mt-1 break-all leading-5 text-white/80">{target.trim()}</dd></div>}
        </dl>
        <div className="mt-4 border-t border-white/10 pt-3"><div className="flex items-baseline justify-between gap-3"><p className="text-[13px] text-white/65">{currentQuote ? t.orderTotalConfirmed : t.orderTotal}</p><p className={`text-[17px] font-bold leading-6 tracking-[-0.02em] ${packageTotal > 0 || currentQuote ? "text-white" : "text-white/80"}`}>{!currentQuote && !qty ? <><span aria-hidden="true">—</span><span className="sr-only">{t.orderNoTotal}</span></> : priceText}</p></div>
        {(currentQuote || !qty) && <p className="mt-1 text-[11px] leading-4 text-white/65">{currentQuote ? t.orderQrisNote : t.orderFillNote}</p>}</div>
      </> : <div>
        <ol className="space-y-2.5 text-[13px] leading-5 text-white/70">
          {[t.orderEmptyStep1, t.orderEmptyStep2, t.orderEmptyStep3].map((label, i) => <li key={label} className="flex items-center gap-3"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#00E5FF]/40 text-xs font-semibold text-[#00E5FF]">{i + 1}</span>{label}</li>)}
        </ol>
        <p className="mt-4 text-[13px] leading-5 text-white/65">{t.orderEmptyNote}</p>
      </div>}
      {withCta && <div className="mt-5 hidden xl:block">{cta}</div>}
    </div>
  </>;
  const goToStage = (next: number) => {
    if (attempted) return;
    quoteController.current?.abort();
    setQuote(null);
    setStage(next);
    requestAnimationFrame(() => {
      const heading = document.getElementById("pedia-stage-heading");
      heading?.focus({ preventScroll: true });
      if (heading) window.scrollTo?.({ top: Math.max(0, window.scrollY + heading.getBoundingClientRect().top - 96), behavior: "instant" });
    });
  };
  const advance = () => {
    if (!validate(stage)) return;
    goToStage(stage + 1);
  };
  const pickTier = (id: number, slug = product.slug) => {
    if (slug !== product.slug) {
      if (!attempted) onProductChange?.(slug, { slug: product.slug, targetKind: product.target_kind, tierId, qty, target, checks, wa, email }, id);
      return;
    }
    setTierId(id);
    setQuantityNotice("");
  };
  // Contoh jumlah jujur se-produk: hanya angka yang valid di ≥1 layanan.
  // Tidak mengisi otomatis — hanya chip contoh sebelum layanan dipilih.
  const productExamples = useMemo(() => [...new Set(product.tiers.flatMap((t) => t.quick_quantities ?? []))]
    .filter((n) => product.tiers.some((t) => n >= (t.min_qty ?? 1) && n <= (t.max_qty ?? n) && n % (t.quantity_step ?? product.step) === 0))
    .sort((a, b) => a - b).slice(0, 5), [product]);
  const productMin = useMemo(() => product.tiers.length ? Math.min(...product.tiers.map((t) => t.min_qty ?? 1)) : 1, [product]);
  const canOpenSheet = !!tier && !embedded;
  const totalCls = `min-w-0 flex-1 xl:hidden ${canOpenSheet ? "max-w-[7rem] max-[379px]:max-w-[5.75rem]" : stage === 2 || stage === 3 ? "max-w-[6.25rem] max-[379px]:max-w-[4.75rem]" : "max-w-32"}`;
  const totalBlock = canOpenSheet
    ? <p className="break-words text-[17px] font-bold leading-5 tracking-[-0.02em] text-white max-[379px]:text-base">{priceText}</p>
    : <><p className="whitespace-nowrap text-xs text-white/65"><span className="max-[379px]:hidden">{t.orderTotal}</span><span aria-hidden="true" className="hidden max-[379px]:inline">{t.orderTotalMobile}</span></p><p className="mt-1 break-words text-sm font-bold leading-5 text-white">{priceText}</p></>;
  const cta = <>
    {!ordersEnabled && <p className="mb-2 text-xs text-white/60">{t.orderOrdersOff}</p>}
    {stage === 3 && currentQuote && !attempted && <p role="status" className="mb-3 text-sm leading-5 text-white/80">{currentQuote.total !== packageTotal ? fill(t.orderPriceChanged, { from: money(packageTotal), to: money(currentQuote.total) }) : ""}{fill(t.orderConsent, { total: money(currentQuote.payable) })}</p>}
    {canOpenSheet && tier && <button type="button" onClick={(event) => { sheetOpener.current = event.currentTarget; setSheet(true); }} aria-haspopup="dialog" aria-expanded={sheet} aria-label={fill(t.orderDetailsAria, { detail: `${qty != null && quantityValid ? `${n(qty)}, ` : ""}${tierName}` })} className="ax-glass-card mb-1.5 flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-xs xl:hidden"><span className="min-w-0 truncate text-white/80">{qty != null && quantityValid ? <span className="font-semibold text-white">{n(qty)} · </span> : null}{tierName} · {refillLabel(tier.refill_days)}</span><span className="flex shrink-0 items-center gap-1 font-semibold text-[#00E5FF]">{t.orderDetails}<ChevronUp size={14} aria-hidden="true" /></span></button>}
    <div className="flex items-center gap-3"><div className={totalCls}>{totalBlock}</div>{(stage === 2 || stage === 3) && !attempted && <button type="button" disabled={!!busy} onClick={() => goToStage(stage - 1)} aria-label={fill(t.orderBackTo, { label: stage === 2 ? stageLabels[0] : stageLabels[1] })} title={t.orderBack} className="ax-glass-card inline-flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white/75 transition hover:text-white disabled:opacity-40"><ArrowLeft size={18} aria-hidden="true" /></button>}<button type="button" onClick={stage < 3 ? advance : pay} disabled={!ordersEnabled || !!busy} className="pedia-cta min-h-12 min-w-0 flex-1 rounded-xl bg-[#00E5FF] px-2 py-3 text-sm font-semibold max-[379px]:text-[13px] sm:px-3 text-[#070a1e] hover:bg-[#70f2ff] disabled:bg-white/10 disabled:text-white/60">{busy || (stage === 1 ? t.orderCtaNext : stage === 2 ? t.orderCtaContact : currentQuote && !attempted ? t.orderCtaApprove : attempted ? t.orderCtaRetry : <><span className="max-xl:sr-only">{t.orderCtaPay}</span><span aria-hidden="true" className="hidden max-xl:inline">{t.orderCtaPayShort}</span></>)}<ArrowRight aria-hidden="true" size={16} className="ml-2 inline shrink-0 max-[399px]:hidden" /></button></div>
  </>;
  return <div className={`pedia-checkout ${embedded ? "py-5" : withinPlatform ? `${stage === 3 && currentQuote && !attempted ? "pb-56" : "pb-40"} xl:pb-8` : `mx-auto max-w-[1280px] px-4 ${stage === 3 && currentQuote && !attempted ? "pb-56" : "pb-40"} pt-6 sm:px-6 lg:px-8 xl:pb-12`}`}>
        {!embedded && !withinPlatform && stage === 1 && <a href={`/pedia/p/${product.platform}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/60"><ArrowLeft size={16} aria-hidden="true" />{platform}</a>}
    {!withinPlatform && <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">{productName}</h1>}
    <ol className="mt-3 flex items-center gap-1 sm:mt-4 sm:gap-3" aria-label={t.orderStepsAria}>
      {stageLabels.map((label, i) => <li key={label} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-3">
        <button type="button" disabled={i + 1 > stage || attempted} onClick={() => { if (i + 1 < stage) goToStage(i + 1); }} aria-current={i + 1 === stage ? "step" : undefined} aria-label={fill(t.orderStepAria, { n: i + 1, label })} className="group flex min-h-11 items-center gap-1 text-xs font-semibold disabled:cursor-default sm:text-[13px]">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${i + 1 < stage ? "border-[#00E5FF] bg-[#00E5FF] text-[#080C1E]" : i + 1 === stage ? "border-[#00E5FF] text-[#00E5FF]" : "border-white/15 text-white/65"}`}>{i + 1 < stage ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
          <span className={i + 1 === stage ? "text-white" : i + 1 < stage && !attempted ? "text-white/55 group-hover:text-white max-sm:hidden" : "text-white/55 max-sm:hidden"}>{label}</span>
        </button>{i < 3 && <span aria-hidden="true" className={`h-px min-w-1 flex-1 ${i + 1 < stage ? "bg-[#00E5FF]" : "bg-white/10"}`} />}
      </li>)}
    </ol>
    {stage === 1 && <div className="mt-4 pb-1 xl:mt-5 xl:pb-4">
      <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">{t.orderTitle}</h2>
      {products.length > 0 && <NeedPicker products={products} slug={product.slug} platform={platform} locked={attempted} onChange={(slug) => {
        if (!attempted) onProductChange?.(slug, { slug: product.slug, targetKind: product.target_kind, tierId, qty, target, checks, wa, email });
      }} />}
    </div>}
    <div className="mt-3 grid items-start gap-5 xl:mt-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-6">
      <div className="min-w-0">
        {stage === 1 && <>
          <section aria-labelledby="pedia-stage-heading">
            <div>
            <fieldset id="pedia-quantity" tabIndex={-1} disabled={attempted} className="ax-glass-card min-w-0 rounded-2xl p-3.5">
              <legend className="sr-only">{t.orderQtyTitle}</legend><p aria-hidden="true" className="text-sm font-bold text-white">{t.orderQtyTitle}</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"><input id="pedia-qty-input" aria-label={t.orderQtyAria} aria-invalid={!!errors.quantity} type="number" inputMode="numeric" min={tier?.min_qty ?? productMin} max={tier?.max_qty ?? undefined} step={tier?.quantity_step ?? product.step} value={qty ?? ""} placeholder={fill(t.orderQtyPlaceholder, { qty: n(tier?.min_qty ?? productMin) })} onChange={(e) => { const v = e.target.value; setQty(v === "" ? null : Number(v)); setQuantityNotice(""); }} autoComplete="off" enterKeyHint="next" className="min-h-11 w-full rounded-xl border border-white/30 bg-white/[0.035] px-3.5 text-base text-white placeholder:text-white/55 focus:border-[#00E5FF] focus:outline-none disabled:opacity-40 sm:w-36 md:text-sm" />
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">{(tier?.quick_quantities?.length ? tier.quick_quantities.filter((q) => q >= (tier.min_qty ?? 1) && q <= (tier.max_qty ?? q) && q % (tier.quantity_step ?? product.step) === 0) : productExamples).slice(0, 5).map((q) => <button key={q} type="button" onClick={() => { setQty(q); setQuantityNotice(""); }} aria-pressed={qty === q} className={`min-h-11 shrink-0 rounded-xl border px-3 text-[13px] transition ${qty === q ? "border-[#00E5FF]/45 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/10 text-white/60 hover:border-white/25"}`}>{q >= 1000 ? `${q / 1000}k` : n(q)}</button>)}</div>
              </div>
              {!errors.quantity && <p className="mt-2 text-xs leading-5 text-white/65">{tier ? fill(t.orderQtyHint, { range: tier.max_qty != null ? fill(t.orderQtyRange, { min: n(tier.min_qty ?? 1), max: n(tier.max_qty) }) : fill(t.orderQtyRangeOrMore, { min: n(tier.min_qty ?? 1) }), step: (tier.quantity_step ?? product.step) > 1 ? fill(t.orderQtyStep, { step: n(tier.quantity_step ?? product.step) }) : "" }) : t.orderQtyHintNone}</p>}
              {quantityNotice && <p role="status" className="mt-2 text-xs text-amber-200">{quantityNotice}</p>}{inlineError("quantity")}
              <div role="status" aria-live="polite">{qty != null && comparison?.failed && <p className="mt-2 text-[13px] leading-5 text-white/65">{t.orderPriceRetry} <button type="button" disabled={attempted} onClick={comparison.retry} className="min-h-11 font-medium text-[#00E5FF] underline underline-offset-4 disabled:opacity-40">{t.orderPriceRetryAction}</button></p>}</div>
            </fieldset></div>
            <div className="mt-5 xl:mt-6"><ServicePicker key={product.metric} product={product} products={products.length ? variants : undefined} tierId={tierId} onSelect={pickTier} onClear={() => setTierId(null)} qty={qty} prices={comparisonPrices} pricesSettled={embedded || !!comparison} locked={attempted} expanded info={(t) => <ServiceInfoCard t={t} productDescription={productDescription} productName={product.name} />} />{inlineError("tier")}</div>
          </section>
        </>}
        {stage === 2 && <section aria-labelledby="pedia-stage-heading">
            <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">{fill(t.orderTargetTitle, { kind: kind.toLowerCase() })}</h2>
            <p className="mt-1.5 text-sm text-white/60">{fill(t.orderTargetLead, { platform })}</p>
            <fieldset disabled={attempted} className="mt-4"><label htmlFor="pedia-target" className="text-[13px] text-white/70">{fill(t.orderTargetLabel, { kind: kind.toLowerCase(), platform })}</label><input id="pedia-target" value={target} placeholder={pediaTargetExample(product.platform, product.target_kind)} onChange={(e) => setTarget(e.target.value)} inputMode="url" autoComplete="off" autoCapitalize="none" enterKeyHint="next" spellCheck={false} maxLength={600} className={`${fieldClass} ${targetOk ? "border-emerald-400/60" : ""}`} aria-invalid={!!errors.target || (!!target.trim() && !targetOk)} aria-describedby="pedia-target-help" />
              <p id="pedia-target-help" className="mt-2 text-xs leading-5 text-white/50">{targetHelp}</p>
              {targetOk && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[#00E5FF]"><span aria-hidden="true">✓</span>{t.orderTargetOk}</p>}
              {errors.target ? inlineError("target") : target.trim() && !targetOk && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-red-300"><span aria-hidden="true">✕</span>{t.orderTargetBad}</p>}
              {customComments && <div className="mt-5"><label htmlFor="pedia-comments" className="text-[13px] text-white/70">{t.orderCommentsLabel}</label>
                <textarea id="pedia-comments" value={comments} onChange={(e) => setComments(e.target.value)} rows={6} maxLength={CUSTOM_COMMENT_MAX_TOTAL} aria-invalid={!!errors.comments} aria-describedby="pedia-comments-help" placeholder={t.orderCommentsPlaceholder} className={`${fieldClass} min-h-36 py-3 leading-6`} />
                <p id="pedia-comments-help" className={`mt-2 text-xs leading-5 ${qty != null && parseCustomComments(comments).length === qty ? "text-[#00E5FF]" : "text-white/50"}`}>{fill(t.orderCommentsHelp, { filled: n(parseCustomComments(comments).length), total: n(qty ?? 0), max: n(CUSTOM_COMMENT_MAX_CHARS) })}</p>
                {inlineError("comments")}</div>}
              {checklist.length > 0 && <div id="pedia-requirements" tabIndex={-1} className="ax-glass-card mt-5 space-y-1.5 rounded-2xl p-3.5"><p className="mb-2 flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck size={15} aria-hidden="true" className="text-[#00E5FF]" />{t.orderChecklistTitle}</p>{checklist.map((c) => <label key={c.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 text-[13px] leading-5 text-white/75 transition hover:bg-white/[0.04] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#00E5FF]"><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => { const checked = e.target.checked; setChecks((current) => ({ ...current, [c.id]: checked })); }} className="peer sr-only" /><span aria-hidden="true" className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/40 text-transparent transition peer-checked:border-[#00E5FF] peer-checked:bg-[#00E5FF] peer-checked:text-[#080C1E]"><Check size={12} strokeWidth={3} /></span><span>{pediaChecklistText(c.label, locale)}{c.help && <span className="mt-1 block text-xs leading-5 text-white/65">{pediaChecklistText(c.help, locale)}</span>}</span></label>)}</div>}{inlineError("requirements")}
            </fieldset>
        </section>}
        {stage === 2 && guideLines.length > 0 && <div className="ax-glass-card mt-4 rounded-2xl p-3.5 text-[13px] leading-6 text-white/70"><h3 className="text-sm font-bold text-white">{t.orderGuideTitle}</h3><div className="mt-2 space-y-1 break-words">{guideLines.map((l, i) => <p key={i}>{pediaServiceText(l, locale)}</p>)}</div></div>}
        {stage === 3 && <section aria-labelledby="pedia-stage-heading">
          <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">{t.orderContactTitle}</h2>
          <fieldset disabled={attempted} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="pedia-wa" className="text-[13px] text-white/70">{t.orderWa}</label><input id="pedia-wa" type="tel" inputMode="tel" enterKeyHint="next" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder={t.orderWaPlaceholder} className={fieldClass} aria-invalid={!!errors.wa} aria-describedby="pedia-wa-help" /><p id="pedia-wa-help" className="mt-2 text-xs leading-5 text-white/50">{t.orderWaHelp}</p>{inlineError("wa")}</div>
            <div><label htmlFor="pedia-email" className="text-[13px] text-white/70">{t.orderEmail}</label><input id="pedia-email" type="email" inputMode="email" enterKeyHint="done" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} placeholder={t.orderEmailPlaceholder} className={fieldClass} aria-invalid={!!errors.email} /><p className="mt-2 text-xs leading-5 text-white/50">{t.orderEmailHelp}</p>{inlineError("email")}</div>
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-white">{t.orderPaymentMethod}</h3>
                {!methodsOpen && <button type="button" disabled={attempted} onClick={() => setMethodsOpen(true)} className="min-h-11 text-[13px] font-semibold text-[#00E5FF] underline underline-offset-4 disabled:opacity-40">{t.orderMethodsOther}</button>}
              </div>
              {!methodsOpen
                ? <p className="mt-1 text-xs leading-5 text-white/55">{t.orderMethodsQrisDefault}</p>
                : methodsBusy && methodOptions.length === 0 ? <p role="status" className="mt-2 text-xs text-white/55">{t.orderMethodsLoading}</p>
                : methodsError ? <div role="alert" className="mt-2 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{methodsError} <button type="button" onClick={() => setMethodsAttempt((value) => value + 1)} className="min-h-11 font-semibold text-[#00E5FF] underline underline-offset-4">{t.orderMethodsRetry}</button></div>
                : methodOptions.length > 0 ? <div className="mt-2"><PaymentMethodPicker options={methodOptions} selectedId={method} onSelect={(id) => { setSelectionNotice(null); setMethod(id); }} locale={locale} disabled={attempted} notice={selectionNotice} /></div>
                : <p className="mt-2 text-xs text-white/55">{t.orderMethodsNone} <button type="button" onClick={() => setMethodsAttempt((value) => value + 1)} className="min-h-11 font-semibold text-[#00E5FF] underline underline-offset-4">{t.orderMethodsRetry}</button></p>}
            </div>
            <div className="ax-glass-card rounded-2xl p-3.5 text-[13px] leading-6 text-white/70 sm:col-span-2">{termLines.length > 0 && <><h3 className="text-sm font-bold text-white">{t.orderTermsTitle}</h3><ul className="mt-2 space-y-1.5">{shownTerms.map((l, i) => <li key={i} className="flex gap-2 break-words"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#00E5FF]" /><span>{pediaServiceText(l, locale)}</span></li>)}</ul>{moreTerms.length > 0 && <details className="mt-1.5"><summary className="flex min-h-9 cursor-pointer list-none items-center text-[13px] font-semibold text-[#00E5FF] [&::-webkit-details-marker]:hidden">{fill(t.orderTermsAll, { count: pediaNumber(termLines.length, locale) })}</summary><ul className="space-y-1.5">{moreTerms.map((l, i) => <li key={i} className="flex gap-2 break-words"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/40" /><span>{pediaServiceText(l, locale)}</span></li>)}</ul></details>}</>}<div className={termLines.length > 0 ? "mt-3 border-t border-white/10 pt-2" : ""}><label className="flex min-h-11 cursor-pointer items-start gap-3 text-[13px] leading-6 text-white/80 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#00E5FF]"><input id="pedia-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="peer sr-only" /><span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/40 text-transparent transition peer-checked:border-[#00E5FF] peer-checked:bg-[#00E5FF] peer-checked:text-[#080C1E]"><Check size={12} strokeWidth={3} /></span><span>{agreeBefore}<a href="/pedia/ketentuan" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] underline underline-offset-4">{t.orderAgreeLink}</a>{agreeAfter}</span></label>{inlineError("agree")}</div></div>
          </fieldset>
        </section>}
        {recoveryCode && <p className="mt-4 text-sm text-white/75">{recoveryBefore}<strong className="font-mono">{recoveryCode}</strong>{recoveryAfter}</p>}
        {error && <p ref={errorRef} role="alert" className="mt-4 rounded-xl border border-red-300/25 p-3 text-sm leading-6 text-red-200">{error}</p>}
      </div>
      <aside ref={summaryRef} className={`${embedded ? "" : "max-xl:hidden "}min-w-0 overflow-hidden ax-glass-card ax-liquid relative rounded-[24px] bg-[#0e1224] xl:col-start-2 xl:row-span-2 xl:row-start-1 ${summaryFits ? "xl:sticky xl:top-24" : ""}`}>{summary()}</aside>
      {stage === 1 && !tier && productDescription && <section aria-labelledby="pedia-detail-heading" className="ax-glass-card ax-liquid relative min-w-0 rounded-2xl p-3.5 text-[13px] leading-6 text-white/70 xl:col-start-1">
        <h3 id="pedia-detail-heading" className="text-sm font-bold text-white">{t.aboutService}</h3>
        <p className="mt-2 whitespace-pre-line break-words">{productDescription}</p>
      </section>}
    </div>
    <div className={embedded ? "mt-5 xl:hidden" : "pedia-mobile-action ax-glass-strong fixed inset-x-0 bottom-0 z-40 rounded-t-2xl px-4 pt-3.5 xl:hidden"} style={embedded ? undefined : { paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{canOpenSheet && <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-white/25" />}{cta}</div>
    {sheet && canOpenSheet && <div className="fixed inset-0 z-[60] xl:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSheet(false)} />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={t.orderSheetAria} className="pedia-sheet ax-glass-strong absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-[24px] bg-[#0e1224]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button type="button" onClick={() => setSheet(false)} aria-label={t.orderSheetClose} className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/15 hover:text-white"><X size={18} aria-hidden="true" /></button>
        {summary(false)}
      </div>
    </div>}
  </div>;
}
