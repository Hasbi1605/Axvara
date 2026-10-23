"use client";

export const runtime = "edge";

import { rememberPediaContact } from "@/lib/pedia/buyer-session";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { SLOW_MS, useLoadingStage } from "@/hooks/useLoadingStage";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

type SavedOrder = { code: string; name: string };
type RecentEntry = { code: string; contact: string; savedAt?: number };
const DEVICE_KEY = "axp-orders";
const RECENT_KEY = "axp-track-recent";
const CODE_RE = /^AXP-\d{8}-[A-Z0-9]{8}$/;
const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");
function validContact(value: string) {
  const contact = value.trim();
  return contact.length <= 254 && (contact.includes("@")
    ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)
    : /^(\+62|62|0)8\d{8,13}$/.test(contact.replace(/[\s-]/g, "")));
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
function maskContact(contact: string) {
  if (contact.includes("@")) {
    const [name, domain] = contact.split("@");
    return "Email " + name.slice(0, 1) + "***@" + domain;
  }
  const phone = contact.replace(/[\s-]/g, "");
  return "WA " + phone.slice(0, 4) + "****" + phone.slice(-4);
}
const FAQ = [
  ["Di mana saya menemukan kode pesanan?", "Kode AXP ditampilkan setelah checkout, di halaman pembayaran dan status pesanan. Jika memesan di browser ini, buka daftar Pesanan di perangkat ini di atas."],
  ["No. WA atau email saya salah ketik?", "Gunakan No. WA atau email yang kamu isi saat checkout. Jika mengisi keduanya, coba kontak lainnya. Jika keduanya salah, hubungi WA Admin dengan kode pesanan untuk dibantu."],
  ["Sudah bayar QRIS, tetapi status masih menunggu bayar?", "Buka halaman pesanan untuk melihat pembaruan pembayaran otomatis. Pastikan nominal yang dibayar sesuai tagihan. Jika belum berubah, hubungi WA Admin dengan kode pesanan dan bukti pembayaran."],
  ["Bagaimana cara mengajukan refill?", "Buka halaman status pesanan. Tombol refill tersedia jika layanan dan pesanan memenuhi ketentuan. Masa garansi refill, batas pengajuan, dan syarat lainnya mengikuti layanan yang kamu pilih."],
];

export default function PediaTrackPage() {
  const router = useRouter();
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
      return CODE_RE.test(cleanCode) && validContact(entry.contact) && Date.now() - savedAt < 7 * 86_400_000 ? [{ code: cleanCode, contact: entry.contact.trim(), savedAt }] : [];
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
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: cleanCode, contact: cleanContact }),
        cache: "no-store", signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Pesanan tidak ditemukan. Periksa kode dan kontak checkout.");
      if (data.order?.code !== cleanCode) throw new Error("Data pesanan belum dapat dimuat. Silakan coba lagi.");
      if (controller.signal.aborted) return;
      const next = [{ code: cleanCode, contact: cleanContact, savedAt:Date.now() }, ...recent.filter((entry) => entry.code !== cleanCode)].slice(0, 5);
      setRecent(next);
      persist(RECENT_KEY, next);
      rememberPediaContact(cleanCode, cleanContact);
      router.push("/pedia/pesanan/" + encodeURIComponent(cleanCode));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : "Koneksi bermasalah. Periksa internet lalu coba lagi.");
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/80">Lacak Pesanan</p>
      <h1 className="mt-2 font-display text-3xl font-bold text-white sm:text-4xl">Cek status pesananmu</h1>
      <p className="mt-3 max-w-[58ch] text-sm leading-6 text-white/55">Masukkan <strong className="font-semibold text-white">kode pesanan</strong> dan <strong className="font-semibold text-white">No. WA atau email yang dipakai saat checkout</strong>. Pantau pembayaran, proses layanan, dan pengajuan refill dari halaman pesanan Pedia.</p>
      <form onSubmit={(event) => { event.preventDefault(); void lookup(code, contact); }} className="ax-glass-card mt-6 rounded-[24px] p-5 sm:p-6" aria-label="Formulir lacak pesanan" aria-busy={loading} noValidate>
        <div className="mb-5 flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E5FF]/10"><IosIcon name="search" size={20} tint="#00E5FF" /></span>
          <div><h2 className="text-sm font-semibold text-white">Kode + No. WA atau email</h2><p className="text-xs text-white/45">Tanpa login, tanpa daftar akun.</p></div>
        </div>
        <label htmlFor="pedia-track-code" className="block text-xs font-medium text-white/60">Kode pesanan *</label>
        <input id="pedia-track-code" value={code} disabled={loading} onChange={(event) => { setCode(event.target.value.toUpperCase()); setError(null); }} onBlur={() => setTouched((value) => ({ ...value, code: true }))} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={32} placeholder="AXP-20261016-AB12CD34" aria-invalid={touched.code && !codeValid} aria-describedby="pedia-code-hint" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 font-mono text-sm font-semibold tracking-[0.06em] text-white outline-none placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-white/30 focus:border-[#00E5FF]/50 disabled:opacity-60" />
        <p id="pedia-code-hint" className={touched.code && !codeValid ? "mt-1.5 text-[11px] text-red-300" : "mt-1.5 text-[11px] text-white/30"}>{touched.code && !codeValid ? "Masukkan kode pesanan Pedia dengan format AXP-20261016-AB12CD34." : "Lihat di halaman pembayaran atau status pesanan setelah checkout."}</p>
        <label htmlFor="pedia-track-contact" className="mt-4 block text-xs font-medium text-white/60">No. WA atau email checkout *</label>
        <input id="pedia-track-contact" value={contact} disabled={loading} onChange={(event) => { setContact(event.target.value); setError(null); }} onBlur={() => setTouched((value) => ({ ...value, contact: true }))} autoComplete="off" maxLength={254} placeholder="0812... atau nama@email.com" aria-invalid={touched.contact && !contactValid} aria-describedby="pedia-contact-hint" className="mt-1.5 h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#00E5FF]/50 disabled:opacity-60" />
        <p id="pedia-contact-hint" className={touched.contact && !contactValid ? "mt-1.5 text-[11px] text-red-300" : "mt-1.5 text-[11px] text-white/30"}>{touched.contact && !contactValid ? "Masukkan No. WA Indonesia atau email yang valid." : "Harus sama dengan No. WA atau email yang diisi saat checkout."}</p>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{error}</p>}
        <button type="submit" disabled={loading || !codeValid || !contactValid} className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#00E5FF] text-base font-bold text-[#080C1E] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
          {loading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[#080C1E]/25 border-t-[#080C1E] motion-reduce:animate-none" />}
          {loading ? (loadingStage ? "Koneksi lambat, masih melacak…" : "Melacak pesanan…") : "Lacak Pesanan"}
        </button>
        {loading && <p role="status" className="mt-2 text-xs text-white/45">Sedang memeriksa kode dan kontak checkout.</p>}
      </form>
      {recent.length > 0 && (
        <section className="ax-glass-card mt-4 rounded-[20px] p-4 sm:p-5" aria-label="Terakhir dilacak">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-white/50">Terakhir dilacak di perangkat ini</h2>
          <div className="mt-3 space-y-2">{recent.map((entry) => (
            <div key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <button type="button" disabled={loading} onClick={() => { setCode(entry.code); setContact(entry.contact); void lookup(entry.code, entry.contact); }} className="min-w-0 flex-1 text-left disabled:opacity-60">
                <span className="block break-all font-mono text-xs font-semibold text-[#00E5FF]">{entry.code}</span>
                <span className="mt-0.5 block break-all text-[11px] text-white/40">{maskContact(entry.contact)}</span>
              </button>
              <button type="button" disabled={loading} aria-label={"Hapus riwayat " + entry.code} onClick={() => { const next = recent.filter((value) => value.code !== entry.code); setRecent(next); persist(RECENT_KEY, next); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-60"><span aria-hidden="true"><IosIcon name="close" size={16} tint="white" /></span></button>
            </div>
          ))}</div>
        </section>
      )}
      {saved.length > 0 && (
        <details className="ax-glass-card mt-4 rounded-[24px] p-4 sm:p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3"><span>Pesanan di perangkat ini <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">{saved.length}</span></span><span aria-hidden="true"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
          <section aria-label="Pesanan di perangkat ini" className="mt-4">
            <p className="mb-3 text-xs leading-5 text-white/45">Tersimpan di browser ini. Buka pesanan untuk melihat status terbarunya.</p>
            <div className="space-y-2">{saved.map((entry) => (
              <div key={entry.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <Link prefetch={false} href={"/pedia/pesanan/" + encodeURIComponent(entry.code)} className="min-w-0 flex-1 py-1"><span className="block break-all text-sm font-semibold text-white">{entry.name}</span><span className="mt-1 block break-all font-mono text-xs text-white/45">{entry.code}</span><span className="mt-2 block text-xs font-semibold text-[#00E5FF]">Lihat pesanan →</span></Link>
                <button type="button" aria-label={"Sembunyikan " + entry.code + " dari perangkat ini"} onClick={() => { const next = saved.filter((value) => value.code !== entry.code); setSaved(next); persist(DEVICE_KEY, next); }} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"><span aria-hidden="true"><IosIcon name="close" size={16} tint="white" /></span></button>
              </div>
            ))}</div>
          </section>
        </details>
      )}
      <section aria-label="Bantuan lacak pesanan" className="mt-4 space-y-2">{FAQ.map(([question, answer]) => (
        <details key={question} className="ax-glass-card rounded-2xl px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex items-center justify-between gap-3">{question}<span aria-hidden="true" className="shrink-0"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
          <p className="mt-3 text-xs leading-6 text-white/55">{answer}</p>
        </details>
      ))}</section>
    </div>
  );
}
