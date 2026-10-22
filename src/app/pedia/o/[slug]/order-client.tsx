"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, PEDIA_TARGET_KIND_LABEL, pediaTargetMatches, type PediaPlatform, type PediaTargetKind } from "@/lib/pedia/link";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { ServicePicker } from "@/components/pedia/ServicePicker";
import { usePediaPrices } from "@/components/pedia/usePediaPrices";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import { MetricIcon } from "@/components/pedia/MetricIcon";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { pediaPlatform, pediaTargetExample } from "@/lib/pedia/platforms";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID")}`;
const fieldClass = "mt-2 min-h-[48px] w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-base text-white placeholder:text-white/40 focus:border-[#00E5FF] focus:outline-none";

export function OrderClient({ product, initialTarget, ordersEnabled, embedded = false, withinPlatform = false, onLockedChange, products = [], onProductChange }: { product: PediaCatalogProduct; initialTarget: string; ordersEnabled: boolean; embedded?: boolean; withinPlatform?: boolean; onLockedChange?: (locked: boolean) => void; products?: PediaCatalogProduct[]; onProductChange?: (slug: string) => void }) {
  const [stage, setStage] = useState(1);
  const [quantityNotice, setQuantityNotice] = useState("");
  const [tierId, setTierId] = useState<number | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [target, setTarget] = useState(initialTarget);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [credit, setCredit] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
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
  const key = JSON.stringify([product.slug, tierId, qty, target.trim(), credit.trim(), wa.trim(), email.trim(), checks, agree, ordersEnabled]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const inFlight = useRef(false);
  const quoteController = useRef<AbortController | null>(null);
  const currentQuote = quote?.key === key ? quote : null;
  // Harga acuan persetujuan: harga paket tersimpan bila jumlah persis paket,
  // selainnya total tepat dari endpoint harga server. Quote server tetap penentu
  // akhir (token JWE mengikat total persis); selisih apa pun memicu consent.
  const comparison = usePediaPrices(product.slug, qty, !embedded);
  const comparisonPrices = comparison?.prices ?? {};
  const quantityValid = !!tier && qty != null && Number.isSafeInteger(qty) && qty >= (tier.min_qty ?? 1) && qty <= (tier.max_qty ?? Infinity) && qty % (tier.quantity_step ?? product.step) === 0;
  const packageTotal = tier && qty && quantityValid ? (comparisonPrices[tier.id] ?? tier.prices[String(qty)] ?? 0) : 0;
  useEffect(() => { onLockedChange?.(attempted); }, [attempted, onLockedChange]);
  const targetHelp = `Gunakan format link seperti contoh pada kolom. Masukkan link ${kind.toLowerCase()} ${platform}${["views", "plays"].includes(product.metric) ? " yang ingin ditambah tayangan" : ""}. ${product.target_kind === "profile" ? "Pastikan akun tidak privat." : "Pastikan konten dapat diakses publik."}`;

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
      next.quantity = `Jumlah ${qty.toLocaleString("id-ID")} tidak tersedia untuk layanan ini: minimal ${(tier.min_qty ?? 1).toLocaleString("id-ID")}, maksimal ${(tier.max_qty ?? 0).toLocaleString("id-ID")}${(tier.quantity_step ?? product.step) > 1 ? `, kelipatan ${tier.quantity_step ?? product.step}` : ""}. Jumlah tetap ${qty.toLocaleString("id-ID")} — ubah jumlah atau pilih layanan lain.`;
    }
    if (throughStage >= 2 && !targetOk) next.target = `Masukkan link ${kind.toLowerCase()} ${platform} yang sesuai layanan ini.`;
    if (throughStage >= 2 && !checklist.every((c) => checks[c.id])) next.requirements = "Konfirmasi semua persyaratan tujuan sebelum melanjutkan.";
    if (throughStage >= 3 && !waOk) next.wa = "Masukkan nomor WhatsApp 08... atau +62... yang benar.";
    if (throughStage >= 3 && !emailOk) next.email = "Masukkan alamat email yang benar (maksimal 160 karakter).";
    if (throughStage >= 3 && credit.trim().length > 20) next.credit = "Kode kredit maksimal 20 karakter.";
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
    try {
      let readyQuote = currentQuote;
      if (!readyQuote || (!attempted && readyQuote.expires <= Date.now())) {
        setQuote(null);
        setBusy("Memeriksa harga...");
        const response = await fetchWithTimeout("/api/pedia/quote", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ product_slug: product.slug, tier_id: tierId, quantity: qty, target: target.trim(), credit_code: credit.trim() || undefined }),
        }, 25_000);
        const data = await response.json();
        if (controller.signal.aborted || latestKey.current !== requestKey) return;
        if (!response.ok) throw new Error(data.message ?? data.error ?? "Harga belum dapat diperiksa. Coba lagi.");
        if (typeof data.quote_token !== "string" || !data.quote_token || !Number.isFinite(data.total) || data.total <= 0 || !Number.isFinite(data.payable) || data.payable < 0 || data.payable > data.total) throw new Error("Respons harga tidak valid. Coba lagi.");
        readyQuote = { key: requestKey, quote_token: data.quote_token, total: data.total, payable: data.payable, expires: Date.now() + 29 * 60_000 };
        setQuote(readyQuote);
        if (data.total !== packageTotal || credit.trim()) return;
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
        throw new Error(data.message ?? data.error ?? "Pesanan belum dapat dilanjutkan.");
      }
      if (typeof data.code !== "string" || !/^AXP-[A-Z0-9-]+$/.test(data.code)) throw new Error("Respons pesanan belum lengkap. Coba lanjutkan lagi dengan data yang sama.");
      try {
        const stored = JSON.parse(localStorage.getItem("axp-orders") ?? "[]");
        const list = Array.isArray(stored) ? stored : [];
        localStorage.setItem("axp-orders", JSON.stringify([{ code: data.code, name: product.name }, ...list.filter((o) => o.code !== data.code)].slice(0, 20)));
      } catch { /* Device history is optional. */ }
      location.assign(`/pedia/pesanan/${data.code}`);
      navigating = true;
      // Keep the lock until navigation, including a second click from the mobile CTA.
      return;
    } catch (e) {
      if (!orderStarted && (controller.signal.aborted || latestKey.current !== requestKey)) return;
      setError(`${e instanceof Error ? e.message : "Koneksi terputus."}${orderStarted ? " Jika respons terputus, lanjutkan lagi dengan data yang sama; jangan membuat pesanan baru." : ""}`);
    } finally {
      if (!navigating) { inFlight.current = false; setBusy(""); }
    }
  };

  const inlineError = (id: string) => errors[id] ? <p id={`pedia-${id}-error`} role="alert" className="mt-2 text-sm text-red-300">{errors[id]}</p> : null;
  const priceText = currentQuote ? rupiah(currentQuote.payable) : packageTotal > 0 ? rupiah(packageTotal) : !tier ? "Pilih layanan" : !qty ? "Isi jumlah" : !quantityValid ? "Periksa jumlah" : embedded || comparison ? "Harga belum tersedia" : "Memeriksa harga…";
  const brandColor = pediaPlatform(product.platform)?.color ?? "#00E5FF";
  const summary = <>
    <div className="flex items-center gap-3 border-b border-white/10 p-5" style={{ background: `linear-gradient(120deg, ${brandColor}20, transparent)` }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]"><PlatformIcon id={product.platform} size={25} /></span>
      <div className="min-w-0"><h2 className="text-[10px] uppercase tracking-[0.14em] text-white/45">Ringkasan pesanan</h2><p className="mt-1 text-sm font-semibold text-white">{product.name}</p></div>
    </div>
    <div className="min-h-[180px] p-5">
      {tier ? <>
        <p className="text-sm font-medium leading-6 text-white/90">{tier.public_name ?? tier.label_note ?? "Layanan terpilih"}</p>
        <dl className="mt-4 space-y-3 text-xs text-white/55">
          {qty != null && <div className="flex justify-between gap-4"><dt>Jumlah</dt><dd className="text-right tabular-nums text-white">{qty.toLocaleString("id-ID")}</dd></div>}
          <div className="flex justify-between gap-4"><dt>Wilayah</dt><dd className="text-right text-white/70">{{ indonesia: "Indonesia", global: "Global", mixed: "Campuran" }[tier.region ?? "global"]}</dd></div>
          <div className="flex justify-between gap-4"><dt>Refill</dt><dd className={`text-right ${tier.refill_days > 0 ? "text-[#00E5FF]" : "text-white/70"}`}>{tier.refill_days > 0 ? `${tier.refill_days} hari, sesuai ketentuan` : "Tanpa refill"}</dd></div>
          {tier.eta_start && <div className="flex justify-between gap-4"><dt>Mulai</dt><dd className="text-right text-white/70">{tier.eta_start}</dd></div>}
          {targetOk && <div><dt>Tujuan</dt><dd className="mt-1 break-all leading-5 text-white/80">{target.trim()}</dd></div>}
          {currentQuote && currentQuote.total > currentQuote.payable && <div className="flex justify-between gap-3"><dt>Kredit digunakan</dt><dd className="text-white">{rupiah(currentQuote.total - currentQuote.payable)}</dd></div>}
        </dl>
        <div className="mt-5 border-t border-white/10 pt-5"><p className="text-xs text-white/50">{currentQuote ? "Total terkonfirmasi" : "Total pesanan"}</p><p className={`mt-2 font-display font-semibold tracking-tight text-white ${packageTotal > 0 || currentQuote ? "text-3xl" : "text-lg"}`}>{priceText}</p></div>
        <p className="mt-3 text-xs leading-5 text-white/45">{currentQuote ? "Nominal QRIS ditampilkan di halaman pembayaran." : qty ? "Harga diperiksa kembali sebelum pembayaran. Kredit belum diperhitungkan." : "Isi jumlah untuk melihat total pesananmu."}</p>
      </> : <div className="py-2"><p className="text-sm font-medium leading-6 text-white/80">Pesananmu dimulai di sini.</p><p className="mt-2 text-sm leading-6 text-white/50">Isi jumlah, pilih layanan, lalu masukkan link tujuan. Rincian harga akan muncul di sini.</p></div>}
      <p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-5 text-white/40">Pembayaran QRIS · Tanpa login<br />Refill mengikuti layanan yang dipilih.</p>
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
  const cta = <>
    {!ordersEnabled && <p className="mb-2 text-xs text-white/60">Pemesanan belum tersedia. Kamu tetap bisa membandingkan layanan.</p>}
    {stage === 3 && currentQuote && !attempted && <p role="status" className="mb-3 text-sm leading-5 text-white/80">{currentQuote.total !== packageTotal ? `Harga berubah dari ${rupiah(packageTotal)} menjadi ${rupiah(currentQuote.total)}. ` : ""}Total pembayaran {rupiah(currentQuote.payable)}. Tekan Setujui untuk menyetujui nominal ini.</p>}
    <div className="flex items-center gap-3"><div className="min-w-0 shrink-0 lg:hidden"><p className="max-w-28 truncate text-[10px] text-white/50">{tier?.public_name ?? "Total pesanan"}</p><p className="mt-1 font-display text-lg font-semibold tabular-nums text-white sm:text-xl">{priceText}</p></div><button type="button" onClick={stage < 3 ? advance : pay} disabled={!ordersEnabled || !!busy} className="min-h-12 min-w-0 flex-1 rounded-xl bg-[#00E5FF] px-4 py-3 text-sm font-semibold text-[#070a1e] transition hover:bg-[#70f2ff] disabled:bg-white/10 disabled:text-white/50">{busy || (stage === 1 ? "Lanjut: isi target" : stage === 2 ? "Lanjut: kontak" : currentQuote && !attempted ? "Setujui & lanjut ke pembayaran" : attempted ? "Coba lanjutkan pembayaran" : "Lanjut ke pembayaran")}<ArrowRight aria-hidden="true" size={16} className="ml-2 inline shrink-0" /></button></div>
  </>;
  return <div className={embedded ? "py-5" : withinPlatform ? `${stage === 3 && currentQuote && !attempted ? "pb-56" : "pb-36"} lg:pb-8` : `mx-auto max-w-[1280px] px-4 ${stage === 3 && currentQuote && !attempted ? "pb-56" : "pb-36"} pt-6 sm:px-6 lg:px-8 lg:pb-12`}>
    {stage > 1 && <button type="button" disabled={attempted} onClick={() => goToStage(stage - 1)} className="inline-flex min-h-11 items-center gap-2 text-[13px] text-white/60 hover:text-white disabled:opacity-40"><ArrowLeft size={16} aria-hidden="true" />{stage === 2 ? "Layanan" : "Target"}</button>}
    {!embedded && !withinPlatform && stage === 1 && <a href={`/pedia/p/${product.platform}`} className="inline-flex min-h-11 items-center gap-2 text-sm text-white/60"><ArrowLeft size={16} aria-hidden="true" />{platform}</a>}
    {!withinPlatform && <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">{product.name}</h1>}
    <ol className="mt-7 flex items-center gap-1 sm:gap-3" aria-label="Langkah pesanan">
      {["Layanan", "Target", "Kontak", "Bayar"].map((label, i) => <li key={label} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-3">
        <button type="button" disabled={i + 1 > stage || attempted} onClick={() => { if (i + 1 < stage) goToStage(i + 1); }} aria-current={i + 1 === stage ? "step" : undefined} aria-label={`Langkah ${i + 1}: ${label}`} className="flex items-center gap-1 text-[10px] font-semibold disabled:cursor-default disabled:opacity-60 sm:text-[13px]">
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${i + 1 < stage ? "border-[#00E5FF] bg-[#00E5FF] text-[#080C1E]" : i + 1 === stage ? "border-[#00E5FF] text-[#00E5FF]" : "border-white/15 text-white/45"}`}>{i + 1 < stage ? <Check size={12} aria-hidden="true" /> : i + 1}</span>
          <span className={i + 1 === stage ? "text-white" : "text-white/55"}>{label}</span>
        </button>{i < 3 && <span aria-hidden="true" className={`h-px min-w-1 flex-1 ${i + 1 < stage ? "bg-[#00E5FF]" : "bg-white/10"}`} />}
      </li>)}
    </ol>
    <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="ax-glass-card min-w-0 rounded-[24px] p-5 sm:p-8">
        {stage === 1 && <>
          <section aria-labelledby="pedia-stage-heading"><h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">Apa yang ingin ditingkatkan?</h2>
            {products.length > 0 && <nav aria-label={`Jenis layanan ${platform}`} className="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{products.map((p) => <button type="button" key={p.slug} aria-pressed={p.slug === product.slug} disabled={attempted} onClick={() => onProductChange?.(p.slug)} className={`flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-gradient-to-b px-3 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00E5FF] disabled:opacity-40 ${p.slug === product.slug ? "border-[#00E5FF]/50 from-[#00E5FF]/20 to-[#8B5CF6]/10 text-[#00E5FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_12px_rgba(0,229,255,0.10)]" : "border-white/15 from-white/[0.08] to-white/[0.025] text-white/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] hover:border-white/30 hover:text-white"}`}><MetricIcon metric={p.metric} size={13} tint={p.slug === product.slug ? "#00E5FF" : "white"} />{p.name.replace(new RegExp(`\\s*${platform}\\s*`, "ig"), " ").trim() || p.name}</button>)}</nav>}
            <div className="mt-8">
            <fieldset id="pedia-quantity" tabIndex={-1} disabled={attempted} className="min-w-0">
              <legend className="text-[15px] font-bold text-white">Berapa jumlahnya?</legend>
              <div className="mt-3 flex flex-wrap items-center gap-2"><input id="pedia-qty-input" aria-label="Jumlah yang dipesan" aria-invalid={!!errors.quantity} type="number" inputMode="numeric" min={tier?.min_qty ?? productMin} max={tier?.max_qty ?? undefined} step={tier?.quantity_step ?? product.step} value={qty ?? ""} placeholder={`Contoh: ${productMin.toLocaleString("id-ID")}`} onChange={(e) => { const v = e.target.value; setQty(v === "" ? null : Number(v)); setQuantityNotice(""); }} className="min-h-12 w-40 rounded-xl border border-white/15 bg-white/[0.035] px-4 text-base text-white placeholder:text-white/35 focus:border-[#00E5FF] focus:outline-none disabled:opacity-40" />
                {(tier?.quick_quantities?.length ? tier.quick_quantities.filter((n) => n >= (tier.min_qty ?? 1) && n <= (tier.max_qty ?? n) && n % (tier.quantity_step ?? product.step) === 0) : productExamples).slice(0, 5).map((n) => <button key={n} type="button" onClick={() => { setQty(n); setQuantityNotice(""); }} aria-pressed={qty === n} className={`min-h-11 rounded-xl border px-3 text-sm transition ${qty === n ? "border-[#00E5FF]/45 bg-[#00E5FF]/10 text-[#00E5FF]" : "border-white/10 text-white/60 hover:border-white/25"}`}>{n >= 1000 ? `${n / 1000}k` : n.toLocaleString("id-ID")}</button>)}
              </div>
              <p className="mt-3 text-xs leading-5 text-white/50">{tier ? `Layanan terpilih menerima ${(tier.min_qty ?? 1).toLocaleString("id-ID")}${tier.max_qty != null ? `–${tier.max_qty.toLocaleString("id-ID")}` : " atau lebih"} per pesanan.${(tier.quantity_step ?? product.step) > 1 ? ` Kelipatan ${(tier.quantity_step ?? product.step).toLocaleString("id-ID")}.` : ""}` : "Pilih layanan untuk melihat batas jumlah per pesanan."}</p>
              {quantityNotice && <p role="status" className="mt-2 text-xs text-amber-200">{quantityNotice}</p>}{inlineError("quantity")}
              {qty != null && comparison?.failed && <p className="mt-2 text-xs leading-5 text-white/55">Harga terbaru belum dapat dimuat. Harga akan diperiksa kembali sebelum pembayaran.</p>}
            </fieldset></div>
            <div className="mt-8"><ServicePicker product={product} tierId={tierId} onSelect={pickTier} qty={qty} prices={comparisonPrices} pricesSettled={embedded || !!comparison} locked={attempted} expanded />{inlineError("tier")}</div>
          </section>
        </>}
        {stage === 2 && <section aria-labelledby="pedia-stage-heading">
            <h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">Link {kind.toLowerCase()} tujuan</h2>
            <p className="mt-1.5 text-sm text-white/60">Salin dari aplikasi {platform}, lalu tempel di sini. Kami cek formatnya langsung.</p>
            <fieldset disabled={attempted} className="mt-4"><label htmlFor="pedia-target" className="text-sm text-white/70">Link {kind.toLowerCase()} {platform}</label><input id="pedia-target" value={target} placeholder={pediaTargetExample(product.platform, product.target_kind)} onChange={(e) => setTarget(e.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={600} className={`${fieldClass} ${targetOk ? "border-emerald-400/60" : ""}`} aria-invalid={!!errors.target || (!!target.trim() && !targetOk)} aria-describedby="pedia-target-help" />
              <p id="pedia-target-help" className="mt-2 text-xs leading-5 text-white/50">{targetHelp}</p>
              {targetOk && <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-[#00E5FF]"><span aria-hidden="true">✓</span>Format link sesuai. Akun atau konten belum diverifikasi.</p>}
              {errors.target ? inlineError("target") : target.trim() && !targetOk && <p className="mt-2 text-xs text-red-300">Gunakan link {kind.toLowerCase()} {platform} yang sesuai layanan ini.</p>}
              {checklist.length > 0 && <div id="pedia-requirements" tabIndex={-1} className="mt-7 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"><p className="mb-3 flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck size={16} aria-hidden="true" className="text-[#00E5FF]" />Sebelum lanjut, pastikan hal berikut</p>{checklist.map((c) => <label key={c.id} className="flex min-h-11 cursor-pointer gap-3 rounded-xl bg-white/[0.025] p-3 text-sm leading-5 text-white/75"><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => { const checked = e.target.checked; setChecks((current) => ({ ...current, [c.id]: checked })); }} className="mt-0.5 h-4 w-4 shrink-0 accent-[#00E5FF]" /><span>{c.label}{c.help && <span className="mt-1 block text-xs leading-5 text-white/45">{c.help}</span>}</span></label>)}</div>}{inlineError("requirements")}
            </fieldset>
        </section>}
        {stage < 3 && <>
          {tier && <p className="mt-5 text-xs leading-5 text-white/55">Drop dapat terjadi setelah pesanan selesai. {tier.refill_days > 0 ? `Refill ${tier.refill_days} hari mengikuti ketentuan layanan.` : "Layanan ini tanpa refill."}</p>}
          <details className="mt-5 border-t border-white/10 pt-1">
            <summary className="min-h-12 cursor-pointer py-4 text-sm font-medium text-white/65">Detail & ketentuan layanan</summary>
            <div className="space-y-5 pb-2 text-sm leading-6 text-white/60">
              {product.description_md?.trim() && <p className="whitespace-pre-line break-words">{product.description_md.trim()}</p>}
              {tier ? <>
                {tier.description && <div><h3 className="font-medium text-white/80">Tentang layanan ini</h3><p className="mt-2 whitespace-pre-line">{tier.description}</p></div>}
                {tier.eta_finish && <p>Estimasi selesai: {tier.eta_finish}. Estimasi dapat berubah mengikuti antrean.</p>}
                {tier.terms && <div><h3 className="font-medium text-white/80">Syarat & ketentuan layanan</h3><p className="mt-2 whitespace-pre-line">{tier.terms}</p></div>}
                {tier.instructions && <div><h3 className="font-medium text-white/80">Cara membeli layanan ini</h3><p className="mt-2 whitespace-pre-line">{tier.instructions}</p></div>}
              </> : <p>Pilih layanan untuk membaca keterangan, ketentuan refill, dan panduan yang sesuai.</p>}
            </div>
          </details>
        </>}
        {stage === 3 && <section aria-labelledby="pedia-stage-heading">
          <div className="flex items-center justify-between gap-3"><h2 id="pedia-stage-heading" tabIndex={-1} className="scroll-mt-24 font-display text-2xl font-bold text-white">Ke mana kami kirim bukti pesanan?</h2><button type="button" disabled={attempted} onClick={() => goToStage(1)} className="min-h-11 shrink-0 whitespace-nowrap text-xs text-[#00E5FF] disabled:opacity-40 sm:text-sm">Ubah pesanan</button></div>
          <div className="mt-3 border-b border-white/10 pb-5 text-sm text-white/70"><p className="font-medium text-white">{tier?.public_name ?? tier?.label_note ?? product.name}</p><p className="mt-1 text-xs leading-5 text-white/50">{qty?.toLocaleString("id-ID")} · {tier?.refill_days ? `Refill ${tier.refill_days} hari` : "Tanpa refill"}</p><p className="mt-2 break-all text-xs leading-5 text-white/55">{target}</p></div>
          <p className="mt-3 text-sm text-white/60">Tanpa membuat akun. Kontak digunakan untuk bukti dan status pesanan.</p>
          <fieldset disabled={attempted} className="mt-6 grid gap-5 sm:grid-cols-2 [&>details]:sm:col-span-2 [&>label]:sm:col-span-2">
            <div><label htmlFor="pedia-wa" className="text-sm text-white/80">Nomor WhatsApp</label><input id="pedia-wa" type="tel" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08… atau +62…" className={fieldClass} aria-invalid={!!errors.wa} />{inlineError("wa")}</div>
            <div><label htmlFor="pedia-email" className="text-sm text-white/80">Email</label><input id="pedia-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} placeholder="nama@email.com" className={fieldClass} aria-invalid={!!errors.email} /><p className="mt-2 text-xs leading-5 text-white/50">Bukti pesanan dan pembaruan status dikirim ke email ini.</p>{inlineError("email")}</div>
            <details className="rounded-xl border border-white/10 px-4 py-1"><summary className="min-h-11 cursor-pointer py-3 text-sm text-white/65">Punya Kode Kredit Pedia?</summary><label htmlFor="pedia-credit" className="mt-3 block text-sm text-white/75">Kode kredit</label><input id="pedia-credit" value={credit} onChange={(e) => setCredit(e.target.value.toUpperCase())} maxLength={20} placeholder="PDK-XXXX-XXXX" className={fieldClass} /><p className="my-3 text-xs leading-5 text-white/50">Kredit dari sisa pesanan Pedia sebelumnya. Bukan kode promo.</p>{inlineError("credit")}</details>
            <div className="rounded-xl bg-[#FFB800]/10 px-4 py-3 text-[13px] leading-6 text-[#FFCF55] sm:col-span-2">Drop dapat terjadi. {tier?.refill_days ? `Refill ${tier.refill_days} hari mengikuti ketentuan layanan.` : "Layanan ini tanpa refill."} Pesanan selesai sebagian atau dibatalkan supplier mendapat Kode Kredit Pedia untuk bagian yang tidak terpenuhi.</div>
            {tier?.terms && <details className="border-t border-white/10 pt-1"><summary className="min-h-11 cursor-pointer py-3 text-sm text-white/65">Ketentuan layanan yang dipilih</summary><p className="mt-1 whitespace-pre-line text-xs leading-5 text-white/60">{tier.terms}</p></details>}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6 text-white/80"><input id="pedia-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]" /><span>Saya setuju <a href="/pedia/ketentuan" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] underline underline-offset-4">Ketentuan Pedia</a>.</span></label>{inlineError("agree")}
          </fieldset>
          {attempted && <p className="mt-3 text-xs text-white/60">Data dikunci agar percobaan ulang melanjutkan pesanan yang sama.</p>}
        </section>}
        {recoveryCode && <p className="mt-4 text-sm text-white/75">Kode pesanan tersimpan: <strong className="font-mono">{recoveryCode}</strong>. Tekan lanjut lagi untuk memuat QRIS yang sama.</p>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-300/25 p-3 text-sm leading-6 text-red-200">{error}</p>}
        <div className="mt-8 hidden border-t border-white/10 pt-6 lg:block">{cta}</div>
        {tier && <details className="mt-5 overflow-hidden rounded-2xl border border-white/10 lg:hidden"><summary className="min-h-11 cursor-pointer p-4 text-sm text-white/65">Lihat ringkasan pesanan</summary>{summary}</details>}
      </div>
      <aside className="hidden overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.025] lg:sticky lg:top-24 lg:block">{summary}</aside>
    </div>
    <div className={embedded ? "mt-5 lg:hidden" : "fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#080C1E]/95 p-4 backdrop-blur-md lg:hidden"} style={embedded ? undefined : { paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{cta}</div>
  </div>;
}
