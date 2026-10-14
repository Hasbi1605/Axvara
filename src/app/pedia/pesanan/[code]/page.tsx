// src/app/pedia/pesanan/[code]/page.tsx — Status pesanan (PD-12, DESIGN §6.4).
// QRIS (sebelum lunas) / ring + timeline + refill + kartu kredit + needs_check.
"use client";

export const runtime = "edge";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProgressRing, StatusPill, OrderTimeline } from "@/components/pedia/StatusWidgets";
import { PediaOrderSkeleton } from "@/components/storefront/Skeletons";
import { SITE } from "@/lib/site";

type Status = {
  code: string; product_name: string; tier_name: string; tier_note: string | null;
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

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pedia/orders/${encodeURIComponent(code ?? "")}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Gagal memuat");
      setData(d.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat");
    }
  }, [code]);

  useEffect(() => {
    void load();
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
    } finally {
      setRefillBusy(false);
    }
  };

  if (error) return <p className="pt-10 text-center text-sm text-red-300">{error}</p>;
  if (!data) return <PediaOrderSkeleton />;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* abaikan */ }
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-6">
    <div className="mx-auto max-w-xl">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-sm font-bold text-white">{data.code}</p>
        <button onClick={() => copy(data.code)} className="h-8 rounded-full bg-white/5 px-3 text-xs font-bold text-white/70">Salin</button>
        <span className="ml-auto"><StatusPill status={data.status} /></span>
      </div>
      <p className="mt-1 text-sm text-white/65">
        {data.product_name} · <span className="capitalize">{data.tier_name}</span> · {data.quantity.toLocaleString("id-ID")}
      </p>
      <p className="truncate text-[13px] text-white/45">{data.target}</p>

      {data.status === "awaiting_payment" && data.qris ? (
        <div className="ax-glass-card mt-6 rounded-[20px] p-5 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.qris.image_url} alt="QRIS pembayaran" className="mx-auto h-56 w-56 rounded-xl bg-white p-2" />
          <p className="mt-3 font-display text-xl font-bold text-white">Rp{Number(data.qris.payable_amount).toLocaleString("id-ID")}</p>
          <p className="text-xs text-white/55">QRIS berlaku 15 menit. Halaman ini refresh otomatis.</p>
        </div>
      ) : (
        <div className="mt-6">
          {(data.status === "partial" || data.status === "canceled") && data.refund_credit_code && (
            <div className="mb-4 rounded-[20px] border border-[#FFB800]/40 bg-[#FFB800]/5 p-4">
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
            <div className="mb-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-4 text-sm text-white/75">
              Ada kendala teknis dan admin sedang memeriksa. Tidak perlu order ulang — kami kabari lewat email.
            </div>
          )}
          <ProgressRing percent={data.status === "completed" ? 100 : data.percent} done={data.done} total={data.quantity} />
          <p className="mt-2 text-center text-[13px] text-white/55">
            {data.eta_finish ? `Perkiraan selesai: ${data.eta_finish}` : ""}
            {data.refill_days > 0 && <span className="block">Garansi berlaku {data.refill_days} hari</span>}
          </p>
          <div className="mt-4">
            <OrderTimeline steps={[
              { label: "Dibayar", done: true },
              { label: "Dikirim", done: !["awaiting_payment", "paid", "queued"].includes(data.status) },
              { label: "Selesai", done: ["completed", "partial"].includes(data.status), active: data.status === "in_progress" },
            ]} />
          </div>
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
        </div>
      )}

      <div className="mt-6 flex justify-center gap-4 text-sm">
        <a href={`${SITE.webUrl}/wa?pesan=${encodeURIComponent(`Halo, saya ingin menanyakan pesanan Pedia ${data.code}`)}`} className="text-[#00E5FF]">WA Admin</a>
        <a href="/pedia/lacak" className="text-[#00E5FF]">Lacak lain</a>
      </div>
    </div>
    </div>
  );
}
