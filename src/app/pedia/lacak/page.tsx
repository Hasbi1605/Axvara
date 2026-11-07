"use client";

export const runtime = "edge";

import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import Link from "next/link";
import { isValidOrderContact, orderAccessHeaders, orderCheckoutPath, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { fill, pediaCopy } from "@/lib/pedia/copy";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

type SavedOrder = { code: string; name: string };
type RecentEntry = { code: string; contact: string; savedAt?: number };
const DEVICE_KEY = "axp-orders";
const RECENT_KEY = "axp-track-recent";
const CODE_RE = /^AXP-\d{8}-[A-Z0-9]{8}$/;
const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
function validContact(value: string) {
  // Pedia: status/refill kontak saja, tanpa PIN.
  return isValidOrderContact(value);
}
function readEntries(key: string): Record<string, unknown>[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
  } catch { return []; }
}
function uniqueCodes<T extends { code: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.code)) return false;
    seen.add(entry.code);
    return true;
  });
}
function persist(key: string, entries: SavedOrder[] | RecentEntry[]) {
  try { localStorage.setItem(key, JSON.stringify(entries)); } catch { /* Riwayat bersifat opsional. */ }
}
/** FAQ pembeli; teks mengikuti bahasa tampilan (angka/kebijakan sama). */
const FAQ_ID = [
  ["Di mana saya menemukan kode pesanan?", "Kode AXP ditampilkan setelah checkout, di halaman pembayaran dan status pesanan. Jika memesan di browser ini, buka daftar Pesanan di perangkat ini di atas."],
  ["Sudah bayar QRIS, tetapi status masih menunggu bayar?", "Buka halaman pesanan untuk melihat pembaruan pembayaran otomatis. Pastikan nominal yang dibayar sesuai tagihan. Jika belum berubah, hubungi WA Admin dengan kode pesanan dan bukti pembayaran."],
  ["Bagaimana membatalkan pesanan?", "Pesanan yang belum dibayar bisa dibatalkan di halaman pembayaran lewat tombol Batalkan Pesanan, dengan WA atau email checkout. Pesanan yang sudah dibayar tidak bisa dibatalkan sendiri; hubungi WA Admin dengan kode pesanan."],
  ["Bagaimana cara mengajukan refill?", "Buka halaman Refill (menu Bantuan → Refill Pedia) atau halaman status pesanan, lalu tekan Ajukan Refill. Refill tersedia untuk layanan dengan Refill, selama masa refill, maksimal 1× per 24 jam."],
];
const FAQ_EN = [
  ["Where do I find the order code?", "The AXP code is shown after checkout, on the payment page and the order status. If you ordered in this browser, open the Orders on this device list above."],
  ["I paid QRIS but the status still says waiting for payment.", "Open the order page to see the automatic payment update. Make sure the amount paid matches the invoice. If it has not changed, contact WA Admin with the order code and payment proof."],
  ["How do I cancel an order?", "An unpaid order can be canceled on the payment page with the Cancel Order button, using the checkout WhatsApp number or email. A paid order cannot be canceled yourself; contact WA Admin with the order code."],
  ["How do I request a refill?", "Open the Refill page (Help menu → Pedia Refill) or the order status page, then press Request Refill. Refill is available for services with Refill, during the refill period, at most once per 24 hours."],
];

export default function PediaTrackPage() {
  const router = useRouter();
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  const FAQ = locale === "en" ? FAQ_EN : FAQ_ID;
  const maskContact = (contact: string) => {
    if (contact.includes("@")) {
      const [name, domain] = contact.split("@");
      return locale === "en" ? `Email ${name.slice(0, 1)}***@${domain}` : `Email ${name.slice(0, 1)}***@${domain}`;
    }
    const phone = contact.replace(/[\s-]/g, "");
    return "WA " + phone.slice(0, 4) + "****" + phone.slice(-4);
  };
  const [code, setCode] = useState("");
  const [contact, setContact] = useState("");
  const [touched, setTouched] = useState({ code: false, contact: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedOrder[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const loadingStage = useLoadingStage(loading, [SLOW_MS]);
  const codeValid = CODE_RE.test(normalizeCode(code));
  const contactValid = validContact(contact);

  useEffect(() => {
    setSaved(uniqueCodes(readEntries(DEVICE_KEY).flatMap((entry) => {
      if (typeof entry.code !== "string" || typeof entry.name !== "string") return [];
      const cleanCode = normalizeCode(entry.code);
      return CODE_RE.test(cleanCode) ? [{ code: cleanCode, name: entry.name }] : [];
    })).slice(0, 20));
    const recentEntries = uniqueCodes(readEntries(RECENT_KEY).flatMap((entry) => {
      if (typeof entry.code !== "string" || typeof entry.contact !== "string") return [];
      const cleanCode = normalizeCode(entry.code);
      const savedAt = Number(entry.savedAt) || Date.now();
      return CODE_RE.test(cleanCode) && (entry.contact === "" || validContact(entry.contact)) && Date.now() - savedAt < 7 * 86_400_000 ? [{ code: cleanCode, contact: validContact(entry.contact) ? entry.contact.trim() : "", savedAt }] : [];
    })).slice(0, 5);
    setRecent(recentEntries);
    if (recentEntries.length) persist(RECENT_KEY, recentEntries);
    else { try { localStorage.removeItem(RECENT_KEY); } catch { /* Storage optional. */ } }
    const queryCode = new URLSearchParams(window.location.search).get("code");
    if (queryCode) setCode(normalizeCode(queryCode));
    return () => request.current?.abort();
  }, []);

  async function lookup(rawCode: string, rawContact: string) {
    if (busy.current) return;
    const cleanCode = normalizeCode(rawCode);
    const cleanContact = rawContact.trim();
    setTouched({ code: true, contact: true });
    if (!CODE_RE.test(cleanCode) || !validContact(cleanContact)) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetchWithTimeout("/api/orders/lookup", {
        method: "POST", headers: { "content-type": "application/json", ...orderAccessHeaders(cleanCode, cleanContact) },
        body: JSON.stringify({ code: cleanCode, contact: cleanContact }),
        cache: "no-store", signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : t.trackNotFound);
      if (data.order?.code !== cleanCode) throw new Error(t.trackBadData);
      if (controller.signal.aborted) return;
      // Pedia tanpa kredensial: kontak saja, PIN tidak pernah disimpan.
      const next = [{ code: cleanCode, contact: cleanContact, savedAt:Date.now() }, ...recent.filter((entry) => entry.code !== cleanCode)].slice(0, 5);
      setRecent(next);
      persist(RECENT_KEY, next);
      rememberPediaContact(cleanCode, cleanContact);
      rememberOrderContact(cleanCode, cleanContact);
      router.push(orderCheckoutPath("/pedia/pesanan/" + encodeURIComponent(cleanCode), cleanCode, data.buyer_access_session));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : t.trackConnection);
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/80">{t.trackKicker}</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">{t.trackTitle}</h1>
      <p className="mt-3 max-w-[58ch] text-sm leading-6 text-white/55">{t.trackIntroLead}<strong className="font-semibold text-white">{t.trackIntroCode}</strong>{t.trackIntroMid}<strong className="font-semibold text-white">{t.trackIntroContact}</strong>{t.trackIntroTail}</p>
      <form onSubmit={(event) => { event.preventDefault(); void lookup(code, contact); }} className="ax-glass-card mt-6 rounded-[24px] p-5 sm:p-6" aria-label={t.trackFormAria} aria-busy={loading} noValidate>
        <div className="mb-5 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10"><IosIcon name="search" size={20} tint="#00E5FF" /></span>
          <div><h2 className="text-sm font-semibold text-white">{t.trackFormTitle}</h2><p className="text-xs text-white/45">{t.trackFormSub}</p></div>
        </div>
        <label htmlFor="pedia-track-code" className="block text-xs font-medium text-white/60">{t.trackCode}</label>
        <input id="pedia-track-code" value={code} disabled={loading} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(null); }} onBlur={() => setTouched((value) => ({ ...value, code: true }))} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={32} placeholder="AXP-20261016-AB12CD34" aria-invalid={touched.code && !codeValid} aria-describedby="pedia-code-hint" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 font-mono text-sm font-semibold tracking-[0.06em] text-white outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-white/55 focus:border-[#00E5FF]/50 disabled:opacity-60" />
        <p id="pedia-code-hint" className={touched.code && !codeValid ? "mt-1.5 text-[11px] text-red-300" : "mt-1.5 text-[11px] text-white/65"}>{touched.code && !codeValid ? t.trackCodeBad : t.trackCodeHint}</p>
        <label htmlFor="pedia-track-contact" className="mt-4 block text-xs font-medium text-white/60">{t.trackContact}</label>
        <input id="pedia-track-contact" value={contact} disabled={loading} onChange={(event) => { setContact(event.target.value); setError(null); }} onBlur={() => setTouched((value) => ({ ...value, contact: true }))} autoComplete="off" maxLength={254} placeholder={t.trackContactPlaceholder} aria-invalid={touched.contact && !contactValid} aria-describedby="pedia-contact-hint" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none placeholder:text-white/55 focus:border-[#00E5FF]/50 disabled:opacity-60" />
        <p id="pedia-contact-hint" className={touched.contact && !contactValid ? "mt-1.5 text-[11px] text-red-300" : "mt-1.5 text-[11px] text-white/65"}>{touched.contact && !contactValid ? t.trackContactBad : t.trackContactHint}</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{error}</p>}
        <button type="submit" disabled={loading || !codeValid || !contactValid} className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#00E5FF] text-base font-bold text-[#080C1E] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
          {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[#080C1E]/25 border-t-[#080C1E] motion-reduce:animate-none" />}
          {loading ? (loadingStage ? t.trackSlow : t.trackLoading) : t.trackSubmit}
        </button>
        {loading && <p role="status" className="mt-2 text-xs text-white/65">{t.trackChecking}</p>}
      </form>
      {recent.length > 0 && (
        <section className="ax-glass-card mt-4 rounded-[20px] p-4 sm:p-5" aria-label={t.trackRecentAria}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.trackRecentTitle}</h2>
          <div className="mt-3 space-y-2">{recent.map((entry) => (
            <div key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <button type="button" disabled={loading} onClick={() => { const proof = readOrderContact(entry.code) || entry.contact; setCode(entry.code); setContact(proof); if (proof) void lookup(entry.code, proof); }} className="min-w-0 flex-1 text-left disabled:opacity-60">
                <span className="block break-all font-mono text-xs font-semibold text-[#00E5FF]">{entry.code}</span>
                <span className="mt-0.5 block break-all text-[11px] text-white/40">{entry.contact ? maskContact(entry.contact) : t.trackFillContact}</span>
              </button>
              <button type="button" disabled={loading} aria-label={fill(t.trackDeleteRecent, { code: entry.code })} onClick={() => { const next = recent.filter((value) => value.code !== entry.code); setRecent(next); persist(RECENT_KEY, next); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-60"><span aria-hidden="true"><IosIcon name="close" size={16} tint="white" /></span></button>
            </div>
          ))}</div>
        </section>
      )}
      {saved.length > 0 && (
        <details className="ax-glass-card mt-4 rounded-[24px] p-4 sm:p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3"><span>{t.trackSavedTitle} <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">{saved.length}</span></span><span aria-hidden="true"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
          <section aria-label={t.trackSavedTitle} className="mt-4">
            <p className="mb-3 text-xs leading-5 text-white/45">{t.trackSavedNote}</p>
            <div className="space-y-2">{saved.map((entry) => (
              <div key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <Link prefetch={false} href={"/pedia/pesanan/" + encodeURIComponent(entry.code)} className="min-w-0 flex-1 py-1"><span className="block break-all text-sm font-semibold text-white">{entry.name}</span><span className="mt-1 block break-all font-mono text-xs text-white/45">{entry.code}</span><span className="mt-2 block text-xs font-semibold text-[#00E5FF]">{t.trackSavedOpen}</span></Link>
                <button type="button" aria-label={fill(t.trackSavedHide, { code: entry.code })} onClick={() => { const next = saved.filter((value) => value.code !== entry.code); setSaved(next); persist(DEVICE_KEY, next); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"><span aria-hidden="true"><IosIcon name="close" size={16} tint="white" /></span></button>
              </div>
            ))}</div>
          </section>
        </details>
      )}
      <section aria-label={t.trackFaqAria} className="mt-4 space-y-2">{FAQ.map(([question, answer]) => (
        <details key={question} className="ax-glass-card rounded-2xl px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3">{question}<span aria-hidden="true" className="shrink-0"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
          <p className="mt-3 text-xs leading-6 text-white/55">{answer}</p>
        </details>
      ))}</section>
    </div>
  );
}
