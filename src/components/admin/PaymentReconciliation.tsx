"use client";

import { useCallback, useEffect, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/ui/IosIcon";
import { useToast } from "@/components/ui/Toast";

type EventRow = { id: number; amount: number; sender_name?: string; status: "received" | "matched" | "ignored" | "failed"; order_code?: string; last_error?: string; created_at: string; processed_at?: string };
type EventsData = { events?: EventRow[]; counts?: Record<string, number>; pagination?: { page: number; pages: number; total: number }; last_event_at?: string | null; health?: { enabled: boolean; payload_configured: boolean; webhook_configured: boolean; webhook_url: string; secret_header: string; mode: string }; error?: string };

export function PaymentReconciliation() {
  const toast = useToast();
  const initial = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("event_status");
  const [status, setStatus] = useState(initial || "attention");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EventsData>({});
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/payments/events?status=${encodeURIComponent(status)}&page=${page}&limit=12`, { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as EventsData;
      if (!response.ok) throw new Error(body.error || "Gagal memuat event QRIS");
      setData(body);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Gagal memuat event QRIS"); }
    finally { setLoading(false); }
  }, [page, status, toast]);
  useEffect(() => { void load(); }, [load]);

  const retry = async (eventId: number) => {
    setRetrying(eventId);
    try {
      const response = await fetch("/api/admin/payments/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "retry_match", event_id: eventId }) });
      const body = await response.json().catch(() => ({})) as { error?: string; order_code?: string };
      if (!response.ok) throw new Error(body.error === "no_active_exact_amount" ? "Belum ada invoice aktif dengan nominal yang sama." : body.error || "Pencocokan ulang gagal");
      toast.success(`Pembayaran cocok dengan ${body.order_code}.`); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Pencocokan ulang gagal"); }
    finally { setRetrying(null); }
  };
  const healthOk = Boolean(data.health?.enabled && data.health.payload_configured && data.health.webhook_configured);
  const attention = Number(data.counts?.received || 0) + Number(data.counts?.ignored || 0) + Number(data.counts?.failed || 0);
  const copyWebhookUrl = async () => {
    if (!data.health?.webhook_url) return;
    await navigator.clipboard.writeText(data.health.webhook_url);
    toast.success("URL webhook disalin.");
  };

  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-3"><HealthCard title="QRIS dinamis" value={healthOk ? "Siap" : "Belum lengkap"} ok={healthOk} /><HealthCard title="Event terakhir" value={data.last_event_at ? formatDate(data.last_event_at) : "Belum ada"} ok={Boolean(data.last_event_at)} /><HealthCard title="Perlu dicek" value={String(attention)} ok={attention === 0} /></div>
    {data.health && <section className="rounded-[20px] border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-white">Setup aplikasi QRIS Hook</h3><p className="mt-1 text-xs leading-5 text-white/50">Aktifkan Notification Access, pilih merchant DANA, matikan Debug Mode, lalu isi URL dan <strong className="text-white/70">nilai rahasia sebenarnya</strong> yang tersimpan sebagai Pages Secret <span className="font-mono text-white/70">DANA_WEBHOOK_SECRET</span>.</p></div>
        <button type="button" onClick={() => void copyWebhookUrl()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8]"><IosIcon name="copy" size={13} tint="black" /> Salin URL</button>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 rounded-xl border border-white/10 bg-black/15 p-3"><dt className="text-[10px] uppercase tracking-wide text-white/35">Webhook URL</dt><dd className="mt-1 break-all font-mono text-xs text-[#5cefff]">{data.health.webhook_url}</dd></div>
        <div className="rounded-xl border border-white/10 bg-black/15 p-3"><dt className="text-[10px] uppercase tracking-wide text-white/35">Header secret</dt><dd className="mt-1 font-mono text-xs text-white/70">{data.health.secret_header}</dd></div>
      </dl>
      <p className="mt-3 rounded-xl border border-[#FFB800]/20 bg-[#FFB800]/[0.06] px-3 py-2 text-[11px] leading-5 text-[#FFD66B]">Jangan ketik teks <span className="font-mono">DANA_WEBHOOK_SECRET</span> pada kolom Optional secret; itu hanya nama variabel, bukan nilainya.</p>
      <p className="mt-3 text-[11px] leading-5 text-white/40">Setelah disimpan, tekan <strong className="text-white/60">Retry pending</strong> di aplikasi. Status berhasil harus <strong className="text-emerald-300/80">Sent / HTTP 2xx</strong>; transaksi muncul di tabel rekonsiliasi ini.</p>
    </section>}
    <section className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.035]">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4"><div className="min-w-0"><h3 className="text-sm font-semibold text-white">Rekonsiliasi QRIS Hook</h3><p className="mt-0.5 text-[11px] text-white/40">Jejak aman tanpa payload mentah atau secret server.</p></div><button onClick={() => void load()} disabled={loading} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/60 transition hover:bg-white/5 hover:text-white"><IosIcon name="refresh" size={13} tint="white" /> Muat ulang</button><div className="flex w-full flex-wrap gap-2">{[["attention", "Perlu dicek"], ["all", "Semua"], ["matched", "Cocok"], ["failed", "Gagal"]].map(([value, label]) => <button key={value} onClick={() => { setStatus(value); setPage(1); }} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${status === value ? "bg-[#00E5FF] text-[#07101f]" : "bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white"}`}>{label}</button>)}</div></header>
      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-white/45"><Spinner size={20} /> Memuat event…</div> : !data.events?.length ? <p className="p-10 text-center text-sm text-white/40">Tidak ada event pada filter ini.</p> : <div className="divide-y divide-white/[0.06]">{data.events.map((event) => <article key={event.id} className="grid gap-3 p-4 transition hover:bg-white/[0.02] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><EventBadge status={event.status} /><span className="font-semibold text-white">{formatRupiah(event.amount)}</span><span className="text-xs text-white/40">{event.sender_name || "Pengirim tidak terbaca"}</span></div><p className="mt-2 text-xs text-white/45">{formatDate(event.created_at)}{event.order_code ? ` · ${event.order_code}` : ""}</p>{event.last_error && <p className="mt-1 font-mono text-[10px] text-red-300/70">{event.last_error}</p>}</div>{["received", "ignored", "failed"].includes(event.status) && <button onClick={() => void retry(event.id)} disabled={retrying === event.id} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">{retrying === event.id ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="black" />}{retrying === event.id ? "Mencocokkan…" : "Coba cocokkan"}</button>}</article>)}</div>}
      <footer className="flex items-center justify-between border-t border-white/10 p-3 text-xs text-white/40"><span>Hal {data.pagination?.page || 1} dari {data.pagination?.pages || 1}</span><div className="flex gap-2"><button disabled={(data.pagination?.page || 1) <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-8 rounded-full border border-white/10 px-3 transition hover:bg-white/5 disabled:opacity-30">Sebelumnya</button><button disabled={(data.pagination?.page || 1) >= (data.pagination?.pages || 1)} onClick={() => setPage((value) => value + 1)} className="h-8 rounded-full border border-white/10 px-3 transition hover:bg-white/5 disabled:opacity-30">Berikutnya</button></div></footer>
    </section>
  </div>;
}

function HealthCard({ title, value, ok }: { title: string; value: string; ok: boolean }) { return <div className={`rounded-2xl border p-4 ${ok ? "border-emerald-400/15 bg-emerald-400/[0.06]" : "border-red-400/15 bg-red-500/[0.06]"}`}><p className="text-[11px] uppercase tracking-wide text-white/40">{title}</p><p className={`mt-1 text-sm font-semibold tabular-nums ${ok ? "text-emerald-300" : "text-red-300"}`}>{value}</p></div>; }
function EventBadge({ status }: { status: EventRow["status"] }) {
  const label = status === "matched" ? "Cocok" : status === "ignored" ? "Tidak cocok" : status === "received" ? "Diterima" : "Gagal";
  const tone =
    status === "matched"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-300"
      : status === "failed"
        ? "border-red-400/25 bg-red-500/10 text-red-300"
        : "border-[#FFB800]/25 bg-[#FFB800]/10 text-[#FFCF55]";
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase ${tone}`}>{label}</span>;
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date); }
