// src/app/pedia/pesanan/[code]/page.tsx — Status pesanan (PD-12, DESIGN §6.4).
// Panel QRIS + timeline vertikal, progress server, refill dan kredit historis.
"use client";
export const runtime = "edge";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { StatusPill } from "@/components/pedia/StatusWidgets";
import { PediaOrderSkeleton } from "@/components/storefront/Skeletons";
import { Check, Clock3, Copy, Download, QrCode } from "lucide-react";
import { PlatformIcon } from "@/components/pedia/PlatformGrid";
import { detectPediaLink } from "@/lib/pedia/link";
import { parseExpiry } from "@/lib/expiry";
import { SITE } from "@/lib/site";
import type { PediaServiceCopy } from "@/lib/pedia/service-copy";

type Status = {
  service_copy?: PediaServiceCopy | null;
  product_slug?: string; code: string; product_name: string; tier_name: string; tier_note: string | null;
  quantity: number; target: string; status: string; done: number; percent: number;
  eta_start: string | null; eta_finish: string | null; refill_days: number;
  refill_eligible: boolean; refund_credit_code: string | null;
  qris: { payable_amount: number; image_url: string; expires_at: string; status: string } | null;
};

export default function PediaOrderStatusPage() {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refillMsg, setRefillMsg] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const request = useRef({ code: "", id: 0, active: false });
  const load = useCallback(async (manual = false) => {
    if (request.current.active && request.current.code === code) return;
    const id = request.current.id + 1;
    request.current = { code, id, active: true };
    setLoading(true);
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}${manual ? "?wake=1" : ""}`, { cache: "no-store" });
      const d = await res.json();
      if (request.current.id !== id) return;
      if (!res.ok) throw new Error(d.error ?? "Gagal memuat");
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
    // Auto-refresh: 10 dtk menunggu bayar, 60 dtk berjalan, berhenti saat
    // terminal atau tab tersembunyi.
    const tick = () => {
      if (document.hidden) return;
      const s = data?.status;
      if (!s || ["completed", "partial", "canceled", "expired"].includes(s)) return;
      void load();
    };
    const interval = data?.status === "awaiting_payment" ? 10_000 : 60_000;
    const t = setInterval(tick, interval);
    return () => clearInterval(t);
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
        method: "POST", headers: { "content-type": "application/json" },
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
    { label: data.status === "partial" ? "Selesai sebagian" : data.status === "canceled" ? "Dibatalkan supplier" : "Selesai", done: terminal && !expired, active: false },
  ];
  return (
    <div className="mx-auto grid w-full max-w-[1000px] items-start gap-6 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="ax-glass-card order-2 min-w-0 rounded-[24px] p-5 sm:p-8 lg:order-1" aria-label="Status pesanan">
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
              {i === 2 && processing && <div className="mt-3"><div role="progressbar" aria-label="Progres pesanan" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#00E5FF] transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} /></div><p className="mt-2 font-mono text-xs text-white/55">{(complete ? data.quantity : data.done).toLocaleString("id-ID")} / {data.quantity.toLocaleString("id-ID")} masuk</p></div>}
              {i === 3 && complete && <p className="mt-1 text-xs leading-5 text-emerald-300">Pesanan selesai. Terima kasih sudah memesan!</p>}
            </div>
          </li>)}
        </ol>
          {(data.status === "partial" || data.status === "canceled") && data.refund_credit_code && (
            <div className="mt-6 rounded-[20px] border border-[#FFB800]/40 bg-[#FFB800]/5 p-4">
              <p className="text-sm text-white/80">
                {data.status === "partial"
                  ? "Sebagian pesanan tidak terpenuhi. Sisa kami kembalikan sebagai Kode Kredit — bisa langsung dipakai belanja lagi."
                  : "Pesanan dibatalkan supplier. Dana penuh kami kembalikan sebagai Kode Kredit."}
              </p>
              <p className="mt-2 flex items-center gap-2 font-mono text-base font-bold text-white">
                {data.refund_credit_code}
                <button onClick={() => copy(data.refund_credit_code!)} className="h-8 rounded-full bg-white/10 px-3 font-sans text-xs font-bold text-white">Salin</button>
              </p>
              <p className="mt-1 text-xs text-white/55">Berlaku 180 hari, hanya untuk belanja di Pedia.</p>
            </div>
          )}
          {data.status === "needs_check" && (
            <div className="mt-6 rounded-[20px] border border-white/10 bg-white/[0.03] p-4 text-sm text-white/75">
              Ada kendala teknis dan admin sedang memeriksa. Tidak perlu order ulang — kami kabari lewat email.
            </div>
          )}

        {data.eta_finish && paid && <p className="mt-5 text-xs leading-5 text-white/55">Perkiraan selesai: {data.eta_finish}. Estimasi mengikuti antrean.</p>}
        {data.refill_days > 0 && <p className="mt-2 text-xs text-white/55">Refill {data.refill_days} hari sesuai ketentuan layanan.</p>}
      {data.service_copy && <div className="mt-4 space-y-2">{([
        ["Deskripsi layanan", data.service_copy.description],
        ["Syarat & ketentuan layanan", data.service_copy.terms],
        ["Panduan layanan", data.service_copy.instructions],
      ] as const).filter(([, text]) => text).map(([label, text]) => <details key={label} className="rounded-xl border border-white/10 bg-white/[0.025] p-3"><summary className="cursor-pointer text-sm text-white/75">{label}</summary><p className="mt-3 whitespace-pre-line break-words text-sm leading-6 text-white/60">{text}</p></details>)}</div>}
          {data.refill_eligible && !refillOpen && (
            <button onClick={() => setRefillOpen(true)} className="mt-4 h-12 w-full rounded-[14px] border border-[var(--px-violet)] bg-[var(--px-violet-soft)] text-sm font-bold text-white">
              Ajukan Refill
            </button>
          )}
          {data.refill_eligible && refillOpen && (
            <div className="mt-4 rounded-[14px] border border-white/12 bg-white/[0.04] p-4" role="dialog" aria-label="Verifikasi refill">
              <label htmlFor="refill-contact" className="text-xs font-medium text-white/60">No. WA atau email saat checkout (verifikasi)</label>
              <input
                id="refill-contact"
                value={refillContact}
                onChange={(e) => setRefillContact(e.target.value)}
                placeholder="08… atau nama@email.com"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-white/[0.06] px-3.5 text-sm text-white placeholder:text-white/30 focus:border-[#00E5FF]/50 focus:outline-none"
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
        <div className="ax-glass-card rounded-[24px] p-6 text-center">
          {expired ? <><h2 className="font-display text-xl font-semibold text-white">Pesanan kedaluwarsa</h2><p className="mt-3 text-sm leading-6 text-white/60">Pembayaran tidak diterima sebelum batas waktu. Kredit yang terpakai dikembalikan ke kode asal setelah pemeriksaan otomatis.</p></> : pending ? <>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/60">Pembayaran QRIS</h2>
            {!data.qris ? <p className="mt-5 text-sm leading-6 text-white/70">Menunggu pembayaran. QRIS belum tersedia. Lanjutkan kembali dari halaman checkout dengan data yang sama, atau hubungi admin dengan kode pesanan ini.</p> : qrExpired ? <><h3 className="mt-5 text-lg font-semibold text-white">QRIS kedaluwarsa</h3><p className="mt-3 text-sm leading-6 text-white/60">Batas pembayaran telah lewat. Jangan membayar QRIS ini. Status pesanan akan diperbarui otomatis.</p></> : <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.qris.image_url} alt="QRIS pembayaran" className="mx-auto mt-4 aspect-square w-full max-w-[240px] rounded-2xl bg-white p-2" />
              <p className="mt-5 font-display text-2xl font-bold leading-8 text-white">Rp{Number(data.qris.payable_amount).toLocaleString("id-ID")}</p>
              <p className="mt-1 text-[13px] text-white/60">Bayar tepat sesuai nominal ini</p>
              <p className={`mt-4 flex items-center justify-center gap-1.5 font-mono text-sm ${seconds < 120 ? "text-red-300" : "text-[#FFB800]"}`}><Clock3 size={14} aria-hidden="true" /><span aria-label="Sisa waktu pembayaran">{countdown}</span></p>
              <div className="mt-5 grid grid-cols-2 gap-2.5"><a href={data.qris.image_url} download={`AXVARA-${data.code}-QRIS.png`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-2 text-sm text-white/80"><Download size={15} aria-hidden="true" />Simpan QRIS</a><button type="button" disabled={loading} onClick={() => void load(true)} className="min-h-11 rounded-xl bg-[#00E5FF] px-2 text-sm font-semibold text-[#080C1E] disabled:opacity-50">{loading ? "Memeriksa…" : "Cek pembayaran"}</button></div>
            </>}
          </> : <div className="py-6"><span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={32} /></span><h2 className="mt-4 font-display text-xl font-semibold text-white">Pembayaran diterima</h2>{data.qris && <p className="mt-2 font-display text-2xl font-bold leading-8 text-white">Rp{Number(data.qris.payable_amount).toLocaleString("id-ID")}</p>}<p className="mt-3 text-[13px] leading-6 text-white/60">Pantau perkembangan pesanan pada halaman ini. Status mengikuti pembaruan sistem.</p></div>}
          {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[13px] text-white/60"><span>Butuh bantuan?</span><a href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Halo, saya ingin menanyakan pesanan Pedia ${data.code}`)}`} className="font-semibold text-[#00E5FF]">WA Admin</a><a href="/pedia/lacak" className="font-semibold text-[#00E5FF]">Lacak lain</a></div>
      </aside>
    </div>
  );
}
