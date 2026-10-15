"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, PEDIA_TARGET_KIND_LABEL, pediaTargetMatches, type PediaPlatform, type PediaTargetKind } from "@/lib/pedia/link";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { ServicePicker } from "@/components/pedia/ServicePicker";
import { usePediaPrices } from "@/components/pedia/usePediaPrices";
import { pediaTargetExample } from "@/lib/pedia/platforms";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID")}`;
const fieldClass = "mt-2 min-h-[48px] w-full rounded-xl border border-white/20 bg-white/5 px-3 text-base text-white placeholder:text-white/40 focus:border-[#00E5FF] focus:outline-none";

export function OrderClient({ product, initialTarget, ordersEnabled, embedded = false, withinPlatform = false, onLockedChange }: { product: PediaCatalogProduct; initialTarget: string; ordersEnabled: boolean; embedded?: boolean; withinPlatform?: boolean; onLockedChange?: (locked: boolean) => void }) {
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
  const kindOk = detected && pediaTargetMatches(product.target_kind, detected.targetKind);
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
  const packageTotal = tier && qty ? (comparisonPrices[tier.id] ?? tier.prices[String(qty)] ?? 0) : 0;
  useEffect(() => { onLockedChange?.(attempted); }, [attempted, onLockedChange]);
  const targetHelp = `Masukkan link ${kind.toLowerCase()} ${platform}${["views", "plays"].includes(product.metric) ? " yang ingin ditambah tayangan" : ""}. ${product.target_kind === "profile" ? "Pastikan akun tidak privat." : "Pastikan konten dapat diakses publik."}`;

  useEffect(() => {
    quoteController.current?.abort();
    setQuote(null);
    setError("");
    setErrors({});
    return () => { quoteController.current?.abort(); };
  }, [key]);

  const validate = (firstStageOnly = false) => {
    const next: Record<string, string> = {};
    if (!tier) next.tier = "Pilih layanan terlebih dahulu.";
    if (!qty || !tier || qty < (tier.min_qty ?? 1) || qty > (tier.max_qty ?? qty) || qty % (tier.quantity_step ?? product.step) !== 0) {
      next.quantity = tier
        ? `Jumlah untuk layanan ini: minimal ${(tier.min_qty ?? 1).toLocaleString("id-ID")}, maksimal ${(tier.max_qty ?? 0).toLocaleString("id-ID")}.`
        : "Isi jumlah yang ingin dipesan.";
    }
    if (!targetOk) next.target = `Masukkan link ${kind.toLowerCase()} ${platform} yang sesuai layanan ini.`;
    if (!checklist.every((c) => checks[c.id])) next.requirements = "Konfirmasi semua persyaratan tujuan sebelum melanjutkan.";
    if (!firstStageOnly && !waOk) next.wa = "Masukkan nomor WhatsApp 08... atau +62... yang benar.";
    if (!firstStageOnly && !emailOk) next.email = "Masukkan alamat email yang benar (maksimal 160 karakter).";
    if (!firstStageOnly && credit.trim().length > 20) next.credit = "Kode kredit maksimal 20 karakter.";
    if (!firstStageOnly && !agree) next.agree = "Setujui Ketentuan Pedia sebelum melanjutkan.";
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
  const priceText = currentQuote ? rupiah(currentQuote.payable) : packageTotal > 0 ? rupiah(packageTotal) : tier && qty ? "Menunggu harga" : "Belum dipilih";
  const summary = <>
    <h2 className="text-base font-semibold text-white">Ringkasan pesanan</h2>
    <dl className="mt-4 space-y-3 text-sm text-white/70">
      <div className="flex justify-between gap-4"><dt>Layanan</dt><dd className="text-right text-white">{product.name}</dd></div>
      <div className="flex justify-between gap-4"><dt>Pilihan</dt><dd className="text-right text-white">{tier ? (tier.public_name ?? tier.label_note ?? "Terpilih") : "Belum dipilih"}</dd></div>

      <div className="flex justify-between gap-4"><dt>Jumlah</dt><dd className="tabular-nums text-white">{qty?.toLocaleString("id-ID") ?? "Belum dipilih"}</dd></div>
      <div className="flex justify-between gap-4"><dt>Refill</dt><dd className={tier ? tier.refill_days > 0 ? "text-[#00E5FF]" : "text-[#FFB800]" : ""}>{tier ? tier.refill_days > 0 ? `${tier.refill_days} hari, sesuai ketentuan` : "Tanpa refill" : "Belum dipilih"}</dd></div>
      {targetOk && <div><dt>Tujuan</dt><dd className="mt-1 break-all text-white">{target.trim()}</dd></div>}
      {currentQuote && currentQuote.total > currentQuote.payable && <div className="flex justify-between"><dt>Kredit digunakan</dt><dd>{rupiah(currentQuote.total - currentQuote.payable)}</dd></div>}
      <div className="flex justify-between gap-3 border-t border-white/15 pt-4"><dt>{currentQuote ? "Total terkonfirmasi" : "Total pesanan"}</dt><dd className="font-semibold tabular-nums text-white">{priceText}</dd></div>
    </dl>
    <p className="mt-3 text-xs leading-relaxed text-white/60">{currentQuote ? "Harga dari server. Nominal QRIS ditampilkan di halaman pembayaran." : "Harga diperiksa saat Anda melanjutkan. Kredit belum diperhitungkan."}</p>
  </>;
  const advance = () => {
    if (!validate(true)) return;
    setStage(2);
    requestAnimationFrame(() => { const h = document.getElementById("pedia-contact-heading"); if (h) window.scrollTo?.({ top: Math.max(0, window.scrollY + h.getBoundingClientRect().top - 88), behavior: "instant" }); document.getElementById("pedia-wa")?.focus({ preventScroll: true }); });
  };
  const pickTier = (id: number) => {
    setTierId(id);
    const next = product.tiers.find((t) => t.id === id);
    if (qty && next && (qty < (next.min_qty ?? 1) || qty > (next.max_qty ?? Infinity) || qty % (next.quantity_step ?? product.step) !== 0)) {
      setQty(null); setQuantityNotice("Batas jumlah layanan ini berbeda. Pilih jumlah yang sesuai.");
    } else setQuantityNotice("");
  };
  const cta = <>
    {!ordersEnabled && <p className="mb-2 text-xs text-white/60">Pemesanan belum tersedia. Kamu tetap bisa membandingkan layanan.</p>}
    {stage === 2 && currentQuote && !attempted && <p role="status" className="mb-3 text-sm leading-5 text-white/80">{currentQuote.total !== packageTotal ? `Harga berubah dari ${rupiah(packageTotal)} menjadi ${rupiah(currentQuote.total)}. ` : ""}Total pembayaran {rupiah(currentQuote.payable)}. Tekan Setujui untuk menyetujui nominal ini.</p>}
    <div className="flex items-center gap-4"><div className="min-w-0 shrink-0 lg:hidden"><p className="text-[10px] text-white/50">Total pesanan</p><p className="mt-1 text-sm font-semibold tabular-nums text-white">{priceText}</p></div><button type="button" onClick={stage === 1 ? advance : pay} disabled={!ordersEnabled || !!busy} className="min-h-12 flex-1 rounded-xl bg-[#00E5FF] px-4 py-3 text-sm font-semibold text-[#070a1e] transition hover:bg-[#70f2ff] disabled:bg-white/10 disabled:text-white/50">{busy || (stage === 1 ? "Lanjut isi kontak" : currentQuote && !attempted ? "Setujui & lanjut ke pembayaran" : "Lanjut ke pembayaran")}</button></div>
  </>;
  return <div className={embedded ? "py-5" : withinPlatform ? "pb-36 lg:pb-8" : "mx-auto max-w-[1280px] px-4 pb-36 pt-6 sm:px-6 lg:px-8 lg:pb-12"}>
    {!embedded && !withinPlatform && <a href={`/pedia/p/${product.platform}`} className="inline-flex min-h-10 items-center text-sm text-white/60">← {platform}</a>}
    {!withinPlatform && <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">{product.name}</h1>}
    {product.description_md?.trim() && <p className="mt-3 max-w-3xl whitespace-pre-line break-words text-sm leading-6 text-white/60">{product.description_md.trim()}</p>}
    <div className="mt-5 flex items-center gap-3 text-xs" aria-label="Tahap pemesanan"><span aria-current={stage === 1 ? "step" : undefined} className={stage === 1 ? "text-[#00E5FF]" : "text-white/50"}>1. Layanan & tujuan</span><span aria-hidden className="text-white/25">→</span><span aria-current={stage === 2 ? "step" : undefined} className={stage === 2 ? "text-[#00E5FF]" : "text-white/40"}>2. Kontak & konfirmasi</span></div>
    <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
      <div className="min-w-0">
        {stage === 1 && <>
          <section aria-labelledby="pedia-package-heading"><h2 id="pedia-package-heading" className="sr-only">Pilih layanan dan jumlah</h2>
            <ServicePicker product={product} tierId={tierId} onSelect={pickTier} qty={qty} prices={comparisonPrices} locked={attempted} />{inlineError("tier")}
            <fieldset id="pedia-quantity" tabIndex={-1} disabled={attempted} className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <legend className="px-1 text-sm font-semibold text-white">Jumlah yang ingin ditambah</legend>
              <div className="flex flex-wrap items-center gap-2"><input id="pedia-qty-input" aria-label="Jumlah yang dipesan" type="number" inputMode="numeric" min={tier?.min_qty ?? 1} max={tier?.max_qty ?? undefined} step={tier?.quantity_step ?? product.step} disabled={!tier} value={qty ?? ""} placeholder={tier ? `Min. ${tier.min_qty ?? 1}` : "Pilih layanan dulu"} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ""); setQty(v ? Number(v) : null); }} className="min-h-12 w-44 rounded-xl border border-white/20 bg-white/5 px-3 text-base text-white placeholder:text-white/35 disabled:opacity-40" />
                {(tier?.quick_quantities?.length ? tier.quick_quantities : product.packages).filter((n) => !tier || (n >= (tier.min_qty ?? 1) && n <= (tier.max_qty ?? n) && n % (tier.quantity_step ?? product.step) === 0)).slice(0,5).map((n) => <button key={n} type="button" disabled={!tier} onClick={() => setQty(n)} className={`min-h-11 rounded-xl border px-3 text-sm disabled:opacity-35 ${qty === n ? "border-[#00E5FF]/60 bg-[#00E5FF]/10 text-white" : "border-white/15 text-white/65"}`}>{n.toLocaleString("id-ID")}</button>)}
              </div>
              <p className="mt-2 text-xs leading-5 text-white/55">{tier ? `Minimal ${(tier.min_qty ?? 1).toLocaleString("id-ID")}, maksimal ${(tier.max_qty ?? 0).toLocaleString("id-ID")}${(tier.quantity_step ?? product.step) > 1 ? `, kelipatan ${tier.quantity_step ?? product.step}` : ""}.` : "Pilih layanan untuk melihat batas jumlahnya."}</p>
              {quantityNotice && <p role="status" className="mt-2 text-xs text-amber-200">{quantityNotice}</p>}{inlineError("quantity")}
              {tier && qty && <p role="status" className="mt-2 text-sm text-white">Total untuk {qty.toLocaleString("id-ID")}: <strong>{priceText}</strong>{comparison?.failed && <span className="mt-1 block text-xs text-white/55">Harga terbaru akan diperiksa sebelum pembayaran.</span>}</p>}
            </fieldset>
          </section>
          {tier && <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4" aria-label="Keterangan layanan"><p className="text-sm font-semibold text-white">Tentang layanan ini</p>{tier.description && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-white/65">{tier.description}</p>}<p className="mt-2 text-xs leading-5 text-white/55">{tier.refill_days > 0 ? `Refill ${tier.refill_days} hari sesuai ketentuan. ` : "Tanpa refill. "}Drop dapat terjadi setelah pesanan selesai.</p></div>}
          {tier?.terms && <details className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-semibold text-white/80">Syarat & ketentuan layanan</summary><p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/65">{tier.terms}</p></details>}
          {tier?.instructions && <details className="mt-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-semibold text-white/80">Cara membeli layanan ini</summary><p className="mt-3 whitespace-pre-line text-sm leading-6 text-white/65">{tier.instructions}</p></details>}
          <section aria-labelledby="pedia-target-heading" className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <h2 id="pedia-target-heading" className="text-sm font-semibold text-white">Masukkan link tujuan</h2>
            <fieldset disabled={attempted} className="mt-3"><label htmlFor="pedia-target" className="text-sm text-white/75">Link {kind.toLowerCase()} {platform}</label><input id="pedia-target" value={target} placeholder={pediaTargetExample(product.platform, product.target_kind)} onChange={(e) => setTarget(e.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={600} className={fieldClass} aria-invalid={!!errors.target || (!!target.trim() && !targetOk)} aria-describedby="pedia-target-help" />
              <p id="pedia-target-help" className="mt-2 text-xs leading-5 text-white/55">{targetHelp}</p>
              {targetOk && <p className="mt-2 text-xs text-white/55">Format link sesuai. Akun atau konten belum diverifikasi.</p>}
              {errors.target ? inlineError("target") : target.trim() && !targetOk && <p className="mt-2 text-xs text-red-300">Gunakan link {kind.toLowerCase()} {platform} yang sesuai layanan ini.</p>}
              {checklist.length > 0 && <div id="pedia-requirements" tabIndex={-1} className="mt-4 space-y-3">{checklist.map((c) => <label key={c.id} className="flex gap-3 text-sm leading-5 text-white/75"><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-[#00E5FF]" /><span>{c.label}{c.help && <span className="mt-1 block text-xs leading-5 text-white/50">{c.help}</span>}</span></label>)}</div>}{inlineError("requirements")}
            </fieldset>
          </section>
        </>}
        {stage === 2 && <section aria-labelledby="pedia-contact-heading">
          <div className="flex items-center justify-between gap-3"><h2 id="pedia-contact-heading" tabIndex={-1} className="scroll-mt-24 text-lg font-semibold text-white">Kontak & konfirmasi</h2><button type="button" disabled={attempted} onClick={() => setStage(1)} className="min-h-11 text-sm text-[#00E5FF] disabled:opacity-40">Ubah pesanan</button></div>
          <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-sm text-white/70"><p className="font-semibold text-white">{tier?.public_name ?? tier?.label_note ?? product.name}</p><p className="mt-1">{qty?.toLocaleString("id-ID")} · {tier?.refill_days ? `Refill ${tier.refill_days} hari` : "Tanpa refill"}</p><p className="mt-2 break-all text-xs text-white/55">{target}</p></div>
          <fieldset disabled={attempted} className="mt-5 space-y-4">
            <div><label htmlFor="pedia-wa" className="text-sm text-white/80">Nomor WhatsApp</label><input id="pedia-wa" type="tel" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08… atau +62…" className={fieldClass} aria-invalid={!!errors.wa} />{inlineError("wa")}</div>
            <div><label htmlFor="pedia-email" className="text-sm text-white/80">Email</label><input id="pedia-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} placeholder="nama@email.com" className={fieldClass} aria-invalid={!!errors.email} /><p className="mt-2 text-xs text-white/50">Bukti pesanan dan pembaruan status dikirim ke email ini.</p>{inlineError("email")}</div>
            <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm text-white/70">Punya Kode Kredit Pedia?</summary><label htmlFor="pedia-credit" className="mt-3 block text-sm text-white/75">Kode kredit</label><input id="pedia-credit" value={credit} onChange={(e) => setCredit(e.target.value.toUpperCase())} maxLength={20} placeholder="PDK-XXXX-XXXX" className={fieldClass} /><p className="mt-2 text-xs text-white/50">Kredit dari sisa pesanan Pedia sebelumnya. Bukan kode promo.</p>{inlineError("credit")}</details>
            <div className="rounded-xl border border-white/10 p-4 text-xs leading-5 text-white/60">Drop dapat terjadi. {tier?.refill_days ? `Refill ${tier.refill_days} hari mengikuti ketentuan layanan.` : "Layanan ini tanpa refill."} Pesanan selesai sebagian atau dibatalkan supplier mendapat Kode Kredit Pedia untuk bagian yang tidak terpenuhi.</div>
            {tier?.terms && <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer text-sm text-white/75">Ketentuan layanan yang dipilih</summary><p className="mt-3 whitespace-pre-line text-xs leading-5 text-white/60">{tier.terms}</p></details>}
            <label className="flex gap-3 text-sm text-white/80"><input id="pedia-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]" /><span>Saya setuju <a href="/pedia/ketentuan" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] underline underline-offset-4">Ketentuan Pedia</a>.</span></label>{inlineError("agree")}
          </fieldset>
          {attempted && <p className="mt-3 text-xs text-white/60">Data dikunci agar percobaan ulang melanjutkan pesanan yang sama.</p>}
        </section>}
        {recoveryCode && <p className="mt-4 text-sm text-white/75">Kode pesanan tersimpan: <strong className="font-mono">{recoveryCode}</strong>. Tekan lanjut lagi untuk memuat QRIS yang sama.</p>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-300/25 p-3 text-sm leading-6 text-red-200">{error}</p>}
        <details className="mt-5 rounded-2xl border border-white/10 p-4 lg:hidden"><summary className="cursor-pointer text-sm text-white/70">Lihat ringkasan pesanan</summary><div className="mt-4">{summary}</div></details>
      </div>
      <aside className="hidden lg:block"><div className="sticky top-20 rounded-2xl border border-white/12 bg-white/[0.035] p-5">{summary}<div className="mt-5">{cta}</div></div></aside>
    </div>
    <div className={embedded ? "mt-5 lg:hidden" : "fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#080C1E]/95 p-4 backdrop-blur-md lg:hidden"} style={embedded ? undefined : { paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{cta}</div>
  </div>;
}
