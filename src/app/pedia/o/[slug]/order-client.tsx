"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { detectPediaLink, PEDIA_PLATFORM_LABEL, PEDIA_TARGET_KIND_LABEL, type PediaPlatform, type PediaTargetKind } from "@/lib/pedia/link";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";

const rupiah = (value: number) => `Rp${value.toLocaleString("id-ID")}`;
const fieldClass = "mt-2 min-h-[48px] w-full rounded-xl border border-white/20 bg-white/5 px-3 text-base text-white placeholder:text-white/40 focus:border-[#00E5FF] focus:outline-none";

export function OrderClient({ product, initialTarget, ordersEnabled }: { product: PediaCatalogProduct; initialTarget: string; ordersEnabled: boolean }) {
  const initialTier = product.tiers.find((t) => t.tier === "standar") ?? product.tiers[0];
  const [tierId, setTierId] = useState(initialTier?.id ?? 0);
  const [qty, setQty] = useState(() => product.packages.filter((p) => initialTier?.prices[String(p)] > 0)[1] ?? product.packages.find((p) => initialTier?.prices[String(p)] > 0) ?? 0);
  const [target, setTarget] = useState(initialTarget);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [wa, setWa] = useState("");
  const [email, setEmail] = useState("");
  const [credit, setCredit] = useState("");
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
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

  useEffect(() => {
    quoteController.current?.abort();
    setQuote(null);
    setError("");
    setErrors({});
    return () => { quoteController.current?.abort(); };
  }, [key]);

  const validate = () => {
    const next: Record<string, string> = {};
    if (!tier || !(packageTotal > 0)) next.quantity = "Pilih paket yang tersedia.";
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

  const checkPrice = async () => {
    if (!ordersEnabled || inFlight.current || attempted || !validate()) return;
    inFlight.current = true;
    const requestKey = key;
    const controller = new AbortController();
    quoteController.current = controller;
    setBusy("Memeriksa harga...");
    setError("");
    setQuote(null);
    try {
      const response = await fetchWithTimeout("/api/pedia/quote", {
        method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ product_slug: product.slug, tier_id: tierId, quantity: qty, target: target.trim(), credit_code: credit.trim() || undefined }),
      }, 25_000);
      const data = await response.json();
      if (controller.signal.aborted || latestKey.current !== requestKey) return;
      if (!response.ok) throw new Error(data.message ?? data.error ?? "Harga belum dapat diperiksa. Coba lagi.");
      if (typeof data.quote_token !== "string" || !Number.isFinite(data.total) || data.total <= 0 || !Number.isFinite(data.payable) || data.payable < 0 || data.payable > data.total) throw new Error("Respons harga tidak valid. Coba lagi.");
      setQuote({ key: requestKey, quote_token: data.quote_token, total: data.total, payable: data.payable, expires: Date.now() + 29 * 60_000 });
    } catch (e) {
      if (!controller.signal.aborted && latestKey.current === requestKey) setError(e instanceof Error ? e.message : "Harga belum dapat diperiksa. Coba lagi.");
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  };

  const pay = async () => {
    if (!ordersEnabled || inFlight.current || !validate() || !currentQuote) return;
    if (!attempted && currentQuote.expires <= Date.now()) {
      setQuote(null);
      setError("Harga telah kedaluwarsa. Periksa harga kembali sebelum melanjutkan.");
      return;
    }
    // Preserve the same quote and contact on retries after an uncertain order response.
    inFlight.current = true;
    setAttempted(true);
    setBusy("Membuka pembayaran...");
    setError("");
    try {
      const response = await fetchWithTimeout("/api/pedia/orders", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ customer_wa: wa.trim(), customer_email: email.trim(), quote_token: currentQuote.quote_token }),
      }, 60_000);
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
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
      // Keep the lock until navigation, including a second click from the mobile CTA.
      return;
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Koneksi terputus."} Jika respons terputus, lanjutkan lagi dengan data yang sama; jangan membuat pesanan baru.`);
      inFlight.current = false;
      setBusy("");
    }
  };

  const inlineError = (id: string) => errors[id] ? <p id={`pedia-${id}-error`} role="alert" className="mt-2 text-sm text-red-300">{errors[id]}</p> : null;
  const priceText = currentQuote ? rupiah(currentQuote.payable) : busy === "Memeriksa harga..." ? "Memeriksa harga..." : packageTotal > 0 ? rupiah(packageTotal) : "Paket tidak tersedia";
  const summary = <>
    <h2 className="text-base font-semibold text-white">Ringkasan pesanan</h2>
    <dl className="mt-4 space-y-3 text-sm text-white/70">
      <div className="flex justify-between gap-4"><dt>Layanan</dt><dd className="text-right text-white">{product.name}</dd></div>
      <div className="flex justify-between gap-4"><dt>Kualitas</dt><dd className="capitalize text-white">{tier?.tier ?? "Tidak tersedia"}</dd></div>
      <div className="flex justify-between gap-4"><dt>Jumlah</dt><dd className="tabular-nums text-white">{qty.toLocaleString("id-ID")}</dd></div>
      <div className="flex justify-between gap-4"><dt>Refill</dt><dd>{tier?.refill_days ? `${tier.refill_days} hari, sesuai ketentuan` : "Tidak tersedia"}</dd></div>
      {targetOk && <div><dt>Tujuan</dt><dd className="mt-1 break-all text-white">{target.trim()}</dd></div>}
      {currentQuote && currentQuote.total > currentQuote.payable && <div className="flex justify-between"><dt>Kredit digunakan</dt><dd>{rupiah(currentQuote.total - currentQuote.payable)}</dd></div>}
      <div className="flex justify-between gap-3 border-t border-white/15 pt-4"><dt>{currentQuote ? "Total terkonfirmasi" : "Harga paket"}</dt><dd className="font-semibold tabular-nums text-white">{priceText}</dd></div>
    </dl>
    <p className="mt-3 text-xs leading-relaxed text-white/60">{currentQuote ? "Harga dari server. Nominal QRIS ditampilkan di halaman pembayaran." : "Periksa harga sebelum melanjutkan. Kredit belum diperhitungkan."}</p>
  </>;
  const cta = <button type="button" onClick={pay} disabled={!ordersEnabled || !currentQuote || !!busy} className="min-h-[48px] w-full rounded-xl bg-[#00E5FF] px-4 py-3 text-sm font-semibold text-[#070a1e] disabled:bg-white/10 disabled:text-white/50">{busy === "Membuka pembayaran..." ? busy : "Lanjut ke pembayaran"}</button>;

  return (
    <div className="pb-28 pt-6 lg:pb-12">
      {!ordersEnabled && <div role="status" className="mb-6 rounded-xl border border-white/20 bg-white/5 p-4 text-sm leading-relaxed text-white/80"><strong className="block text-white">Pemesanan belum tersedia</strong>Paket dan harga dapat dilihat. Data kontak tidak diperlukan selama pemesanan ditutup.</div>}
      <a href="/pedia" className="text-sm text-white/60 hover:text-white">Kembali ke layanan</a>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{product.name}</h1>
      <p className="mt-2 text-sm text-white/60">Pilih paket, periksa tujuan, lalu konfirmasi harga sebelum pembayaran.</p>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="pedia-package-heading">
            <h2 id="pedia-package-heading" className="text-lg font-semibold text-white">1. Paket &amp; jumlah</h2>
            <fieldset disabled={attempted} className="mt-4">
              <legend className="mb-3 text-sm text-white/70">Kualitas layanan</legend>
              <div className="space-y-2">
                {product.tiers.map((t) => <label key={t.id} className={`grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-xl border p-4 sm:grid-cols-[20px_minmax(0,1fr)_140px] ${t.id === tierId ? "border-[#00E5FF]/60 bg-white/[0.06]" : "border-white/15 bg-white/[0.02]"}`}>
                  <input type="radio" name="pedia-tier" value={t.id} checked={t.id === tierId} className="mt-1 h-4 w-4 accent-[#00E5FF]" onChange={() => {
                    setTierId(t.id);
                    if (!(t.prices[String(qty)] > 0)) {
                      const next = product.packages.find((p) => t.prices[String(p)] > 0) ?? 0;
                      setQty(next);
                      setNotice(`Jumlah disesuaikan ke ${next.toLocaleString("id-ID")} untuk kualitas ${t.tier}.`);
                    } else setNotice("");
                  }} />
                  <span><span className="font-semibold capitalize text-white">{t.tier}</span><span className="mt-1 block text-sm text-white/65">{t.label_note || "Detail kualitas belum tersedia"}</span><span className="mt-2 block text-xs text-white/60">{t.refill_days > 0 ? `Refill ${t.refill_days} hari, sesuai ketentuan` : "Tanpa refill"}</span></span>
                  <span className="col-start-2 text-sm text-white/75 sm:col-start-3 sm:text-right"><span className="block font-semibold tabular-nums text-white">{t.prices[String(qty)] > 0 ? rupiah(t.prices[String(qty)]) : "Jumlah tidak tersedia"}</span><span className="mt-1 block text-xs">Mulai: {t.eta_start || "Belum ditentukan"}</span><span className="mt-1 block text-xs">Selesai: {t.eta_finish || "Belum ditentukan"}</span></span>
                </label>)}
              </div>
            </fieldset>
            <fieldset id="pedia-quantity" tabIndex={-1} disabled={attempted} aria-describedby="pedia-quantity-help" className="mt-5">
              <legend className="mb-3 text-sm text-white/70">Jumlah</legend>
              <div className="flex flex-wrap gap-2">{product.packages.map((p) => <label key={p} className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm ${!((tier?.prices[String(p)] ?? 0) > 0) ? "cursor-not-allowed border-white/10 text-white/35" : qty === p ? "border-[#00E5FF]/60 bg-white/5 text-white" : "cursor-pointer border-white/20 text-white/75"}`}><input type="radio" name="pedia-quantity" value={p} checked={qty === p} disabled={!((tier?.prices[String(p)] ?? 0) > 0)} onChange={() => { setQty(p); setNotice(""); }} className="h-4 w-4 accent-[#00E5FF]" />{p.toLocaleString("id-ID")}</label>)}</div>
            </fieldset>
            {/* ponytail: configured packages only; enable custom quantities when the orders API accepts non-package quotes. */}
            <p id="pedia-quantity-help" className="mt-3 text-xs leading-relaxed text-white/60">Saat ini pemesanan hanya tersedia untuk paket jumlah yang tercantum. Jumlah bebas belum tersedia.</p>
            {notice && <p role="status" className="mt-2 text-sm text-white/75">{notice}</p>}{inlineError("quantity")}
          </section>

          <section aria-labelledby="pedia-target-heading" className="border-t border-white/15 pt-7">
            <h2 id="pedia-target-heading" className="text-lg font-semibold text-white">2. Tujuan &amp; persyaratan</h2>
            <fieldset disabled={attempted} className="mt-4">
              <label htmlFor="pedia-target" className="text-sm text-white/80">Link {kind.toLowerCase()} {platform}</label>
              <input id="pedia-target" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={600} className={fieldClass} aria-invalid={!!errors.target || (!!target.trim() && !targetOk)} aria-describedby="pedia-target-help pedia-target-error" />
              <p id="pedia-target-help" className="mt-2 text-xs leading-relaxed text-white/60">Hanya format link, platform, dan jenis tujuan yang diperiksa. Keberadaan akun tidak diverifikasi.</p>
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
            <button type="button" disabled={!!busy || attempted} onClick={checkPrice} className="mt-5 min-h-[48px] rounded-xl border border-white/25 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy === "Memeriksa harga..." ? busy : "Periksa harga"}</button>
            {currentQuote && <p role="status" className="mt-3 text-sm text-white/80">Harga terkonfirmasi: {rupiah(currentQuote.payable)}. Periksa ringkasan, lalu lanjutkan ke pembayaran.</p>}
            {attempted && <p className="mt-3 text-sm text-white/70">Data dikunci untuk melanjutkan pesanan yang sama jika koneksi terputus.</p>}
            {error && <p role="alert" className="mt-3 rounded-xl border border-red-300/30 p-3 text-sm leading-relaxed text-red-200">{error}</p>}
          </section>}
          <div className="rounded-xl border border-white/15 p-4 lg:hidden">{summary}</div>
        </div>
        <aside className="hidden lg:block"><div className="sticky top-20 rounded-xl border border-white/15 bg-white/[0.03] p-5">{summary}<div className="mt-5">{cta}</div></div></aside>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/15 bg-[#080C1E] p-4 lg:hidden" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}>{cta}</div>
    </div>
  );
}
