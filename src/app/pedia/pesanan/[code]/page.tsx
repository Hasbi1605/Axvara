// src/app/pedia/pesanan/[code]/page.tsx — Status pesanan (PD-12, DESIGN §6.4).
// Panel QRIS, timeline/progres server, refill dan penyelesaian manual.
"use client";
export const runtime = "edge";

import { readPediaContact, rememberPediaContact } from "@/lib/pedia/buyer-session";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { StatusPill } from "@/components/pedia/StatusWidgets";
import { InlineSpinner, PediaOrderSkeleton } from "@/components/storefront/Skeletons";
import { Check, Clock3, Copy, Download, QrCode } from "lucide-react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { detectPediaLink } from "@/lib/pedia/link";
import { parseExpiry } from "@/lib/expiry";
import { SITE } from "@/lib/site";
import type { PediaServiceCopy } from "@/lib/pedia/service-copy";
import { isValidOrderContact, orderAccessHeaders, readOrderContact, rememberOrderContact } from "@/lib/order-access-client";

type Status = {
  service_copy?: PediaServiceCopy | null;
  product_slug?: string; code: string; product_name: string; tier_name: string; tier_note: string | null;
  quantity: number; target: string; status: string; done: number | null; percent: number | null;
  eta_start: string | null; eta_finish: string | null; refill_days: number;
  refill_eligible: boolean;
  qris: { payable_amount: number; unique_code?: number | null; image_url: string; expires_at: string; status: string } | null;
};

function QrisImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const url = attempt > 0 ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
  return <div className="mx-auto mt-2 w-[224px] max-w-full rounded-xl bg-white p-2.5 sm:w-[240px]"><div className="relative aspect-square w-full">
    {state !== "ready" && <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-[#080C1E]/[0.04] text-[#080C1E]/60">
      {state === "loading" ? <><InlineSpinner className="h-7 w-7" tone="dark" /><span className="text-xs font-medium">Memuat QRIS…</span></> : <><span className="text-xs font-semibold text-[#080C1E]/80">QRIS gagal dimuat</span><button type="button" onClick={() => { setState("loading"); setAttempt((n) => n + 1); }} className="h-9 rounded-xl bg-[#080C1E] px-4 text-xs font-bold text-white">Muat ulang QRIS</button></>}
    </div>}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={url} src={url} alt={alt} onLoad={() => setState("ready")} onError={() => setState("error")} className={`h-full w-full rounded-xl object-contain transition-opacity duration-300 ${state === "ready" ? "opacity-100" : "opacity-0"}`} />
  </div></div>;
}

export default function PediaOrderStatusPage() {
  const { code } = useParams<{ code: string }>();
  const [contact, setContact] = useState("");
  const buyerContact = useRef("");
  const [needsContact, setNeedsContact] = useState(false);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refillMsg, setRefillMsg] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const request = useRef({ code: "", id: 0, active: false });
  const load = useCallback(async (manual = false, contactOverride = "") => {
    if (request.current.active && request.current.code === code) return;
    const id = request.current.id + 1;
    request.current = { code, id, active: true };
    setLoading(true);
    try {
      // Pedia: status/refill kontak saja, tanpa PIN. Kontak dari argumen,
      // memori tab, atau sesi pedia; tidak pernah baca PIN.
      const proof = (contactOverride || buyerContact.current || readOrderContact(code) || readPediaContact(code)).trim();
      if (proof && isValidOrderContact(proof)) {
        buyerContact.current = proof;
        setRefillContact(proof);
      }
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}${manual ? "?wake=1" : ""}`, { cache: "no-store", headers: { "x-order-contact": proof, ...orderAccessHeaders(code, proof) } });
      const d = await res.json();
      if (request.current.id !== id) return;
      if (res.status === 401 || res.status === 404) { setNeedsContact(true); throw new Error(d.error === "contact_required" ? "Isi No. WA atau email checkout untuk melihat pesanan ini." : d.error); }
      if (!res.ok) throw new Error(d.error ?? "Gagal memuat");
      setNeedsContact(false);
      if (rememberOrderContact(code, proof)) buyerContact.current = proof;
      setData(d.order);
      setError(null);
    } catch (e) {
      if (request.current.id === id) setError(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      if (request.current.id === id) {
        request.current.active = false;
        setLoading(false);
      }
    }
  }, [code]);

  useEffect(() => { setData(null); setError(null); void load(); }, [load]);
  useEffect(() => {
    // Match Market payment feedback; processing updates stay cheap/local.
    const tick = () => {
      if (document.hidden) return;
      const s = data?.status;
      if (!s || ["completed", "partial", "canceled", "expired", "needs_check"].includes(s)) return;
      void load();
    };
    const interval = data?.status === "awaiting_payment" ? 5_000 : 10_000;
    const t = setInterval(tick, interval);
    const onVisibility = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisibility); };
  }, [load, data?.status]);

  const qrDeadline = data?.qris?.expires_at;
  useEffect(() => {
    if (data?.status !== "awaiting_payment" || !qrDeadline) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.status, qrDeadline]);

  const [refillOpen, setRefillOpen] = useState(false);
  const [refillContact, setRefillContact] = useState("");
  const [refillBusy, setRefillBusy] = useState(false);
  const refill = async () => {
    const contact = refillContact.trim();
    if (!contact || refillBusy) return;
    setRefillBusy(true);
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}/refill`, {
        method: "POST", headers: { "content-type": "application/json", ...orderAccessHeaders(code) },
        body: JSON.stringify({ contact }),
      });
      const d = await res.json();
      setRefillMsg(d.message ?? d.error ?? "");
      if (res.ok) { setRefillOpen(false); void load(); }
    } catch {
      setRefillMsg("Permintaan refill belum terkirim. Coba lagi.");
    } finally {
      setRefillBusy(false);
    }
  };

  if (needsContact && !data) return <form className="mx-auto max-w-md space-y-4 px-4 py-10" onSubmit={(e) => { e.preventDefault(); if (!isValidOrderContact(contact)) return; rememberPediaContact(code, contact.trim()); rememberOrderContact(code, contact.trim()); void load(false, contact.trim()); }}>
    <h1 className="font-display text-2xl font-semibold text-white">Lihat pesanan</h1>
    <label className="block text-sm text-white/75" htmlFor="pedia-order-contact">No. WA atau email checkout *</label>
    <p className="text-xs leading-5 text-white/60">Kontak yang dipakai saat checkout. Pedia tidak memakai PIN.</p>
    <input id="pedia-order-contact" value={contact} onChange={e => setContact(e.target.value)} required maxLength={254} autoComplete="off" placeholder="0812… atau nama@email.com" className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-white" />
    {error && <p role="alert" className="text-sm text-white/60">{error}</p>}
    <button disabled={loading} className="rounded-full bg-[#00E5FF] px-5 py-3 font-semibold text-[#070a1e]">{loading ? "Memeriksa…" : "Lihat pesanan"}</button>
  </form>;
  if (error && !data) return <p className="pt-10 text-center text-sm text-red-300">{error}</p>;
  if (!data) return <PediaOrderSkeleton />;

  const qrExpired = data.qris && (["expired", "failed"].includes(data.qris.status) || (parseExpiry(data.qris.expires_at) ?? 0) <= now);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* Kode tetap bisa disalin dari teks. */ }
  };

  const pending = data.status === "awaiting_payment";
  const expired = data.status === "expired";
  const paid = !pending && !expired;
  const complete = data.status === "completed";
  const terminal = ["completed", "partial", "canceled", "expired"].includes(data.status);
  const processing = ["submitting", "submitted", "in_progress", "completed", "partial"].includes(data.status);
  const percent = complete ? 100 : Math.max(0, Math.min(100, data.percent || 0));
  const seconds = Math.max(0, Math.ceil(((parseExpiry(data.qris?.expires_at ?? "") ?? 0) - now) / 1000));
  const countdown = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const platform = detectPediaLink(data.target)?.platform;
  const timeline = [
    { label: "Pesanan dibuat", done: true, active: pending },
    { label: "Pembayaran diterima", done: paid, active: paid && !processing && !terminal },
    { label: "Sedang diproses", done: processing, active: processing && !terminal },
    { label: data.status === "partial" ? "Selesai sebagian" : data.status === "canceled" ? "Dibatalkan" : "Selesai", done: terminal && !expired, active: false },
  ];
  return (
    <div className="mx-auto grid w-full max-w-[1000px] items-start gap-6 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="ax-glass-card order-2 min-w-0 rounded-2xl p-4 sm:p-6 lg:order-1" aria-label="Status pesanan">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => void copy(data.code)} aria-label="Salin kode pesanan" className="flex min-h-9 min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-left font-mono text-xs text-white/60 hover:text-white"><span className="break-all">{data.code}</span>{copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</button>
          <StatusPill status={data.status} />
        </div>
        <div className="mt-6 flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">{platform ? <PlatformIcon id={platform} size={32} /> : <QrCode size={28} aria-hidden="true" />}</span>
          <div className="min-w-0"><h1 className="font-display text-2xl font-semibold text-white">{data.service_copy?.product_name ?? data.product_name}</h1><p className="mt-1 text-[13px] leading-5 text-white/60">{data.service_copy?.service_name ?? data.tier_note ?? data.tier_name} · {data.quantity.toLocaleString("id-ID")}</p></div>
        </div>
        <p className="mt-3 break-all text-xs leading-5 text-white/50">{data.target}</p>
        <ol className="mt-8" aria-label="Perjalanan pesanan">
          {timeline.map((step, i) => <li key={i} aria-current={step.active ? "step" : undefined} className="relative flex gap-4 pb-7 last:pb-0">
            {i < 3 && <span aria-hidden="true" className={`absolute bottom-0 left-[13px] top-7 w-px ${timeline[i + 1].done ? "bg-[#00E5FF]" : "bg-white/10"}`} />}
            <span aria-hidden="true" className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${step.done ? "border-[#00E5FF] bg-[#0F273C] text-[#00E5FF]" : "border-white/15 bg-[#0F1430] text-white/45"} ${step.active ? "ring-4 ring-[#00E5FF]/15" : ""}`}>{step.done && !step.active ? <Check size={14} /> : i + 1}</span>
            <div className="min-w-0 flex-1"><p className={`text-sm font-semibold ${step.done ? "text-white" : "text-white/45"}`}>{step.label}</p>
              {i === 0 && <p className="mt-1 text-xs leading-5 text-white/50">Simpan kode ini untuk melacak pesananmu.</p>}
              {i === 1 && pending && <p className="mt-1 text-xs leading-5 text-white/50">Terdeteksi otomatis setelah QRIS dibayar.</p>}
              {i === 2 && processing && <div className="mt-3"><div role="progressbar" aria-label="Progres pesanan" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#00E5FF] transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} /></div><p className="mt-2 font-mono text-xs text-white/55">{data.done === null && !complete ? "Jumlah terkirim belum dikonfirmasi supplier" : `${(complete ? data.quantity : data.done ?? 0).toLocaleString("id-ID")} / ${data.quantity.toLocaleString("id-ID")} masuk`}</p></div>}
              {i === 3 && complete && <p className="mt-1 text-xs leading-5 text-emerald-300">Pesanan selesai. Terima kasih sudah memesan!</p>}
            </div>
          </li>)}
        </ol>
          {(data.status === "partial" || data.status === "canceled") && (
            <div className="mt-6 rounded-[20px] border border-[#FFB800]/40 bg-[#FFB800]/5 p-4 text-sm text-white/80">
              <p>{data.status === "partial" ? "Pesanan selesai sebagian." : "Pesanan dibatalkan."} Hubungi admin dengan kode pesanan untuk penyelesaian manual.</p>
              <a className="mt-3 inline-flex min-h-11 items-center rounded-full bg-white/10 px-4 font-semibold" href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Halo admin, mohon bantu pesanan Pedia ${data.code}.`)}`}>Hubungi admin</a>
            </div>
          )}
          {data.status === "needs_check" && (
            <div className="mt-6 rounded-[20px] border border-white/10 bg-white/[0.03] p-4 text-sm text-white/75">
              Ada kendala teknis dan admin sedang memeriksa. Tidak perlu order ulang — kami kabari lewat email.
            </div>
          )}

        {data.eta_finish && paid && <p className="mt-5 text-xs leading-5 text-white/55">Perkiraan selesai: {data.eta_finish}. Estimasi mengikuti antrean.</p>}
        {data.refill_days > 0 && <p className="mt-5 text-xs text-white/55">Refill {data.refill_days} hari sesuai ketentuan layanan.</p>}
      {data.service_copy && <div className="mt-4 space-y-3">{([
        ["Deskripsi layanan", data.service_copy.description],
        ["Syarat & ketentuan layanan", data.service_copy.terms],
        ["Panduan layanan", data.service_copy.instructions],
      ] as const).filter(([, text]) => text).map(([label, text]) => <section key={label} aria-label={label} className="ax-glass-card rounded-2xl p-3.5 text-[13px] leading-6 text-white/70"><h3 className="text-sm font-bold text-white">{label}</h3><p className="mt-2 whitespace-pre-line break-words">{text}</p></section>)}</div>}
          {data.refill_eligible && !refillOpen && (
            <button onClick={() => setRefillOpen(true)} className="mt-4 min-h-11 w-full rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 text-sm font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20">
              Ajukan Refill
            </button>
          )}
          {data.refill_eligible && refillOpen && (
            <div className="mt-4 rounded-[14px] border border-white/12 bg-white/[0.04] p-4" role="dialog" aria-label="Verifikasi refill">
              <label htmlFor="refill-contact" className="text-xs font-medium text-white/60">No. WA atau email checkout *</label>
              <input
                id="refill-contact"
                value={refillContact}
                onChange={(e) => setRefillContact(e.target.value)}
                placeholder="0812… atau nama@email.com"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-white/[0.06] px-3.5 text-sm text-white placeholder:text-white/55 focus:border-[#00E5FF]/50 focus:outline-none"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setRefillOpen(false)} disabled={refillBusy} className="h-10 rounded-xl border border-white/12 text-sm font-semibold text-white/70 disabled:opacity-50">Batal</button>
                <button type="button" onClick={() => void refill()} disabled={refillBusy || refillContact.trim().length < 6} className="h-10 rounded-xl bg-[#00E5FF] text-sm font-bold text-[#070a1e] disabled:opacity-50">{refillBusy ? "Mengirim…" : "Kirim Refill"}</button>
              </div>
            </div>
          )}
          {refillMsg && <p className="mt-2 text-center text-[13px] text-white/70">{refillMsg}</p>}
        {terminal && <div className="mt-8 flex flex-wrap gap-3 border-t border-white/10 pt-6"><a href={data.product_slug ? `/pedia/o/${encodeURIComponent(data.product_slug)}` : "/pedia"} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#00E5FF] px-5 py-3 text-sm font-semibold text-[#080C1E]">Pesan lagi</a><a href="/pedia" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-5 py-3 text-sm text-white">Kembali ke katalog</a></div>}
      </section>
      <aside className="order-1 min-w-0 lg:order-2 lg:sticky lg:top-24">
        <div className="ax-glass-card ax-liquid relative rounded-2xl p-4 text-center sm:p-5">
          {expired ? <><h2 className="font-display text-xl font-semibold text-white">Pesanan kedaluwarsa</h2><p className="mt-3 text-sm leading-6 text-white/60">Pembayaran tidak diterima sebelum batas waktu. Jika pesanan lama memakai kode kredit, hubungi admin untuk penyelesaian manual.</p></> : pending ? <>
            <h2 className="font-display text-base font-bold text-white sm:text-lg">Pembayaran QRIS</h2>
            {!data.qris ? <p className="mt-5 text-sm leading-6 text-white/70">Menunggu pembayaran. QRIS belum tersedia. Lanjutkan kembali dari halaman checkout dengan data yang sama, atau hubungi admin dengan kode pesanan ini.</p> : qrExpired ? <><h3 className="mt-5 text-lg font-semibold text-white">QRIS kedaluwarsa</h3><p className="mt-3 text-sm leading-6 text-white/60">Batas pembayaran telah lewat. Jangan membayar QRIS ini. Status pesanan akan diperbarui otomatis.</p></> : <>
              <section aria-label="QRIS dinamis" className="mt-4 rounded-xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-3 text-center sm:p-4">
                <QrisImage key={`${data.qris.image_url}|${data.qris.expires_at}`} src={data.qris.image_url} alt="QRIS pembayaran" />
                <div className="mt-2 flex items-center justify-center gap-1.5" aria-label="QRIS National Payment Standard"><img src="/brand/qris.svg" alt="Logo QRIS resmi" width={48} height={18} className="h-[18px] w-auto object-contain" draggable={false} /><span className="text-[9px] text-white/55">National Payment Standard</span></div>
                <span className="mt-4 inline-flex rounded-full border border-[#FFB800]/20 bg-[#FFB800]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FFB800]">Menunggu bayar</span>
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/45">Total bayar</p>
                <p className="font-display text-2xl font-bold leading-8 text-white">Rp{Number(data.qris.payable_amount).toLocaleString("id-ID")}</p>
                {(data.qris.unique_code ?? 0) > 0 && <p className="text-[11px] text-white/50">Termasuk kode unik <span className="font-mono text-[#00E5FF]">+{data.qris.unique_code}</span></p>}
                <p className={`mt-1 flex items-center justify-center gap-1.5 font-mono text-[13px] ${seconds < 120 ? "text-red-300" : "text-[#FFB800]"}`}><Clock3 size={13} aria-hidden="true" />Berlaku <span aria-label="Sisa waktu pembayaran">{countdown}</span></p>
                <p className="mt-1 text-[11px] text-white/50">Bayar tepat sesuai total.</p>
                <div className="mt-3 grid grid-cols-2 gap-2"><a href={data.qris.image_url} download={`AXVARA-${data.code}-QRIS.png`} className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-2 text-xs font-semibold text-white/75 hover:bg-white/10"><Download size={14} aria-hidden="true" />Simpan QRIS</a><button type="button" disabled={loading} onClick={() => void load(true)} className="inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-2 text-xs font-bold text-[#00E5FF] transition hover:bg-[#00E5FF]/20 disabled:opacity-50">{loading && <InlineSpinner />}{loading ? "Memeriksa…" : "Cek pembayaran"}</button></div>
                <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] leading-4 text-white/50" aria-live="polite"><InlineSpinner className="h-3 w-3" /><span>Mengecek pembayaran otomatis tiap 5 detik</span></p>
              </section>
            </>}
          </> : <div className="py-6"><span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={32} /></span><h2 className="mt-4 font-display text-xl font-semibold text-white">Pembayaran diterima</h2>{data.qris && <p className="mt-2 font-display text-2xl font-bold leading-8 text-white">Rp{Number(data.qris.payable_amount).toLocaleString("id-ID")}</p>}<p className="mt-3 text-[13px] leading-6 text-white/60">Pantau perkembangan pesanan pada halaman ini. Status mengikuti pembaruan sistem.</p></div>}
          {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[13px] text-white/60"><span>Butuh bantuan?</span><a href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Halo, saya ingin menanyakan pesanan Pedia ${data.code}`)}`} className="font-semibold text-[#00E5FF]">WA Admin</a><a href="/pedia/lacak" className="font-semibold text-[#00E5FF]">Lacak lain</a></div>
      </aside>
    </div>
  );
}
