"use client";

import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import { orderCheckoutPath } from "@/lib/order-access-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, PEDIA_TARGET_KIND_LABEL, pediaTargetMatches, type PediaPlatform, type PediaTargetKind } from "@/lib/pedia/link";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { ServiceChips, ServicePicker } from "@/components/pedia/ServicePicker";
import { ServiceInfoCard } from "@/components/pedia/ServiceInfoCard";
import { usePediaPrices } from "@/components/pedia/usePediaPrices";
import { ArrowLeft, ArrowRight, Check, ChevronUp, ShieldCheck, X } from "lucide-react";
import { NeedPicker } from "@/components/pedia/NeedPicker";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { pediaPlatform, pediaTargetExample } from "@/lib/pedia/platforms";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID")}`;
const fieldClass = "mt-2 min-h-11 w-full rounded-xl border border-white/30 bg-white/[0.035] px-3.5 text-base text-white placeholder:text-white/55 focus:border-[#00E5FF] focus:outline-none md:text-sm";

/** Hasil order ambigu: retry memakai quote yang sama sehingga tidak ada tagihan kedua. */
export const RETRY_MESSAGE = "Pesanan belum berhasil dibuat. Tekan Coba lagi; kamu tidak akan ditagih dua kali.";
// Baris panduan supplier yang hanya mengulang alur checkout (pilih layanan, isi kontak, bayar, pantau).
const GENERIC_GUIDE_LINE = /pilih layanan dan jumlah|masukkan jumlah, bandingkan|baca ketentuan dan konfirmasi|isi kontak, periksa total|periksa ketentuan, isi whatsapp|setelah pembayaran terkonfirmasi|pantau proses melalui/i;
// Ketentuan yang paling sering memicu kendala tampil lebih dulu; sisanya dilipat.
const KEY_TERM = /refill|garansi|jangan|privat|tunggu/i;

export type PediaOrderDraft = { slug: string; targetKind: string; tierId: number | null; qty: number | null; target: string; checks: Record<string, boolean>; wa: string; email: string };

export function OrderClient({ product, initialTarget, initialDraft, ordersEnabled, embedded = false, withinPlatform = false, onLockedChange, products = [], onProductChange }: { product: PediaCatalogProduct; initialTarget: string; initialDraft?: PediaOrderDraft; ordersEnabled: boolean; embedded?: boolean; withinPlatform?: boolean; onLockedChange?: (locked: boolean) => void; products?: PediaCatalogProduct[]; onProductChange?: (slug: string, draft: PediaOrderDraft) => void }) {
  const draft = initialDraft?.slug === product.slug && initialDraft.targetKind === product.target_kind ? initialDraft : undefined;
  const [stage, setStage] = useState(1);
  const [quantityNotice, setQuantityNotice] = useState("");
  const [tierId, setTierId] = useState<number | null>(draft?.tierId ?? null);
  const [qty, setQty] = useState<number | null>(draft?.qty ?? null);
  const [target, setTarget] = useState(draft?.target ?? initialTarget);
  const [checks, setChecks] = useState<Record<string, boolean>>(draft?.checks ?? {});
  const [wa, setWa] = useState(draft?.wa ?? "");
  const [email, setEmail] = useState(draft?.email ?? "");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [quote, setQuote] = useState<{ key: string; quote_token: string; total: number; payable: number; expires: number } | null>(null);
  const tier = product.tiers.find((t) => t.id === tierId);
  const checklist = product.checklist ?? [];
  const platform = PEDIA_PLATFORM_LABEL[product.platform as PediaPlatform] ?? product.platform;
  const kind = PEDIA_TARGET_KIND_LABEL[product.target_kind as PediaTargetKind] ?? product.target_kind;
  const detected = detectPediaLink(target, product.platform);
  const kindOk = detected && pediaTargetMatches(product.target_kind, detected.targetKind, product);
  const targetOk = !!detected && detected.platform === product.platform && !!kindOk && target.trim().length <= 600;
  const waOk = /^(\+62|62|0)8\d{8,13}$/.test(wa.trim().replace(/\s|-/g, ""));
  const emailOk = z.string().email().max(160).safeParse(email.trim()).success;
  const key = JSON.stringify([product.slug, tierId, qty, target.trim(), wa.trim(), email.trim(), checks, agree, ordersEnabled]);
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
  const targetHelp = `Contoh: ${pediaTargetExample(product.platform, product.target_kind).replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}. ${product.target_kind === "profile" ? "Akun harus publik." : "Konten harus bisa dibuka publik."}`;

  useEffect(() => {
    quoteController.current?.abort();
    setQuote(null);
    setError("");
    setErrors({});
    return () => { quoteController.current?.abort(); };
  }, [key]);

  const validate = (throughStage = 3) => {
    const next: Record<string, string> = {};
    if (!tier) next.tier = "Pilih layanan terlebih dahulu.";
    if (qty == null || !Number.isSafeInteger(qty)) {
      next.quantity = "Isi jumlah yang ingin dipesan.";
    } else if (!tier) {
      next.quantity = "Isi jumlah, lalu pilih layanan yang cocok untuk jumlah itu.";
    } else if (qty < (tier.min_qty ?? 1) || qty > (tier.max_qty ?? Infinity) || qty % (tier.quantity_step ?? product.step) !== 0) {
      next.quantity = `Jumlah ${qty.toLocaleString("id-ID")} tidak tersedia untuk layanan ini: minimal ${(tier.min_qty ?? 1).toLocaleString("id-ID")}, maksimal ${(tier.max_qty ?? 0).toLocaleString("id-ID")}${(tier.quantity_step ?? product.step) > 1 ? `, kelipatan ${tier.quantity_step ?? product.step}` : ""}. Jumlah tetap ${qty.toLocaleString("id-ID")}. Ubah jumlah atau pilih layanan lain.`;
    }
    if (throughStage >= 2 && !targetOk) next.target = `Masukkan link ${kind.toLowerCase()} ${platform} yang sesuai layanan ini.`;
    if (throughStage >= 2 && !checklist.every((c) => checks[c.id])) next.requirements = "Konfirmasi semua persyaratan tujuan sebelum melanjutkan.";
    if (throughStage >= 3 && !waOk) next.wa = "Masukkan nomor WhatsApp 08... atau +62... yang benar.";
    if (throughStage >= 3 && !emailOk) next.email = "Masukkan alamat email yang benar (maksimal 160 karakter).";
    if (throughStage >= 3 && !agree) next.agree = "Setujui Ketentuan Pedia sebelum melanjutkan.";
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
      if (!readyQuote || (!attempted && readyQuote.expires <= Date.now())) {
        setQuote(null);
        setBusy("Memeriksa harga...");
        const response = await fetchWithTimeout("/api/pedia/quote", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ product_slug: product.slug, tier_id: tierId, quantity: qty, target: target.trim() }),
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
        body: JSON.stringify({ customer_wa: wa.trim(), customer_email: email.trim(), quote_token: readyQuote.quote_token }),
      }, 60_000);
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 500 && typeof data.code === "string" && /^AXP-\d{8}-[A-Z0-9]{8}$/.test(data.code)) setRecoveryCode(data.code);
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          setAttempted(false);
          setQuote(null);
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
      setError(orderStarted ? serverMessage ?? RETRY_MESSAGE : e instanceof Error ? e.message : "Koneksi terputus.");
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
  const priceText = currentQuote ? rupiah(currentQuote.payable) : packageTotal > 0 ? rupiah(packageTotal) : !tier ? "Pilih layanan" : !qty ? "Isi jumlah" : !quantityValid ? "Periksa jumlah" : embedded || comparison ? "Harga belum tersedia" : "Memeriksa harga…";
  const brandColor = pediaPlatform(product.platform)?.color ?? "#00E5FF";
  const summary = (withCta = true) => <>
    <div className="flex items-center gap-3 border-b border-white/10 p-5 max-xl:pr-16" style={{ background: `linear-gradient(115deg, ${brandColor}26, #0F143080 70%), #080C1E` }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]"><PlatformIcon id={product.platform} size={25} /></span>
      <div className="min-w-0"><h2 className="text-xs text-white/65">Ringkasan pesanan</h2><p className="mt-1 text-sm font-semibold text-white">{product.name}</p></div>
    </div>
    <div className="p-4">
      {tier ? <>
        <p className="text-sm font-semibold leading-5 text-white">{tier.public_name ?? tier.label_note ?? "Layanan terpilih"}</p>
        <div className="mt-2"><ServiceChips t={tier} eta /></div>
        {tier.description && <p className="mt-3 whitespace-pre-line break-words text-[13px] leading-6 text-white/70">{tier.description}</p>}
        <dl className="mt-4 space-y-2.5 text-[13px] text-white/65">
          {qty != null && <div className="flex justify-between gap-4"><dt>Jumlah</dt><dd className="text-right tabular-nums text-white">{qty.toLocaleString("id-ID")}</dd></div>}
          {tier.eta_finish && <div className="flex justify-between gap-4"><dt>Estimasi selesai</dt><dd className="text-right text-white/70">{tier.eta_finish}</dd></div>}
          {targetOk && <div><dt>Tujuan</dt><dd className="mt-1 break-all leading-5 text-white/80">{target.trim()}</dd></div>}
        </dl>
        <div className="mt-4 border-t border-white/10 pt-3"><div className="flex items-baseline justify-between gap-3"><p className="text-[13px] text-white/65">{currentQuote ? "Total terkonfirmasi" : "Total pesanan"}</p><p className={`text-[17px] font-bold leading-6 tracking-[-0.02em] ${packageTotal > 0 || currentQuote ? "text-white" : "text-white/80"}`}>{!currentQuote && !qty ? <><span aria-hidden="true">—</span><span className="sr-only">Belum ada total</span></> : priceText}</p></div>
        {(currentQuote || !qty) && <p className="mt-1 text-[11px] leading-4 text-white/65">{currentQuote ? "Nominal QRIS ditampilkan di halaman pembayaran." : "Isi jumlah untuk melihat total pesananmu."}</p>}</div>
      </> : <div>
        <ol className="space-y-2.5 text-[13px] leading-5 text-white/70">
          {["Isi jumlah dan pilih layanan", "Tempel link tujuan", "Bayar QRIS dan pantau status"].map((t, i) => <li key={t} className="flex items-center gap-3"><span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#00E5FF]/40 text-xs font-semibold text-[#00E5FF]">{i + 1}</span>{t}</li>)}
        </ol>
        <p className="mt-4 text-[13px] leading-5 text-white/65">Isi jumlah dan pilih layanan untuk melihat rincian pesananmu.</p>
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
  const pickTier = (id: number) => {
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
    : <><p className="whitespace-nowrap text-xs text-white/65"><span className="max-[379px]:hidden">Total pesanan</span><span aria-hidden="true" className="hidden max-[379px]:inline">Total</span></p><p className="mt-1 break-words text-sm font-bold leading-5 text-white">{priceText}</p></>;
  const cta = <>
    {!ordersEnabled && <p className="mb-2 text-xs text-white/60">Pemesanan belum tersedia. Kamu tetap bisa membandingkan layanan.</p>}
    {stage === 3 && currentQuote && !attempted && <p role="status" className="mb-3 text-sm leading-5 text-white/80">{currentQuote.total !== packageTotal ? `Harga berubah dari ${rupiah(packageTotal)} menjadi ${rupiah(currentQuote.total)}. ` : ""}Total pembayaran {rupiah(currentQuote.payable)}. Tekan Setujui untuk menyetujui nominal ini.</p>}
    {canOpenSheet && tier && <button type="button" onClick={(event) => { sheetOpener.current = event.currentTarget; setSheet(true); }} aria-haspopup="dialog" aria-expanded={sheet} aria-label={`Lihat rincian pesanan: ${qty != null && quantityValid ? `${qty.toLocaleString("id-ID")}, ` : ""}${tier.public_name ?? tier.label_note ?? product.name}`} className="ax-glass-card mb-1.5 flex min-h-10 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-xs xl:hidden"><span className="min-w-0 truncate text-white/80">{qty != null && quantityValid ? <span className="font-semibold text-white">{qty.toLocaleString("id-ID")} · </span> : null}{tier.public_name ?? tier.label_note ?? product.name}</span><span className="flex shrink-0 items-center gap-1 font-semibold text-[#00E5FF]">Rincian<ChevronUp size={14} aria-hidden="true" /></span></button>}
    <div className="flex items-center gap-3"><div className={totalCls}>{totalBlock}</div>{(stage === 2 || stage === 3) && !attempted && <button type="button" disabled={!!busy} onClick={() => goToStage(stage - 1)} aria-label={`Kembali ke langkah ${stage === 2 ? "Layanan" : "Target"}`} title="Kembali" className="ax-glass-card inline-flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white/75 transition hover:text-white disabled:opacity-40"><ArrowLeft size={18} aria-hidden="true" /></button>}<button type="button" onClick={stage < 3 ? advance : pay} disabled={!ordersEnabled || !!busy} className="pedia-cta min-h-12 min-w-0 flex-1 rounded-xl bg-[#00E5FF] px-2 py-3 text-sm font-semibold max-[379px]:text-[13px] sm:px-3 text-[#070a1e] hover:bg-[#70f2ff] disabled:bg-white/10 disabled:text-white/60">{busy || (stage === 1 ? "Lanjut: isi target" : stage === 2 ? "Lanjut: kontak" : currentQuote && !attempted ? "Setujui & lanjut ke pembayaran" : attempted ? "Coba lagi" : <><span className="max-xl:sr-only">Lanjut ke pembayaran</span><span aria-hidden="true" className="hidden max-xl:inline">Lanjut bayar</span></>)}<ArrowRight aria-hidden="true" size={16} className="ml-2 inline shrink-0 max-[399px]:hidden" /></button></div>
  </>;
  return <div className={`pedia-checkout ${embedded ? "py-5" : withinPlatform ? `${stage === 3 && currentQuote && !attempted ? "pb-56" : "pb-40"} xl:pb-8` : `mx-auto max-w-[1280px] px-4 ${stage === 3 && currentQuote && !attempted ? "pb-56" : "pb-40"} pt-6 sm:px-6 lg:px-8 xl:pb-12`}`}>
        {!embedded && !withinPlatform && stage === 1 && <a href={`/pedia/p/${product.platform}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/60"><ArrowLeft size={16} aria-hidden="true" />{platform}</a>}
    {!withinPlatform && <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">{product.name}</h1>}
    <ol className="mt-3 flex items-center gap-1 sm:mt-4 sm:gap-3" aria-label="Langkah pesanan">
      {["Layanan", "Target", "Kontak", "Bayar"].map((label, i) => <li key={label} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-3">
        <button type="button" disabled={i + 1 > stage || attempted} onClick={() => { if (i + 1 < stage) goToStage(i + 1); }} aria-current={i + 1 === stage ? "step" : undefined} aria-label={`Langkah ${i + 1}: ${label}`} className="group flex min-h-11 items-center gap-1 text-xs font-semibold disabled:cursor-default sm:text-[13px]">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${i + 1 < stage ? "border-[#00E5FF] bg-[#00E5FF] text-[#080C1E]" : i + 1 === stage ? "border-[#00E5FF] text-[#00E5FF]" : "border-white/15 text-white/65"}`}>{i + 1 < stage ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
          <span className={i + 1 === stage ? "text-white" : i + 1 < stage && !attempted ? "text-white/55 group-hover:text-white max-sm:hidden" : "text-white/55 max-sm:hidden"}>{label}</span>
        </button>{i < 3 && <span aria-hidden="true" className={`h-px min-w-1 flex-1 ${i + 1 < stage ? "bg-[#00E5FF]" : "bg-white/10"}`} />}
      </li>)}
    </ol>
    {stage === 1 && <div className="mt-4 pb-1 xl:mt-5 xl:pb-4">
      <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">Apa yang ingin ditingkatkan?</h2>
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
              <legend className="sr-only">Berapa jumlahnya?</legend><p aria-hidden="true" className="text-sm font-bold text-white">Berapa jumlahnya?</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"><input id="pedia-qty-input" aria-label="Jumlah yang dipesan" aria-invalid={!!errors.quantity} type="number" inputMode="numeric" min={tier?.min_qty ?? productMin} max={tier?.max_qty ?? undefined} step={tier?.quantity_step ?? product.step} value={qty ?? ""} placeholder={`Contoh: ${productMin.toLocaleString("id-ID")}`} onChange={(e) => { const v = e.target.value; setQty(v === "" ? null : Number(v)); setQuantityNotice(""); }} autoComplete="off" enterKeyHint="next" className="min-h-11 w-full rounded-xl border border-white/30 bg-white/[0.035] px-3.5 text-base text-white placeholder:text-white/55 focus:border-[#00E5FF] focus:outline-none disabled:opacity-40 sm:w-36 md:text-sm" />
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">{(tier?.quick_quantities?.length ? tier.quick_quantities.filter((n) => n >= (tier.min_qty ?? 1) && n <= (tier.max_qty ?? n) && n % (tier.quantity_step ?? product.step) === 0) : productExamples).slice(0, 5).map((n) => <button key={n} type="button" onClick={() => { setQty(n); setQuantityNotice(""); }} aria-pressed={qty === n} className={`min-h-11 shrink-0 rounded-xl border px-3 text-[13px] transition ${qty === n ? "border-[#00E5FF]/45 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/10 text-white/60 hover:border-white/25"}`}>{n >= 1000 ? `${n / 1000}k` : n.toLocaleString("id-ID")}</button>)}</div>
              </div>
              {!errors.quantity && <p className="mt-2 text-xs leading-5 text-white/65">{tier ? `Layanan terpilih menerima ${(tier.min_qty ?? 1).toLocaleString("id-ID")}${tier.max_qty != null ? `–${tier.max_qty.toLocaleString("id-ID")}` : " atau lebih"} per pesanan.${(tier.quantity_step ?? product.step) > 1 ? ` Kelipatan ${(tier.quantity_step ?? product.step).toLocaleString("id-ID")}.` : ""}` : "Pilih layanan untuk melihat batas jumlah per pesanan."}</p>}
              {quantityNotice && <p role="status" className="mt-2 text-xs text-amber-200">{quantityNotice}</p>}{inlineError("quantity")}
              <div role="status" aria-live="polite">{qty != null && comparison?.failed && <p className="mt-2 text-[13px] leading-5 text-white/65">Harga terbaru belum dapat dimuat. Harga akan diperiksa kembali sebelum pembayaran. <button type="button" disabled={attempted} onClick={comparison.retry} className="min-h-11 font-medium text-[#00E5FF] underline underline-offset-4 disabled:opacity-40">Coba muat harga lagi</button></p>}</div>
            </fieldset></div>
            <div className="mt-5 xl:mt-6"><ServicePicker product={product} tierId={tierId} onSelect={pickTier} qty={qty} prices={comparisonPrices} pricesSettled={embedded || !!comparison} locked={attempted} expanded />{inlineError("tier")}{tier && <div className="mt-3"><ServiceInfoCard t={tier} /></div>}</div>
          </section>
        </>}
        {stage === 2 && <section aria-labelledby="pedia-stage-heading">
            <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">Link {kind.toLowerCase()} tujuan</h2>
            <p className="mt-1.5 text-sm text-white/60">Salin dari aplikasi {platform}, lalu tempel di sini. Kami cek formatnya langsung.</p>
            <fieldset disabled={attempted} className="mt-4"><label htmlFor="pedia-target" className="text-[13px] text-white/70">Link {kind.toLowerCase()} {platform}</label><input id="pedia-target" value={target} placeholder={pediaTargetExample(product.platform, product.target_kind)} onChange={(e) => setTarget(e.target.value)} inputMode="url" autoComplete="off" autoCapitalize="none" enterKeyHint="next" spellCheck={false} maxLength={600} className={`${fieldClass} ${targetOk ? "border-emerald-400/60" : ""}`} aria-invalid={!!errors.target || (!!target.trim() && !targetOk)} aria-describedby="pedia-target-help" />
              <p id="pedia-target-help" className="mt-2 text-xs leading-5 text-white/50">{targetHelp}</p>
              {targetOk && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[#00E5FF]"><span aria-hidden="true">✓</span>Format link sesuai</p>}
              {errors.target ? inlineError("target") : target.trim() && !targetOk && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-red-300"><span aria-hidden="true">✕</span>Format link tidak sesuai</p>}
              {checklist.length > 0 && <div id="pedia-requirements" tabIndex={-1} className="ax-glass-card mt-5 space-y-1.5 rounded-2xl p-3.5"><p className="mb-2 flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck size={15} aria-hidden="true" className="text-[#00E5FF]" />Sebelum lanjut, pastikan hal berikut</p>{checklist.map((c) => <label key={c.id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl px-2 py-2.5 text-[13px] leading-5 text-white/75 transition hover:bg-white/[0.04] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#00E5FF]"><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => { const checked = e.target.checked; setChecks((current) => ({ ...current, [c.id]: checked })); }} className="peer sr-only" /><span aria-hidden="true" className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/40 text-transparent transition peer-checked:border-[#00E5FF] peer-checked:bg-[#00E5FF] peer-checked:text-[#080C1E]"><Check size={12} strokeWidth={3} /></span><span>{c.label}{c.help && <span className="mt-1 block text-xs leading-5 text-white/65">{c.help}</span>}</span></label>)}</div>}{inlineError("requirements")}
            </fieldset>
        </section>}
        {stage === 2 && guideLines.length > 0 && <div className="ax-glass-card mt-4 rounded-2xl p-3.5 text-[13px] leading-6 text-white/70"><h3 className="text-sm font-bold text-white">Panduan layanan</h3><div className="mt-2 space-y-1 break-words">{guideLines.map((l, i) => <p key={i}>{l}</p>)}</div></div>}
        {stage === 3 && <section aria-labelledby="pedia-stage-heading">
          <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">Kontak untuk pesanan ini</h2>
          <fieldset disabled={attempted} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="pedia-wa" className="text-[13px] text-white/70">Nomor WhatsApp</label><input id="pedia-wa" type="tel" inputMode="tel" enterKeyHint="next" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08… atau +62…" className={fieldClass} aria-invalid={!!errors.wa} aria-describedby="pedia-wa-help" /><p id="pedia-wa-help" className="mt-2 text-xs leading-5 text-white/50">Admin menghubungi nomor ini jika pengiriman layanan gagal.</p>{inlineError("wa")}</div>
            <div><label htmlFor="pedia-email" className="text-[13px] text-white/70">Email</label><input id="pedia-email" type="email" inputMode="email" enterKeyHint="done" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} placeholder="nama@email.com" className={fieldClass} aria-invalid={!!errors.email} /><p className="mt-2 text-xs leading-5 text-white/50">Bukti pesanan dan pembaruan status dikirim ke email ini.</p>{inlineError("email")}</div>
            <div className="ax-glass-card rounded-2xl p-3.5 text-[13px] leading-6 text-white/70 sm:col-span-2">{termLines.length > 0 && <><h3 className="text-sm font-bold text-white">Ketentuan layanan yang dipilih</h3><ul className="mt-2 space-y-1.5">{shownTerms.map((l, i) => <li key={i} className="flex gap-2 break-words"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#00E5FF]" /><span>{l}</span></li>)}</ul>{moreTerms.length > 0 && <details className="mt-1.5"><summary className="flex min-h-9 cursor-pointer list-none items-center text-[13px] font-semibold text-[#00E5FF] [&::-webkit-details-marker]:hidden">Lihat semua ketentuan ({termLines.length})</summary><ul className="space-y-1.5">{moreTerms.map((l, i) => <li key={i} className="flex gap-2 break-words"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-white/40" /><span>{l}</span></li>)}</ul></details>}</>}<div className={termLines.length > 0 ? "mt-3 border-t border-white/10 pt-2" : ""}><label className="flex min-h-11 cursor-pointer items-start gap-3 text-[13px] leading-6 text-white/80 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#00E5FF]"><input id="pedia-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="peer sr-only" /><span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/40 text-transparent transition peer-checked:border-[#00E5FF] peer-checked:bg-[#00E5FF] peer-checked:text-[#080C1E]"><Check size={12} strokeWidth={3} /></span><span>Saya setuju <a href="/pedia/ketentuan" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] underline underline-offset-4">Ketentuan Pedia</a>.</span></label>{inlineError("agree")}</div></div>
          </fieldset>
        </section>}
        {recoveryCode && <p className="mt-4 text-sm text-white/75">Kode pesanan tersimpan: <strong className="font-mono">{recoveryCode}</strong>. Tekan lanjut lagi untuk memuat QRIS yang sama.</p>}
        {error && <p ref={errorRef} role="alert" className="mt-4 rounded-xl border border-red-300/25 p-3 text-sm leading-6 text-red-200">{error}</p>}
      </div>
      <aside ref={summaryRef} className={`${embedded ? "" : "max-xl:hidden "}min-w-0 overflow-hidden ax-glass-card ax-liquid relative rounded-[24px] bg-[#0e1224] xl:col-start-2 xl:row-span-2 xl:row-start-1 ${summaryFits ? "xl:sticky xl:top-24" : ""}`}>{summary()}</aside>
      {stage === 1 && (tier || product.description_md?.trim()) && <section aria-labelledby="pedia-detail-heading" className={`ax-glass-card ax-liquid relative min-w-0 rounded-2xl p-3.5 text-[13px] leading-6 text-white/70 xl:col-start-1 ${product.description_md?.trim() ? "" : "max-xl:hidden"}`}>
        <h3 id="pedia-detail-heading" className="text-sm font-bold text-white">{tier ? "Detail layanan terpilih" : "Tentang layanan"}</h3>
        {product.description_md?.trim() && <p className="mt-2 whitespace-pre-line break-words">{product.description_md.trim()}</p>}
        {tier?.terms && <ul className="mt-3 space-y-1.5 max-xl:hidden">{tier.terms.split(/\n+/).filter((l) => l.trim()).map((l, i) => <li key={i} className="flex gap-2 break-words"><span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#00E5FF]" /><span>{l.trim()}</span></li>)}</ul>}
      </section>}
    </div>
    <div className={embedded ? "mt-5 xl:hidden" : "pedia-mobile-action ax-glass-strong fixed inset-x-0 bottom-0 z-40 rounded-t-2xl px-4 pt-3.5 xl:hidden"} style={embedded ? undefined : { paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{canOpenSheet && <span aria-hidden="true" className="absolute left-1/2 top-1.5 h-1 w-9 -translate-x-1/2 rounded-full bg-white/25" />}{cta}</div>
    {sheet && canOpenSheet && <div className="fixed inset-0 z-[60] xl:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSheet(false)} />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label="Rincian pesanan" className="pedia-sheet ax-glass-strong absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-[24px] bg-[#0e1224]" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button type="button" onClick={() => setSheet(false)} aria-label="Tutup rincian" className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/15 hover:text-white"><X size={18} aria-hidden="true" /></button>
        {summary(false)}
      </div>
    </div>}
  </div>;
}
