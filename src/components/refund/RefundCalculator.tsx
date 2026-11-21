"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Calculator, CalendarDays, Link2, Search } from "lucide-react";
import Link from "next/link";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { AsyncConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AdminPortalContext } from "@/components/admin/ui/portal";
import { MARKET_INVOICE, prorata, termEnd, wibInputSeconds, type Estimate } from "@/lib/refund/calculate";
import { requestRefund } from "@/lib/refund/client";
import { BuyerRefundLookup } from "./BuyerRefundLookup";
import { idr, refundButton, refundInput, RefundResult, remainingTime } from "./RefundResult";

export function RefundCalculator({ admin = false, initialCode = "", shared = false, buyerCode = "" }: { admin?: boolean; initialCode?: string; shared?: boolean; buyerCode?: string }) {
  const browserLocale = useDisplayLocale();
  const [mode, setMode] = useState(admin ? "invoice" : shared ? "share" : "order");
  const [shareToken, setShareToken] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  const [estimateLocale, setEstimateLocale] = useState<"id" | "en">();
  const [code, setCode] = useState(initialCode);
  const [selected, setSelected] = useState<number[]>([]);
  const [invoice, setInvoice] = useState("");
  const [estimate, setEstimate] = useState<Estimate>();
  const [activeShare, setActiveShare] = useState(false);
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revokeInvoice, setRevokeInvoice] = useState<string | null>(null);
  const [dialogHost, setDialogHost] = useState<HTMLDivElement | null>(null);
  const locale = admin ? "id" : estimateLocale ?? browserLocale;
  const en = locale === "en";
  const t = (id: string, english: string) => en ? english : id;
  const adminRequest = useCallback(async (action: string, target: string, extra?: object) => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await requestRefund("/api/admin/refund", { action, code: target, ...extra });
      if (result.estimate) {
        setEstimate(result.estimate); setInvoice(target);
        const eligible = result.estimate.lines.filter(line => line.amount != null);
        if (action === "lookup") setSelected(eligible.filter(line => eligible.length === 1 || line.claim != null).map(line => line.id));
        if (action === "claim" && typeof (extra as { item?: number })?.item === "number") {
          const id = (extra as { item: number }).item;
          setSelected(ids => ids.includes(id) ? ids : [...ids, id]);
        }
      }
      if (typeof result.activeShare === "boolean") setActiveShare(result.activeShare);
      if (result.token) setShare(`${window.location.origin}/kalkulator-refund/bagikan#s=${result.token}`);
      if (action === "revoke") { setShare(""); setNotice("Link dinonaktifkan."); }
      return true;
    } catch (err) {
      if (action === "revoke") throw new Error("Gagal mencabut link. Coba lagi.", { cause: err });
      setError(err instanceof Error ? err.message : "unavailable"); return false;
    }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    if (admin) {
      if (initialCode) void adminRequest("lookup", initialCode);
      return;
    }
    if (!shared) return;
    const loadHash = () => setShareToken(new URLSearchParams(window.location.hash.slice(1)).get("s") || "");
    loadHash();
    window.addEventListener("hashchange", loadHash);
    return () => window.removeEventListener("hashchange", loadHash);
  }, [admin, initialCode, adminRequest, shared]);
  useEffect(() => {
    if (!shared) return;
    setEstimate(undefined);
    setEstimateLocale(undefined);
    setError("");
    if (!shareToken) { setBusy(false); setError("share_expired"); return; }
    const controller = new AbortController();
    setBusy(true);
    void requestRefund("/api/refund", { token: shareToken }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (!result.estimate) throw new Error("unavailable");
      setEstimate(result.estimate); setEstimateLocale(result.locale);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "unavailable");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [shared, shareToken, readAttempt]);

  const lookup = (event: FormEvent) => {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    setEstimate(undefined); setInvoice(""); setShare(""); setActiveShare(false); setNotice("");
    if (!MARKET_INVOICE.test(clean)) { setError("format"); return; }
    setCode(clean); void adminRequest("lookup", clean);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(share); setNotice("Link disalin."); }
    catch { setNotice("Pilih dan salin link di atas."); }
  };
  const errors: Record<string, string> = {
    admin: "Masuk ke panel admin, lalu buka kembali link ini.", not_found: "Invoice Market tidak ditemukan.",
    format: "Masukkan nomor invoice AXV yang valid.", claim_invalid: "Waktu laporan harus dalam masa aktif dan garansi.",
    claim_saved: "Laporan sudah dicatat. Cek ulang invoice.", select_items: "Pilih item yang memiliki estimasi.",
    share_expired: t("Link tidak aktif atau sudah kedaluwarsa.", "This link is no longer active."),
    rate: t("Terlalu sering. Coba lagi sebentar.", "Too many requests. Try again shortly."),
  };
  return <section className="mx-auto w-full max-w-4xl px-4 pb-16 pt-9 sm:px-6 sm:pt-14">
    {admin && <Link prefetch={false} href="/admin?section=orders" className="mb-4 inline-flex min-h-11 items-center text-sm font-medium text-white/65 hover:text-white focus-visible:outline-cyan-300">← Pesanan</Link>}
    <header className="mb-7 max-w-xl">
      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200"><Calculator size={15} aria-hidden /> AXVARA <span aria-hidden>·</span> {t("Garansi", "Warranty")}</span>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">{t("Kalkulator Refund", "Refund Calculator")}</h1>
      <p className="mt-2 text-sm text-white/65">{mode === "share" ? t("Ringkasan estimasi dari AXVARA.", "Estimate shared by AXVARA.") : t("Cek sisa masa aktif dan estimasi refund.", "Check the remaining time and estimated refund.")}</p>
    </header>
    {mode !== "share" && <div className="mb-4 flex w-fit max-w-full flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
      {[...(admin ? [{ id: "invoice", label: "Dari invoice" }] : [{ id: "order", label: t("Dari Pesanan", "From Order") }]), { id: "days", label: t("Hitung Sisa Hari", "Days Remaining") }, { id: "manual", label: t("Simulasi Refund", "Refund Simulation") }].map(tab =>
        <button key={tab.id} type="button" aria-pressed={mode === tab.id} onClick={() => setMode(tab.id)} className={`min-h-11 rounded-xl px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 motion-reduce:transition-none sm:px-4 sm:text-sm ${mode === tab.id ? "bg-cyan-300/15 text-cyan-100" : "text-white/65 hover:bg-white/10 hover:text-white"}`}>{tab.label}</button>)}
    </div>}
    <div className="ax-glass-card rounded-[24px] p-5 shadow-[0_24px_80px_-50px_#00e5ff] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200 sm:p-7">
      {!admin && !shared && <div hidden={mode !== "order"}><BuyerRefundLookup initialCode={buyerCode} locale={locale} /></div>}
      {mode === "invoice" && <>
        <form onSubmit={lookup} className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-2 text-xs font-semibold text-white/80">Nomor invoice AXVARA
            <input autoCapitalize="characters" spellCheck={false} autoComplete="off" placeholder="AXV-…" maxLength={32} className={refundInput} value={code} onChange={event => setCode(event.target.value)} required disabled={busy} />
          </label>
          <button className={`${refundButton} bg-cyan-300/15`} disabled={busy}><Search size={16} aria-hidden />Cek Invoice</button>
        </form>
        {estimate && <div key={invoice} className="mt-6 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
          <RefundResult estimate={estimate} actions={line => <>
            {line.amount != null && estimate.lines.filter(item => item.amount != null).length > 1 && <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs text-white/80">
              <input type="checkbox" aria-label={`Bagikan ${line.name}${line.unit == null ? "" : ` unit ${line.unit}`}`} className="h-4 w-4 accent-cyan-300" disabled={busy} checked={selected.includes(line.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, line.id] : ids.filter(id => id !== line.id))} /> Bagikan item ini
            </label>}
            {line.claim == null && line.start != null && ["ready", "ended", "warranty_ended"].includes(line.status) && <ClaimField disabled={busy} onSave={claim => adminRequest("claim", invoice, { item: line.id, claim })} />}
          </>} />
          {(estimate.lines.some(line => line.amount != null) || activeShare) && <div className="mt-5 flex flex-wrap gap-2">
            {estimate.lines.some(line => line.amount != null) && <button className={refundButton} disabled={busy || !selected.length} onClick={() => void adminRequest("share", invoice, { items: selected })}><Link2 size={16} aria-hidden />{activeShare ? "Ganti Link" : "Buat Link Bagikan"}</button>}
            {activeShare && <button className={refundButton} disabled={busy} onClick={() => setRevokeInvoice(invoice)}>Cabut Link</button>}
          </div>}
          {share && <div className="mt-4 space-y-2">
            <label className="block space-y-2 text-xs font-semibold text-white/70">Link hanya-baca · aktif 7 hari<input readOnly value={share} onFocus={event => event.target.select()} className={`${refundInput} !text-sm`} /></label>
            <div className="flex flex-wrap gap-2">
              <button className={refundButton} onClick={() => void copy()}>Salin Link</button>
              <a className={refundButton} target="_blank" rel="noreferrer noopener" href={`https://t.me/share/url?url=${encodeURIComponent(share)}`}>Telegram</a>
              <a className={refundButton} target="_blank" rel="noreferrer noopener" href={`https://wa.me/?text=${encodeURIComponent(share)}`}>WhatsApp</a>
            </div>
          </div>}
        </div>}
      </>}
      {mode === "share" && estimate && <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"><RefundResult estimate={estimate} locale={locale} shared /></div>}
      {(mode === "days" || mode === "manual") && <ManualCalculator key={mode} refund={mode === "manual"} en={en} />}
      {(mode === "invoice" || mode === "share") && <>
        {busy && <p role="status" className="mt-3 text-sm text-white/65">{t("Memuat…", "Loading…")}</p>}
        {error && <div className="mt-3"><p role="alert" className="text-sm text-rose-200">{errors[error] ?? t("Belum bisa dimuat. Coba lagi.", "Couldn’t load. Try again.")}</p>
          {error === "admin" && <Link prefetch={false} href="/admin" className={`${refundButton} mt-2`}>Masuk Admin</Link>}
          {mode === "share" && error !== "share_expired" && <button className={`${refundButton} mt-2`} type="button" onClick={() => setReadAttempt(value => value + 1)}>{t("Coba lagi", "Try again")}</button>}
        </div>}
        {notice && <p role="status" className="mt-3 text-sm text-white/75">{notice}</p>}
      </>}
    </div>
    {admin && <div ref={setDialogHost} className="admin-theme !min-h-0" data-admin-theme="dark">
      <AdminPortalContext.Provider value={dialogHost}>
        {revokeInvoice && <AsyncConfirmDialog title="Cabut link refund?" description={`Link estimasi untuk invoice ${revokeInvoice} tidak dapat dibuka lagi.`}
          confirmLabel="Cabut link" onClose={() => setRevokeInvoice(null)} onConfirm={async () => { await adminRequest("revoke", revokeInvoice); }} />}
      </AdminPortalContext.Provider>
    </div>}
  </section>;
}

function ClaimField({ disabled, onSave }: { disabled: boolean; onSave: (time: number) => Promise<boolean> }) {
  const [value, setValue] = useState("");
  return <details>
    <summary className="flex min-h-11 w-fit cursor-pointer items-center text-xs font-semibold text-cyan-200 underline underline-offset-4 focus-visible:outline-cyan-300">Catat laporan</summary>
    <form className="space-y-2" onSubmit={event => { event.preventDefault(); const claim = wibInputSeconds(value); if (claim != null && !disabled) void onSave(claim); }}>
      <label className="block w-fit max-w-full space-y-1 text-xs text-white/75">Waktu laporan yang valid (WIB)<input type="datetime-local" step="1" required value={value} className={refundInput} onChange={event => setValue(event.target.value)} /></label>
      <p className="text-xs text-white/65">Waktu ini mengunci estimasi.</p>
      <button className={refundButton} disabled={disabled}>Kunci Estimasi</button>
    </form>
  </details>;
}

function ManualCalculator({ refund, en }: { refund: boolean; en: boolean }) {
  const t = (id: string, english: string) => en ? english : id;
  const [result, setResult] = useState<{ remaining: number; end: number; amount: number | null }>();
  const [invalid, setInvalid] = useState(false);
  const calc = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const start = wibInputSeconds(`${values.get("start")}T00:00`);
    const asOf = wibInputSeconds(`${values.get("asOf")}T00:00`);
    const end = start == null ? null : termEnd(start, Number(values.get("days")), "day");
    const price = Number(values.get("price"));
    if (start == null || asOf == null || end == null || asOf < start || (refund && (!Number.isSafeInteger(price) || price < 0))) { setResult(undefined); setInvalid(true); return; }
    const remaining = Math.max(end - asOf, 0);
    setInvalid(false); setResult({ end, remaining, amount: refund ? prorata(price, remaining, end - start) : null });
  };
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const field = "min-w-0 space-y-2 text-xs font-semibold text-white/80";
  return <div className="grid min-w-0 gap-5 sm:grid-cols-[1.2fr_1fr]">
    <form onSubmit={calc} onChange={() => { setInvalid(false); setResult(undefined); }} className="grid min-w-0 gap-3">
      <label className={field}>{t("Tanggal mulai", "Start date")}<input name="start" type="date" min="1900-01-01" max="2200-12-31" className={refundInput} required /></label>
      <label className={field}>{t("Durasi paket (hari)", "Plan duration (days)")}<input name="days" type="number" inputMode="numeric" min="1" max="36600" placeholder="30" className={refundInput} required /></label>
      <label className={field}>{t("Tanggal hitung (WIB)", "Calculation date (WIB)")}<input name="asOf" type="date" min="1900-01-01" max="2200-12-31" defaultValue={today} className={refundInput} required /></label>
      {refund && <label className={field}>{t("Harga produk (Rp)", "Product price (IDR)")}<input name="price" type="number" inputMode="numeric" min="0" max="999999999999" placeholder="30000" className={refundInput} required /></label>}
      <button className={`${refundButton} mt-1 w-fit bg-cyan-300/15`}>{refund ? t("Hitung Refund", "Calculate Refund") : t("Hitung Sisa Hari", "Calculate Days")}</button>
    </form>
    <div className="min-w-0 rounded-2xl border border-white/10 bg-[#080C1E]/60 p-4 sm:p-5" aria-live="polite">
      <CalendarDays size={18} className="mb-3 text-cyan-200" aria-hidden />
      <p className="text-xs font-medium text-white/65">{refund ? t("Estimasi refund", "Estimated refund") : t("Sisa masa aktif", "Remaining time")}</p>
      {result && <div key={`${result.end}-${result.remaining}-${result.amount}`} className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
        <p className="mt-1 break-words font-display text-3xl font-bold text-cyan-200 tabular-nums">{result.amount == null ? remainingTime(result.remaining, en ? "en" : "id") : idr(result.amount)}</p>
        {refund && <p className="mt-2 text-xs text-white/65">{remainingTime(result.remaining, en ? "en" : "id")} · {t("simulasi 100% nilai sisa", "100% of unused value")}</p>}
        <p className="mt-2 text-xs text-white/65">{t("Tanggal berakhir", "End date")}: {new Intl.DateTimeFormat(en ? "en-GB" : "id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium" }).format(result.end * 1000)}</p>
      </div>}
      {!result && <p className="mt-2 text-sm text-white/60">{invalid ? t("Cek kembali tanggal dan nominal.", "Check the dates and amount.") : t("Isi data untuk menghitung.", "Enter the details to calculate.")}</p>}
    </div>
  </div>;
}
