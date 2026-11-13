"use client";
import { Badge, Button, Checkbox, Input, Label, Textarea, Card, Table, TableHeader, TableHead, TableBody, TableRow, TableCell, Skeleton } from "@/components/admin/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { Spinner } from "@/components/ui/Loading";
import { IosIcon } from "@/components/admin/AdminIcon";
import { useToast } from "@/components/ui/Toast";

type QrisProvider = "dana" | "gopay" | "klikqris";
type ProviderHealth = { enabled: boolean; payload_configured: boolean; webhook_configured: boolean; webhook_url: string; secret_header: string; last_event_at?: string | null };
type EventRow = { id: number; provider?: QrisProvider; amount: number; sender_name?: string; status: "received" | "matched" | "ignored" | "failed"; order_code?: string; last_error?: string; created_at: string; processed_at?: string };
type EventsData = { events?: EventRow[]; counts?: Record<string, number>; pagination?: { page: number; pages: number; total: number }; last_event_at?: string | null; health?: ProviderHealth & { provider?: QrisProvider; providers?: Record<QrisProvider, ProviderHealth>; mode: string }; error?: string };

export function PaymentReconciliation() {
  const toast = useToast();
  const initial = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("event_status");
  const [status, setStatus] = useState(initial || "attention");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EventsData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState<number | null>(null);

  // Generation/abort guard (paritas OrdersManager): ganti filter/page cepat
  // tidak boleh membiarkan respons basi menimpa data/loading milik request
  // terbaru; unmount membatalkan fetch yang masih berjalan.
  const loadRequest = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/payments/events?status=${encodeURIComponent(status)}&page=${page}&limit=12`, { cache: "no-store", signal });
      const body = await response.json().catch(() => ({})) as EventsData;
      if (signal?.aborted || request !== loadRequest.current) return;
      if (!response.ok) throw new Error(body.error || "Gagal memuat event QRIS");
      setData(body);
    } catch (cause) {
      if (signal?.aborted || request !== loadRequest.current) return;
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Gagal memuat event QRIS");
    }
    finally { if (request === loadRequest.current) setLoading(false); }
  }, [page, status]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const retry = async (eventId: number, verification?: { order_code: string; review_note: string; verified: boolean }) => {
    if (retrying !== null) return;
    setRetrying(eventId);
    try {
      const response = await fetch("/api/admin/payments/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: verification ? "confirm_match" : "retry_match", event_id: eventId, ...verification }) });
      const body = await response.json().catch(() => ({})) as { error?: string; order_code?: string };
      if (!response.ok) throw new Error(retryErrorMessage(body.error) || "Pencocokan ulang gagal");
      toast.success(`Pembayaran cocok dengan ${body.order_code}.`); await load();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Pencocokan ulang gagal"); }
    finally { setRetrying(null); }
  };
  const healthOk = Boolean(data.health?.enabled && data.health.payload_configured && data.health.webhook_configured);
  const provider = data.health?.provider || "dana";
  const providerLabel = provider === "klikqris" ? "KlikQRIS" : provider === "gopay" ? "GoPay" : "DANA";
  const lastEventAt = data.health?.providers ? data.health.providers[provider]?.last_event_at : data.last_event_at;
  const attention = Number(data.counts?.received || 0) + Number(data.counts?.ignored || 0) + Number(data.counts?.failed || 0);
  const copyWebhookUrl = async () => {
    if (!data.health?.webhook_url) return;
    await navigator.clipboard.writeText(data.health.webhook_url);
    toast.success("URL webhook disalin.");
  };

  return <div className="space-y-6">
    {error && <div role="alert" className="rounded-xl border border-admin-danger/30 p-4 text-sm text-admin-danger">{error}. Status belum diketahui. <Button variant="ghost" type="button" onClick={() => void load()} className="underline">Coba lagi</Button>
</div>}
    <div className="grid gap-3 sm:grid-cols-3">
<HealthCard title={`Konfigurasi QRIS ${providerLabel}`} value={loading || error ? "Belum diketahui" : healthOk ? "Terkonfigurasi" : "Belum lengkap"} ok={!loading && !error && healthOk} />
<HealthCard title={`Event terakhir ${providerLabel}`} value={loading || error ? "Belum diketahui" : lastEventAt ? formatDate(lastEventAt) : "Belum ada"} ok={!loading && !error && Boolean(lastEventAt)} />
<HealthCard title="Perlu dicek" value={loading || error ? "—" : String(attention)} ok={!loading && !error && attention === 0} />
</div>
    {data.health && <Card className="rounded-xl border border-admin-accent/20 bg-admin-primary/[0.05] p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">{provider === "klikqris" ? <>
<h3 className="text-sm font-semibold text-admin-fg">Gateway KlikQRIS</h3>
<p className="mt-1 text-xs leading-5 text-admin-muted">Callback memakai signature tersimpan dan konfirmasi status server. Batas bayar AXVARA tetap 15 menit; pembayaran terlambat diperiksa manual, tanpa pengiriman otomatis. URL callback diberikan per invoice.</p>
</> : provider === "gopay" ? <>
<h3 className="text-sm font-semibold text-admin-fg">Poller GoBiz server (GoPay)</h3>
<p className="mt-1 text-xs leading-5 text-admin-muted">Provider efektif untuk invoice baru: GoPay. Mutasi GoBiz dikirim oleh poller server ke webhook GoPay, bukan aplikasi Android QRIS Hook. Periksa proses poller dan sesi GoBiz di server bila pembayaran belum terdeteksi.</p>
</> : <>
<h3 className="text-sm font-semibold text-admin-fg">Setup aplikasi QRIS Hook</h3>
<p className="mt-1 text-xs leading-5 text-admin-muted">Provider efektif untuk invoice baru: DANA. Aktifkan Notification Access, pilih merchant DANA, matikan Debug Mode, lalu isi URL dan <strong className="text-admin-muted">nilai rahasia sebenarnya</strong> yang tersimpan sebagai Pages Secret <span className="font-mono text-admin-muted">DANA_WEBHOOK_SECRET</span>.</p>
</>}</div>
        <Button variant="default" type="button" onClick={() => void copyWebhookUrl()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-admin-primary px-3.5 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary">
<IosIcon name="copy" size={13} tint="currentColor" /> Salin URL</Button>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 rounded-xl border border-admin-border bg-admin-subtle/15 p-3">
<dt className="text-xs uppercase tracking-wide text-admin-muted">Webhook URL</dt>
<dd className="mt-1 break-all font-mono text-xs text-admin-accent">{data.health.webhook_url}</dd>
</div>
        <div className="rounded-xl border border-admin-border bg-admin-subtle/15 p-3">
<dt className="text-xs uppercase tracking-wide text-admin-muted">Header secret</dt>
<dd className="mt-1 font-mono text-xs text-admin-muted">{data.health.secret_header}</dd>
</div>
      </dl>
      {provider === "dana" && <>
<p className="mt-3 rounded-xl border border-admin-warning/20 bg-admin-warning/[0.06] px-3 py-2 text-xs leading-5 text-admin-warning">Jangan ketik teks <span className="font-mono">DANA_WEBHOOK_SECRET</span> pada kolom Optional secret; itu hanya nama variabel, bukan nilainya.</p>
      <p className="mt-3 text-xs leading-5 text-admin-muted">Setelah disimpan, tekan <strong className="text-admin-muted">Retry pending</strong> di aplikasi. Status berhasil harus <strong className="text-admin-success">Sent / HTTP 2xx</strong>; transaksi muncul di tabel rekonsiliasi ini.</p>
</>}
      <p className="mt-3 text-xs leading-5 text-admin-muted">Status konfigurasi hanya menunjukkan flag dan secret terisi, bukan kesehatan poller, sesi GoBiz, atau penerimaan notifikasi. Invoice lama tetap mengikuti provider saat diterbitkan; verifikasi mutasi pada merchant invoice tersebut.</p>
    </Card>}
    <Card className="overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-center gap-3 border-b border-admin-border p-4">
<div className="min-w-0">
<h3 className="text-sm font-semibold text-admin-fg">Rekonsiliasi QRIS</h3>
<p className="mt-0.5 text-xs text-admin-muted">Jejak aman tanpa payload mentah atau secret server.</p>
</div>
<Button variant="outline" type="button" onClick={() => void load()} disabled={loading} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border border-admin-border px-3 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg">
<IosIcon name="refresh" size={13} tint="currentColor" /> Muat ulang</Button>
<div className="flex w-full flex-wrap gap-2">{[["attention", "Perlu dicek"], ["all", "Semua"], ["matched", "Cocok"], ["failed", "Gagal"]].map(([value, label]) => <Button variant="default" size="sm" type="button" key={value} onClick={() => { setStatus(value); setPage(1); }} className={`h-8 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition ${status === value ? "bg-admin-primary text-admin-inverse" : "bg-admin-subtle text-admin-muted hover:bg-admin-subtle hover:text-admin-fg"}`}>{label}</Button>)}</div>
</header>
      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-admin-muted">
<div className="w-full space-y-4 p-6">
<Skeleton className="h-16 w-full" />
<Skeleton className="h-16 w-full" />
<span className="sr-only">Memuat event…</span>
</div>
</div> : error ? <p className="p-6 text-sm text-admin-muted">Data belum tersedia. Muat ulang untuk mencoba lagi.</p> : !data.events?.length ? <p className="p-10 text-center text-sm text-admin-muted">Tidak ada event pada filter ini.</p> : <Table className="block md:table">
<TableHeader className="hidden md:table-header-group">
<TableRow>
<TableHead>Event pembayaran</TableHead>
<TableHead>Tindakan</TableHead>
</TableRow>
</TableHeader>
<TableBody className="block md:table-row-group">{data.events.map((event) => <TableRow key={event.id} className="block md:table-row">
<TableCell className="block align-top md:table-cell">
<div className="min-w-0">
<div className="flex flex-wrap items-center gap-2">
<EventBadge status={event.status} />
<span className="text-xs font-semibold text-admin-accent">{event.provider === "klikqris" ? "KlikQRIS" : event.provider === "gopay" ? "GoPay" : "DANA"}</span>
<span className="font-semibold text-admin-fg">{formatRupiah(event.amount)}</span>
<span className="text-xs text-admin-muted">{event.sender_name || "Pengirim tidak terbaca"}</span>
</div>
<p className="mt-2 text-xs text-admin-muted">{formatDate(event.created_at)}{event.order_code ? ` · ${event.order_code}` : ""}</p>{event.last_error && <p className="mt-1 font-mono text-xs text-admin-danger">{event.last_error}</p>}</div>
</TableCell>
<TableCell className="block space-y-3 align-top md:table-cell">{["received", "ignored", "failed"].includes(event.status) && event.provider !== "klikqris" && <Button variant="default" type="button" onClick={() => void retry(event.id)} disabled={retrying === event.id} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-admin-primary px-3.5 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary disabled:opacity-40">{retrying === event.id ? <Spinner size={13} /> : <IosIcon name="refresh" size={13} tint="currentColor" />}{retrying === event.id ? "Mencocokkan…" : "Coba cocokkan"}</Button>}{["received", "ignored", "failed"].includes(event.status) && event.provider !== "klikqris" && <ManualPaymentReview provider={event.provider || "dana"} disabled={retrying === event.id} onConfirm={values => void retry(event.id, values)} />}{event.provider === "klikqris" && event.status === "failed" && <p className="text-xs text-admin-muted">Pembayaran terkonfirmasi KlikQRIS. Periksa status pesanan dan stok sebelum penyelesaian manual.</p>}</TableCell>
</TableRow>)}</TableBody>
</Table>}
      <footer className="flex items-center justify-between border-t border-admin-border p-3 text-xs text-admin-muted">
<span>Hal {data.pagination?.page || 1} dari {data.pagination?.pages || 1}</span>
<div className="flex gap-2">
<Button variant="outline" size="sm" type="button" disabled={(data.pagination?.page || 1) <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-8 rounded-md border border-admin-border px-3 transition hover:bg-admin-subtle disabled:opacity-30">Sebelumnya</Button>
<Button variant="outline" size="sm" type="button" disabled={(data.pagination?.page || 1) >= (data.pagination?.pages || 1)} onClick={() => setPage((value) => value + 1)} className="h-8 rounded-md border border-admin-border px-3 transition hover:bg-admin-subtle disabled:opacity-30">Berikutnya</Button>
</div>
</footer>
    </Card>
  </div>;
}

function HealthCard({ title, value, ok }: { title: string; value: string; ok: boolean }) { return <Card className={`rounded-xl border p-4 ${ok ? "border-admin-success/15 bg-admin-success/[0.06]" : "border-admin-danger/15 bg-admin-danger/[0.06]"}`}>
<p className="text-xs uppercase tracking-wide text-admin-muted">{title}</p>
<p className={`mt-1 text-sm font-semibold tabular-nums ${ok ? "text-admin-success" : "text-admin-danger"}`}>{value}</p>
</Card>; }
function EventBadge({ status }: { status: EventRow["status"] }) {
  const label = status === "matched" ? "Cocok" : status === "ignored" ? "Tidak cocok" : status === "received" ? "Diterima" : "Gagal";
  const tone =
    status === "matched"
      ? "border-admin-success/25 bg-admin-success/10 text-admin-success"
      : status === "failed"
        ? "border-admin-danger/25 bg-admin-danger/10 text-admin-danger"
        : "border-admin-warning/25 bg-admin-warning/10 text-admin-warning";
  return <Badge variant="outline" className={`inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-xs font-semibold uppercase ${tone}`}>{label}</Badge>;
}
// Sama seperti OrdersManager: timestamp D1 berformat spasi adalah UTC.
function formatDate(value: string) { return formatWibDateTime(value) ?? value; }

function retryErrorMessage(code?: string) {
  switch (code) {
    case "amount_reused_requires_review":
      return "Nominal ini pernah digunakan pesanan lain. Periksa mutasi, lalu gunakan Verifikasi manual.";
    case "manual_verification_required":
      return "Isi kode pesanan, catatan pemeriksaan, dan konfirmasi mutasi sebelum melunasi.";
    case "no_active_exact_amount":
      return "Belum ada invoice aktif dengan nominal yang sama.";
    case "multiple_active_exact_amount":
      return "Ada lebih dari satu invoice aktif dengan nominal sama — selesaikan manual agar tidak salah pasang.";
    case "event_predates_invoice":
      return "Event ini tercatat SEBELUM invoice aktif dibuat, jadi tidak bisa menjadi pembayarnya. Cek mutasi merchant sesuai invoice secara manual.";
    default:
      return code;
  }
}

function ManualPaymentReview({ provider, disabled, onConfirm }: {
  provider: QrisProvider;
  disabled: boolean;
  onConfirm: (verification: { order_code: string; review_note: string; verified: boolean }) => void;
}) {
  return <details className="sm:col-span-2 rounded-xl border border-admin-border p-3 text-xs text-admin-muted">
    <summary className="cursor-pointer font-semibold">Verifikasi manual</summary>
    <form className="mt-3 grid gap-3" onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      const values = new FormData(event.currentTarget);
      onConfirm({ order_code: String(values.get("order_code") || "").trim(), review_note: String(values.get("review_note") || "").trim(), verified: values.get("verified") === "on" });
    }}>
      <p>Cocokkan mutasi merchant {provider === "klikqris" ? "KlikQRIS" : provider === "gopay" ? "GoPay" : "DANA"} dengan invoice pesanan. Tindakan ini melunasi pesanan yang dipilih.</p>
      <Label className="grid gap-1">Kode pesanan<Input required name="order_code" maxLength={100} className="rounded-lg border border-admin-border bg-admin-subtle/20 p-2 text-admin-fg" />
</Label>
      <Label className="grid gap-1">Catatan pemeriksaan<Textarea required name="review_note" minLength={10} maxLength={500} className="rounded-lg border border-admin-border bg-admin-subtle/20 p-2 text-admin-fg" placeholder="Referensi mutasi dan alasan pembayaran milik pesanan ini" />
</Label>
      <Label className="flex items-start gap-2">
<Checkbox required  name="verified" />Saya sudah memeriksa mutasi dan memastikan pembayaran ini belum digunakan untuk pesanan lain.</Label>
      <Button variant="default" type="submit" disabled={disabled} className="justify-self-start rounded-xl bg-admin-primary px-4 py-2 font-semibold text-admin-inverse disabled:opacity-40">Konfirmasi pembayaran</Button>
    </form>
  </details>;
}
