"use client";
// Lacak pesanan AXVARA Games — hierarki/gaya sama dengan /pedia/lacak:
// form kaca ber-ikon, riwayat "Terakhir dilacak", "Pesanan di perangkat ini", FAQ.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";
import { IosIcon } from "@/components/ui/IosIcon";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { isValidOrderContact, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";
import { fillGames, GAMES_CODE_RE, GAMES_DEVICE_KEY, GAMES_RECENT_KEY, gamesOrderCopy } from "@/lib/games/order-copy";

type SavedOrder = { code: string; name: string };
type RecentEntry = { code: string; contact: string; savedAt?: number };
const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
function readEntries(key: string): Record<string, unknown>[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) : [];
  } catch { return []; }
}
function uniqueCodes<T extends { code: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => (seen.has(entry.code) ? false : (seen.add(entry.code), true)));
}
function persist(key: string, entries: SavedOrder[] | RecentEntry[]) {
  try { localStorage.setItem(key, JSON.stringify(entries)); } catch { /* Riwayat bersifat opsional. */ }
}

export function GamesTrack() {
  const router = useRouter();
  const locale = useDisplayLocale();
  const t = gamesOrderCopy(locale);
  const maskContact = (contact: string) => {
    if (contact.includes("@")) { const [name, domain] = contact.split("@"); return `Email ${name.slice(0, 1)}***@${domain}`; }
    const phone = contact.replace(/[\s-]/g, "");
    return `WA ${phone.slice(0, 4)}****${phone.slice(-4)}`;
  };
  const [code, setCode] = useState("");
  const [contact, setContact] = useState("");
  const [touched, setTouched] = useState({ code: false, contact: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedOrder[]>([]);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const busy = useRef(false);
  const contactInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const loadingStage = useLoadingStage(loading, [SLOW_MS]);
  const codeValid = GAMES_CODE_RE.test(normalizeCode(code));
  const contactValid = isValidOrderContact(contact.trim());

  useEffect(() => {
    setSaved(uniqueCodes(readEntries(GAMES_DEVICE_KEY).flatMap((entry) => {
      if (typeof entry.code !== "string" || typeof entry.name !== "string") return [];
      const clean = normalizeCode(entry.code);
      return GAMES_CODE_RE.test(clean) ? [{ code: clean, name: entry.name }] : [];
    })).slice(0, 20));
    const recentEntries = uniqueCodes(readEntries(GAMES_RECENT_KEY).flatMap((entry) => {
      if (typeof entry.code !== "string" || typeof entry.contact !== "string") return [];
      const clean = normalizeCode(entry.code);
      const savedAt = Number(entry.savedAt) || Date.now();
      return GAMES_CODE_RE.test(clean) && Date.now() - savedAt < 7 * 86_400_000 ? [{ code: clean, contact: isValidOrderContact(entry.contact) ? entry.contact.trim() : "", savedAt }] : [];
    })).slice(0, 5);
    setRecent(recentEntries);
    if (recentEntries.length) persist(GAMES_RECENT_KEY, recentEntries);
    else { try { localStorage.removeItem(GAMES_RECENT_KEY); } catch { /* Storage opsional. */ } }
    const queryCode = new URLSearchParams(window.location.search).get("code");
    if (queryCode) setCode(normalizeCode(queryCode));
    return () => request.current?.abort();
  }, []);

  async function lookup(rawCode: string, rawContact: string) {
    if (busy.current) return;
    const cleanCode = normalizeCode(rawCode);
    const cleanContact = rawContact.trim();
    setTouched({ code: true, contact: true });
    if (!GAMES_CODE_RE.test(cleanCode) || !isValidOrderContact(cleanContact)) return;
    busy.current = true; setLoading(true); setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetchWithTimeout("/api/games/lookup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: cleanCode, contact: cleanContact }), cache: "no-store", signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : t.trackNotFound);
      if (controller.signal.aborted) return;
      const next = [{ code: cleanCode, contact: cleanContact, savedAt: Date.now() }, ...recent.filter((entry) => entry.code !== cleanCode)].slice(0, 5);
      setRecent(next); persist(GAMES_RECENT_KEY, next);
      rememberOrderContact(cleanCode, cleanContact);
      router.push(`/games/pesanan/${cleanCode}`);
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
      <p className="mt-3 max-w-[58ch] text-sm leading-6 text-white/55">{t.trackIntro}</p>
      <form onSubmit={(event) => { event.preventDefault(); void lookup(code, contact); }} className="ax-glass-card mt-6 rounded-[24px] p-5 sm:p-6" aria-label={t.trackFormAria} aria-busy={loading} noValidate>
        <div className="mb-5 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10"><IosIcon name="search" size={20} tint="#00E5FF" /></span>
          <div><h2 className="text-sm font-semibold text-white">{t.trackFormTitle}</h2><p className="text-xs text-white/45">{t.trackFormSub}</p></div>
        </div>
        <label htmlFor="games-track-code" className="block text-xs font-medium text-white/60">{t.trackCode}</label>
        <input id="games-track-code" value={code} disabled={loading} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(null); }} onBlur={() => setTouched((value) => ({ ...value, code: true }))} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={32} placeholder="AXG-20261116-AB12CD34" aria-invalid={touched.code && !codeValid} aria-describedby="games-code-hint" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 font-mono text-sm font-semibold tracking-[0.06em] text-white outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-white/55 focus:border-[#00E5FF]/50 disabled:opacity-60" />
        <p id="games-code-hint" className={touched.code && !codeValid ? "mt-1.5 text-[11px] text-red-300" : "mt-1.5 text-[11px] text-white/65"}>{touched.code && !codeValid ? t.trackCodeBad : t.trackCodeHint}</p>
        <label htmlFor="games-track-contact" className="mt-4 block text-xs font-medium text-white/60">{t.trackContact}</label>
        <input ref={contactInput} id="games-track-contact" value={contact} disabled={loading} onChange={(event) => { setContact(event.target.value); setError(null); }} onBlur={() => setTouched((value) => ({ ...value, contact: true }))} autoComplete="off" maxLength={254} placeholder={t.trackContactPlaceholder} aria-invalid={touched.contact && !contactValid} aria-describedby="games-contact-hint" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none placeholder:text-white/55 focus:border-[#00E5FF]/50 disabled:opacity-60" />
        <p id="games-contact-hint" className={touched.contact && !contactValid ? "mt-1.5 text-[11px] text-red-300" : "mt-1.5 text-[11px] text-white/65"}>{touched.contact && !contactValid ? t.trackContactBad : t.trackContactHint}</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{error}</p>}
        <button type="submit" disabled={loading} className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#00E5FF] text-base font-bold text-[#080C1E] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
          {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[#080C1E]/25 border-t-[#080C1E] motion-reduce:animate-none" />}
          {loading ? (loadingStage ? t.trackSlow : t.trackLoading) : t.trackSubmit}
        </button>
      </form>
      {recent.length > 0 && (
        <section className="ax-glass-card mt-4 rounded-[20px] p-4 sm:p-5" aria-label={t.recentAria}>
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">{t.recentTitle}</h2>
          <div className="mt-3 space-y-2">{recent.map((entry) => (
            <div key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <button type="button" disabled={loading} onClick={() => {
                const proof = readOrderContact(entry.code) || entry.contact;
                setCode(entry.code); setContact(proof); setError(null);
                if (proof) void lookup(entry.code, proof);
                else { setTouched({ code: true, contact: true }); contactInput.current?.focus(); }
              }} className="min-w-0 flex-1 text-left disabled:opacity-60">
                <span className="block break-all font-mono text-xs font-semibold text-[#00E5FF]">{entry.code}</span>
                <span className="mt-0.5 block break-all text-[11px] text-white/40">{entry.contact ? maskContact(entry.contact) : t.fillContact}</span>
              </button>
              <button type="button" disabled={loading} aria-label={fillGames(t.deleteRecent, { code: entry.code })} onClick={() => { const next = recent.filter((value) => value.code !== entry.code); setRecent(next); persist(GAMES_RECENT_KEY, next); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-60"><span aria-hidden="true"><IosIcon name="close" size={16} tint="white" /></span></button>
            </div>
          ))}</div>
        </section>
      )}
      {saved.length > 0 && (
        <details open className="ax-glass-card mt-4 rounded-[24px] p-4 sm:p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3"><span>{t.savedTitle} <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">{saved.length}</span></span><span aria-hidden="true"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
          <section aria-label={t.savedTitle} className="mt-4">
            <p className="mb-3 text-xs leading-5 text-white/45">{t.savedNote}</p>
            <div className="space-y-2">{saved.map((entry) => (
              <div key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <Link prefetch={false} href={`/games/pesanan/${encodeURIComponent(entry.code)}`} className="min-w-0 flex-1 py-1"><span className="block break-all text-sm font-semibold text-white">{entry.name}</span><span className="mt-1 block break-all font-mono text-xs text-white/45">{entry.code}</span><span className="mt-2 block text-xs font-semibold text-[#00E5FF]">{t.savedOpen}</span></Link>
                <button type="button" aria-label={fillGames(t.savedHide, { code: entry.code })} onClick={() => { const next = saved.filter((value) => value.code !== entry.code); setSaved(next); persist(GAMES_DEVICE_KEY, next); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"><span aria-hidden="true"><IosIcon name="close" size={16} tint="white" /></span></button>
              </div>
            ))}</div>
          </section>
        </details>
      )}
      <section aria-label={t.faqAria} className="mt-4 space-y-2">{t.faq.map(([question, answer]) => (
        <details key={question} className="ax-glass-card rounded-2xl px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3">{question}<span aria-hidden="true" className="shrink-0"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
          <p className="mt-3 text-xs leading-6 text-white/55">{answer}</p>
        </details>
      ))}</section>
    </div>
  );
}
