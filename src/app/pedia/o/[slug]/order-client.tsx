"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, PEDIA_TARGET_KIND_LABEL, type PediaPlatform, type PediaTargetKind } from "@/lib/pedia/link";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID")}`;
const fieldClass = "mt-2 min-h-[48px] w-full rounded-xl border border-white/20 bg-white/5 px-3 text-base text-white placeholder:text-white/40 focus:border-[#00E5FF] focus:outline-none";

export function OrderClient({ product, initialTarget, ordersEnabled, embedded = false }: { product: PediaCatalogProduct; initialTarget: string; ordersEnabled: boolean; embedded?: boolean }) {
  const [tierId, setTierId] = useState<number | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [target, setTarget] = useState(initialTarget);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [credit, setCredit] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [quote, setQuote] = useState<{ key: string; quote_token: string; total: number; payable: number; expires: number } | null>(null);
  const tier = product.tiers.find((t) => t.id === tierId);
  const checklist = product.checklist ?? [];
  const platform = PEDIA_PLATFORM_LABEL[product.platform as PediaPlatform] ?? product.platform;
  const kind = PEDIA_TARGET_KIND_LABEL[product.target_kind as PediaTargetKind] ?? product.target_kind;
  const detected = detectPediaLink(target);
  const kindOk = detected && (product.target_kind === detected.targetKind ||
    (product.target_kind === "profile" && detected.targetKind === "channel") ||
    (product.target_kind === "post" && ["video", "reel"].includes(detected.targetKind)) ||
    (product.target_kind === "video" && ["post", "reel"].includes(detected.targetKind)));
  const targetOk = !!detected && detected.platform === product.platform && !!kindOk && target.trim().length <= 600;
  const waOk = /^(\+62|62|0)8\d{8,13}$/.test(wa.trim().replace(/\s|-/g, ""));
  const emailOk = z.string().email().max(160).safeParse(email.trim()).success;
  const key = JSON.stringify([product.slug, tierId, qty, target.trim(), credit.trim(), wa.trim(), email.trim(), checks, agree, ordersEnabled]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const inFlight = useRef(false);
  const quoteController = useRef<AbortController | null>(null);
  const currentQuote = quote?.key === key ? quote : null;
  const packageTotal = tier?.prices[String(qty)] ?? 0;
  const targetHelp = `Masukkan link ${kind.toLowerCase()} ${platform}${["views", "plays"].includes(product.metric) ? " yang ingin ditambah tayangan" : ""}. ${product.target_kind === "profile" ? "Pastikan akun tidak privat." : "Pastikan konten dapat diakses publik."}`;

  useEffect(() => {
    quoteController.current?.abort();
    setQuote(null);
    setError("");
    setErrors({});
    return () => { quoteController.current?.abort(); };
  }, [key]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!tier) next.tier = "Pilih kualitas layanan terlebih dahulu.";
    if (!qty || !(packageTotal > 0)) next.quantity = "Pilih jumlah yang tersedia untuk paket Anda.";
    if (!targetOk) next.target = `Masukkan link ${kind.toLowerCase()} ${platform} yang sesuai layanan ini.`;
    if (!checklist.every((c) => checks[c.id])) next.requirements = "Konfirmasi semua persyaratan tujuan sebelum melanjutkan.";
    if (!waOk) next.wa = "Masukkan nomor WhatsApp 08... atau +62... yang benar.";
    if (!emailOk) next.email = "Masukkan alamat email yang benar (maksimal 160 karakter).";
    if (credit.trim().length > 20) next.credit = "Kode kredit maksimal 20 karakter.";
    if (!agree) next.agree = "Setujui Ketentuan Pedia sebelum melanjutkan.";
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      const field = document.getElementById(`pedia-${first}`);
      ((field?.querySelector("input:not(:disabled)") as HTMLElement | null) ?? field)?.focus();
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
  const priceText = currentQuote ? rupiah(currentQuote.payable) : packageTotal > 0 ? rupiah(packageTotal) : "Belum dipilih";
  const summary = <>
    <h2 className="text-base font-semibold text-white">Ringkasan pesanan</h2>
    <dl className="mt-4 space-y-3 text-sm text-white/70">
      <div className="flex justify-between gap-4"><dt>Layanan</dt><dd className="text-right text-white">{product.name}</dd></div>
      <div className="flex justify-between gap-4"><dt>Kualitas</dt><dd className="capitalize text-white">{tier?.tier ?? "Belum dipilih"}</dd></div>
      <div className="flex justify-between gap-4"><dt>Jumlah</dt><dd className="tabular-nums text-white">{qty?.toLocaleString("id-ID") ?? "Belum dipilih"}</dd></div>
      <div className="flex justify-between gap-4"><dt>Refill</dt><dd className={tier ? tier.refill_days > 0 ? "text-[#00E5FF]" : "text-[#FFB800]" : ""}>{tier ? tier.refill_days > 0 ? `${tier.refill_days} hari, sesuai ketentuan` : "Tanpa refill" : "Belum dipilih"}</dd></div>
      {targetOk && <div><dt>Tujuan</dt><dd className="mt-1 break-all text-white">{target.trim()}</dd></div>}
      {currentQuote && currentQuote.total > currentQuote.payable && <div className="flex justify-between"><dt>Kredit digunakan</dt><dd>{rupiah(currentQuote.total - currentQuote.payable)}</dd></div>}
      <div className="flex justify-between gap-3 border-t border-white/15 pt-4"><dt>{currentQuote ? "Total terkonfirmasi" : "Harga paket"}</dt><dd className="font-semibold tabular-nums text-white">{priceText}</dd></div>
    </dl>
    <p className="mt-3 text-xs leading-relaxed text-white/60">{currentQuote ? "Harga dari server. Nominal QRIS ditampilkan di halaman pembayaran." : "Harga diperiksa saat Anda melanjutkan. Kredit belum diperhitungkan."}</p>
  </>;
  const cta = <>{!ordersEnabled && <p className="mb-3 text-xs leading-relaxed text-white/70">Pemesanan belum tersedia. Paket dapat dilihat; kontak tidak diperlukan.</p>}{currentQuote && !attempted && <p role="status" className="mb-3 text-sm leading-relaxed text-white/80">{currentQuote.total !== packageTotal ? `Harga paket berubah dari ${rupiah(packageTotal)} menjadi ${rupiah(currentQuote.total)}. ` : ""}Total pembayaran {rupiah(currentQuote.payable)}. Tekan Setujui untuk menyetujui nominal ini.</p>}<button type="button" onClick={pay} disabled={!ordersEnabled || !!busy} className="min-h-[48px] w-full rounded-xl bg-[#00E5FF] px-4 py-3 text-sm font-semibold text-[#070a1e] shadow-[0_0_24px_rgba(0,229,255,0.12)] transition hover:bg-[#70f2ff] disabled:bg-white/10 disabled:text-white/50 disabled:shadow-none">{busy || (currentQuote && !attempted ? "Setujui & lanjut ke pembayaran" : "Lanjut ke pembayaran")}</button></>;

  return (
    <div className={embedded ? "py-6" : `mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 ${currentQuote && !attempted ? "pb-56" : "pb-36"} pt-6 lg:pb-12`}>
      {!embedded && <a href="/pedia" className="text-sm text-white/60 hover:text-white">Kembali ke layanan</a>}
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{product.name}</h1>
      {product.tagline?.trim() && <p className="mt-2 max-w-3xl break-words text-sm leading-relaxed text-white/75">{product.tagline.trim()}</p>}
      {product.description_md?.trim() && <p className="mt-4 max-w-3xl whitespace-pre-line break-words text-sm leading-relaxed text-white/65">{product.description_md.trim()}</p>}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="pedia-package-heading">
            <h2 id="pedia-package-heading" className="text-lg font-semibold text-white">1. Paket &amp; jumlah</h2>
            <fieldset id="pedia-tier" tabIndex={-1} disabled={attempted} aria-describedby={errors.tier ? "pedia-tier-error" : undefined} className="mt-4">
              <legend className="mb-3 text-sm text-white/70">Kualitas layanan</legend>
              <div className="space-y-2">
                {product.tiers.map((t) => {
                  const firstQty = product.packages.filter((p) => t.prices[String(p)] > 0).sort((a, b) => t.prices[String(a)] - t.prices[String(b)] || a - b)[0];
                  const displayQty = qty && t.prices[String(qty)] > 0 ? qty : firstQty;
                  return <label key={t.id} className={`grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-2xl border bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-4 transition-colors sm:grid-cols-[20px_minmax(0,1fr)_140px] ${t.id === tierId ? "border-[#00E5FF]/60 shadow-[0_0_20px_rgba(0,229,255,0.05)]" : "border-white/15 hover:border-white/30"}`}>
                  <input type="radio" name="pedia-tier" value={t.id} checked={t.id === tierId} className="mt-1 h-4 w-4 accent-[#00E5FF]" onChange={() => {
                    setTierId(t.id);
                    if (!qty || !(t.prices[String(qty)] > 0)) setQty(null);
                  }} />
                  <span><span className="font-semibold capitalize text-white">{t.tier}</span><span className="mt-1 block text-sm text-white/65">{t.label_note || "Detail kualitas belum tersedia"}</span><span className={`mt-2 inline-block rounded-md px-2 py-1 text-xs ${t.refill_days > 0 ? "bg-[#00E5FF]/10 text-[#00E5FF]" : "bg-[#FFB800]/10 text-[#FFB800]"}`}>{t.refill_days > 0 ? `Refill ${t.refill_days} hari, sesuai ketentuan` : "Tanpa refill"}</span></span>
                  <span className="col-start-2 text-sm text-white/75 sm:col-start-3 sm:text-right"><span className="block font-semibold tabular-nums text-white">{displayQty ? `${displayQty === qty ? "" : "Mulai "}${rupiah(t.prices[String(displayQty)])}` : "Belum tersedia"}</span>{displayQty && <span className="mt-1 block text-xs">Untuk {displayQty.toLocaleString("id-ID")}</span>}<span className="mt-2 block text-xs">Mulai: {t.eta_start || "Belum ditentukan"}</span><span className="mt-1 block text-xs">Selesai: {t.eta_finish || "Belum ditentukan"}</span></span>
                </label>; })}
              </div>
              {inlineError("tier")}
            </fieldset>
            <fieldset id="pedia-quantity" tabIndex={-1} disabled={attempted} aria-describedby="pedia-quantity-help" className="mt-5">
              <legend className="mb-3 text-sm text-white/70">Jumlah</legend>
              <div className="flex flex-wrap gap-2">{product.packages.map((p) => <label key={p} className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm ${!((tier?.prices[String(p)] ?? 0) > 0) ? "cursor-not-allowed border-white/10 text-white/35" : qty === p ? "border-[#00E5FF]/60 bg-white/5 text-white" : "cursor-pointer border-white/20 text-white/75"}`}><input type="radio" name="pedia-quantity" value={p} checked={qty === p} disabled={!((tier?.prices[String(p)] ?? 0) > 0)} onChange={() => setQty(p)} className="h-4 w-4 accent-[#00E5FF]" />{p.toLocaleString("id-ID")}</label>)}</div>
            </fieldset>
            {/* ponytail: configured packages only; enable custom quantities when the orders API accepts non-package quotes. */}
            <p id="pedia-quantity-help" className="mt-3 text-xs leading-relaxed text-white/60">Saat ini pemesanan hanya tersedia untuk paket jumlah yang tercantum. Jumlah bebas belum tersedia.</p>
            {!tier && <p className="mt-2 text-xs text-white/70">Pilih kualitas layanan untuk membuka pilihan jumlah.</p>}{inlineError("quantity")}
          </section>

          <section aria-labelledby="pedia-target-heading" className="border-t border-white/15 pt-7">
            <h2 id="pedia-target-heading" className="text-lg font-semibold text-white">2. Tujuan &amp; persyaratan</h2>
            <fieldset disabled={attempted} className="mt-4">
              <label htmlFor="pedia-target" className="text-sm text-white/80">Link {kind.toLowerCase()} {platform}</label>
              <input id="pedia-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={600} className={fieldClass} aria-invalid={!!errors.target || (!!target.trim() && !targetOk)} aria-describedby="pedia-target-help pedia-target-error" />
              <p id="pedia-target-help" className="mt-2 text-xs leading-relaxed text-white/60">{targetHelp}</p>
              {targetOk && <p className="mt-2 text-sm text-white/75">Format link sesuai: {platform}, {kind.toLowerCase()}.</p>}
              {errors.target ? inlineError("target") : target.trim() && !targetOk && <p id="pedia-target-error" className="mt-2 text-sm text-red-300">Gunakan link {kind.toLowerCase()} {platform}, bukan link platform atau jenis tujuan lain.</p>}
              {checklist.length > 0 && <div id="pedia-requirements" tabIndex={-1} className="mt-5 space-y-3" aria-describedby={errors.requirements ? "pedia-requirements-error" : undefined}>{checklist.map((c) => <label key={c.id} className="flex gap-3 text-sm leading-relaxed text-white/80"><input type="checkbox" checked={!!checks[c.id]} onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]" /><span>{c.label}{c.help && <span className="mt-1 block text-xs text-white/60">{c.help}</span>}</span></label>)}</div>}
              {inlineError("requirements")}
            </fieldset>
          </section>

          {ordersEnabled && <section aria-labelledby="pedia-contact-heading" className="border-t border-white/15 pt-7">
            <h2 id="pedia-contact-heading" className="text-lg font-semibold text-white">3. Kontak &amp; konfirmasi</h2>
            <fieldset disabled={attempted} className="mt-4 space-y-4">
              <div><label htmlFor="pedia-wa" className="text-sm text-white/80">Nomor WhatsApp</label><input id="pedia-wa" type="tel" autoComplete="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="08... atau +62..." className={fieldClass} aria-invalid={!!errors.wa} aria-describedby={errors.wa ? "pedia-wa-error" : undefined} />{inlineError("wa")}</div>
              <div><label htmlFor="pedia-email" className="text-sm text-white/80">Email</label><input id="pedia-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} className={fieldClass} aria-invalid={!!errors.email} aria-describedby="pedia-email-help pedia-email-error" /><p id="pedia-email-help" className="mt-2 text-xs text-white/60">Status dan bukti pesanan dikirim ke email ini.</p>{inlineError("email")}</div>
              <details className="border-y border-white/15 py-3"><summary className="cursor-pointer text-sm text-white/75">Punya kode kredit?</summary><label htmlFor="pedia-credit" className="mt-3 block text-sm text-white/80">Kode kredit</label><input id="pedia-credit" value={credit} onChange={(e) => setCredit(e.target.value.toUpperCase())} maxLength={20} placeholder="PDK-XXXX-XXXX" className={fieldClass} aria-invalid={!!errors.credit} />{inlineError("credit")}</details>
              <label className="flex gap-3 text-sm text-white/80"><input id="pedia-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#00E5FF]" aria-invalid={!!errors.agree} aria-describedby={errors.agree ? "pedia-agree-error" : undefined} /><span>Saya setuju <a href="/pedia/ketentuan" className="underline underline-offset-4">Ketentuan Pedia</a>.</span></label>{inlineError("agree")}
            </fieldset>
            {attempted && <p className="mt-3 text-sm text-white/70">Data dikunci untuk melanjutkan pesanan yang sama jika koneksi terputus.</p>}
            {error && <p role="alert" className="mt-3 rounded-xl border border-red-300/30 p-3 text-sm leading-relaxed text-red-200">{error}</p>}
          </section>}
          <div className="rounded-xl border border-white/15 p-4 lg:hidden">{summary}</div>
        </div>
        <aside className="hidden lg:block"><div className="sticky top-20 rounded-2xl border border-white/15 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-5">{summary}<div className="mt-5">{cta}</div></div></aside>
      </div>
      <div className={embedded ? "mt-5 lg:hidden" : "fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#080C1E]/95 p-4 backdrop-blur-md lg:hidden"} style={embedded ? undefined : { paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{cta}</div>
    </div>
  );
}
