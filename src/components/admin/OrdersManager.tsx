"use client";
import { Badge, Button, Card, Input, Label, NativeSelect, Textarea, Table, TableHeader, TableHead, TableBody, TableRow, TableCell, Separator, Skeleton, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Tabs, TabsList, TabsTrigger } from "@/components/admin/ui";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveNameFromEmail, formatRupiah, formatWibDateTime } from "@/lib/utils";
import { pediaStatusLabel } from "@/components/pedia/StatusWidgets";
import { formatCount, knownCount } from "@/components/pedia/status-view";
import { ChannelBadge, IosIcon, MethodBadge, StatusBadge } from "@/components/admin/AdminIcon";
import { Spinner } from "@/components/ui/Loading";
import { Dialog } from "@/components/ui/Dialog";
import { OrderAccessAdmin } from "@/components/admin/OrderAccessAdmin";
import { ProofThumbnail } from "@/components/admin/ProofThumbnail";
import { useToast } from "@/components/ui/Toast";
import { hasActiveSupplierLink, SupplierLinkActions, type SupplierLink } from "@/components/admin/SupplierLinkActions";

type OrderChannel = "web" | "telegram" | "whatsapp";
/** Ringkasan item Pedia dari API admin; `null` = baris item belum terbaca (status tidak diketahui). */
type PediaSummary = { status: string; quantity: number | null; done: number | null; target: string | null; lastError: string | null };
type Order = {
  /** Jenis pesanan dari server (`order_kind`); Pedia tidak memakai alur handover/fulfillment Market. */
  kind: "pedia" | "apps" | "games";
  pedia: PediaSummary | null;
  code: string; name: string; wa: string; email: string; method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number; paymentAmount: number; status: string; paymentStatus: string;
  fulfillmentStatus?: string;
  salesChannel: OrderChannel; fileName?: string; proofId?: number;
  proofStatus?: "submitted" | "approved" | "rejected";
  proofClaimedMethod?: "QRIS" | "SEABANK" | "EWALLET";
  proofRejectionReason?: string; adminNote?: string; createdAt: string;
  /** Link supplier WR/SK order ini (status + Retry/Batal di baris). */
  supplierLinks?: SupplierLink[];
};
type ApiData = {
  orders?: Record<string, unknown>[];
  pagination?: { page: number; limit: number; total: number; pages: number };
  stats?: { total: number; pending: number; paid: number; revenue: number };
  counts?: { channels?: Record<string, number>; statuses?: Record<string, number> };
  methods?: string[];
  error?: string;
};
type ActionState = { kind: "paid" | "paid_qris" | "approve" | "reject" | "cancel" | "handover"; order: Order } | null;

const PER_PAGE = 8;
const BUYER_NOT_NOTIFIED = "Serah terima tercatat, tetapi kabar ke pembeli GAGAL terkirim. Hubungi pembeli secara manual.";
const inputClass = "h-9 w-full rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg outline-none placeholder:text-admin-muted focus:border-admin-accent/40";

export function OrdersManager({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  // URL adalah sumber kebenaran untuk filter awal (deep link kartu Ringkasan,
  // back/forward). Baca sekali saat mount agar navigasi browser tidak
  // menimpa pilihan filter yang sudah diubah pengguna di layar.
  const [initialParams] = useState(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search));
  const initial = initialParams;
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(() => {
    const value = Number(initial.get("page"));
    return Number.isInteger(value) && value >= 1 ? value : 1;
  });
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [channel, setChannel] = useState(initial.get("channel") || "all");
  // AC-22 / PD-44: filter Jenis — Semua / Aplikasi / Pedia.
  const [kind, setKind] = useState(initial.get("kind") || "all");
  const [status, setStatus] = useState(initial.get("status") || "all");
  const [method, setMethod] = useState(initial.get("method") || "all");
  const [proof, setProof] = useState(initial.get("proof") || "");
  const [draftQuery, setDraftQuery] = useState(initial.get("q") || "");
  const [query, setQuery] = useState(initial.get("q") || "");
  const [dateFrom, setDateFrom] = useState(initial.get("date_from") || "");
  const [dateTo, setDateTo] = useState(initial.get("date_to") || "");
  const [stats, setStats] = useState({ total: 0, pending: 0, paid: 0, revenue: 0 });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [methods, setMethods] = useState<string[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [action, setAction] = useState<ActionState>(null);
  const [actionNote, setActionNote] = useState("");
  // Isi "Detail untuk pembeli" per item_index (dialog Kirim ke pembeli).
  const [handoverMessages, setHandoverMessages] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const requestParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
    if (channel !== "all") params.set("channel", channel);
    if (kind !== "all") params.set("kind", kind);
    if (status !== "all") params.set("status", status);
    if (method !== "all") params.set("method", method);
    if (proof) params.set("proof", proof);
    if (query) params.set("q", query);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return params;
  }, [channel, kind, status, method, proof, query, dateFrom, dateTo, page]);

  // Generation/abort guard: setiap load punya nomor urut; respons basi
  // (filter diganti cepat, tab ditutup, unmount) tidak boleh menimpa state,
  // loading, atau error milik request terbaru.
  const loadRequest = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const request = ++loadRequest.current;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/orders?${requestParams}`, { cache: "no-store", signal });
      const data = await response.json().catch(() => ({})) as ApiData;
      if (signal?.aborted || request !== loadRequest.current) return;
      if (!response.ok) throw new Error(data.error || "Gagal memuat pesanan");
      setOrders((data.orders || []).map(normalizeOrder));
      setPage(Number(data.pagination?.page || 1));
      setPages(Number(data.pagination?.pages || 1));
      setTotal(Number(data.pagination?.total || 0));
      setStats(data.stats || { total: 0, pending: 0, paid: 0, revenue: 0 });
      setCounts(data.counts?.channels || {});
      setMethods(data.methods || []);
    } catch (cause) {
      if (signal?.aborted || request !== loadRequest.current) return;
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Gagal memuat pesanan");
    }
    finally { if (request === loadRequest.current) setLoading(false); }
  }, [requestParams]);

  // Setiap requestParams baru membatalkan fetch sebelumnya: tanpa abort,
  // respons filter lama yang tiba belakangan menimpa daftar filter baru
  // (temuan audit: fetch urutan terbalik).
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ["channel", "kind", "status", "method", "proof", "q", "date_from", "date_to", "page"]) url.searchParams.delete(key);
    requestParams.forEach((value, key) => { if (key !== "limit") url.searchParams.set(key, value); });
    history.replaceState(history.state, "", `${url.pathname}?${url.searchParams}`);
  }, [requestParams]);

  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const clearFilters = () => { setChannel("all"); setKind("all"); setStatus("all"); setMethod("all"); setProof(""); setDraftQuery(""); setQuery(""); setDateFrom(""); setDateTo(""); setPage(1); };
  // Filter yang tidak punya kontrol sendiri di layar (terutama `proof`, yang
  // datang dari kartu "Bukti manual" di Ringkasan) sebelumnya menyaring daftar
  // secara diam-diam: semua dropdown menampilkan "Semua" sementara hasilnya
  // tersaring, sehingga pesanan terlihat hilang. Chip ini membuat setiap
  // filter aktif terlihat dan bisa dilepas satu per satu.
  const activeFilters: { label: string; clear: () => void }[] = [];
  if (proof === "submitted") activeFilters.push({ label: "Bukti manual menunggu", clear: () => changeFilter(setProof, "") });
  if (channel !== "all") activeFilters.push({ label: `Kanal: ${channel}`, clear: () => changeFilter(setChannel, "all") });
  if (kind !== "all") activeFilters.push({ label: `Jenis: ${kind === "pedia" ? "Pedia" : kind === "games" ? "Games" : "Aplikasi"}`, clear: () => changeFilter(setKind, "all") });
  if (status !== "all") activeFilters.push({ label: `Status: ${status}`, clear: () => changeFilter(setStatus, "all") });
  if (method !== "all") activeFilters.push({ label: `Pembayaran: ${method}`, clear: () => changeFilter(setMethod, "all") });
  if (query) activeFilters.push({ label: `Cari: ${query}`, clear: () => { setDraftQuery(""); setQuery(""); setPage(1); } });
  if (dateFrom) activeFilters.push({ label: `Dari: ${dateFrom}`, clear: () => { setDateFrom(""); setPage(1); } });
  if (dateTo) activeFilters.push({ label: `Sampai: ${dateTo}`, clear: () => { setDateTo(""); setPage(1); } });
  const hasActiveFilters = activeFilters.length > 0;
  const exportHref = `/api/admin/orders?${new URLSearchParams([...requestParams.entries()].filter(([key]) => !["page", "limit"].includes(key)).concat([["export", "csv"]])).toString()}`;

  const runAction = async () => {
    if (!action) return;
    if (action.kind === "reject" && !actionNote.trim()) { toast.error("Alasan penolakan wajib diisi."); return; }
    // ACC QRIS manual: catatan verifikasi mutasi wajib (min. 10 karakter,
    // cermin validasi server) — tanpa ini admin bisa ACC tanpa bukti cek.
    if (action.kind === "paid_qris" && actionNote.trim().length < 10) { toast.error("Tulis hasil cek mutasi merchant sesuai invoice (min. 10 karakter)."); return; }
    setSaving(true);
    try {
      if (action.kind === "paid_qris") {
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(action.order.code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "lunas", action: "paid_qris", admin_note: actionNote.trim() }) });
        const data = await response.json().catch(() => ({})) as { error?: string; via?: string };
        if (!response.ok) throw new Error(data.error || "ACC QRIS gagal");
         toast.success("Pembayaran dikonfirmasi; pengiriman diproses. Periksa status fulfillment untuk hasilnya.");
      } else if (action.kind === "approve" || action.kind === "reject") {
        if (!action.order.proofId) throw new Error("Bukti pembayaran belum tersedia.");
        const response = await fetch(`/api/admin/proofs/${action.order.proofId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action.kind, reason: actionNote.trim() || undefined }) });
        const data = await response.json().catch(() => ({})) as { error?: string; payment_updated?: boolean };
        if (!response.ok) throw new Error(data.error || "Review bukti gagal");
        // Screenshot QRIS = bukti pendukung saja; QRIS Hook tetap otoritatif,
        // jadi server sengaja membalas `payment_updated:false` dan order TETAP
        // pending. Toast "dikonfirmasi lunas" di kasus itu adalah kabar palsu
        // yang bisa membuat barang dikirim sebelum uang masuk.
        toast.success(
          action.kind === "reject" ? "Bukti ditolak."
            : data.payment_updated === false
              ? "Bukti disetujui sebagai referensi. Status lunas tetap menunggu QRIS Hook."
              : "Mutasi cocok dan pesanan dikonfirmasi lunas.",
        );
      } else if (action.kind === "handover") {
        if (action.order.kind !== "apps") throw new Error("Pesanan ini diproses otomatis dan tidak memakai serah terima Market.");
        const items = await fetchHandoverItems(action.order.code);
        if (!items.length) throw new Error("Item serah terima belum tersedia.");
        const pending = items.filter((item) => item.status !== "delivered");
        // RR4-03: item delivered SEMUA tetapi order masih manual_required =
        // agregat tertinggal (penulisan lanjutan gagal). JANGAN toast sukses
        // palsu — panggil pemulihan server (POST item 0 memicu reconcile
        // idempoten) lalu muat ulang status yang dikonfirmasi server.
        if (!pending.length) {
          const response = await fetch(`/api/admin/orders/${encodeURIComponent(action.order.code)}/handover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_index: items[0]?.item_index ?? 0, note: actionNote.trim() || undefined, buyer_message: handoverMessages[items[0]?.item_index ?? 0]?.trim() || undefined }) });
          const data = await response.json().catch(() => ({})) as { error?: string; message?: string; fulfillment_status?: string; complete?: boolean; buyer_notified?: boolean | null };
          if (!response.ok) throw new Error(data.message || data.error || `Pemulihan gagal (HTTP ${response.status})`);
          if (data.fulfillment_status !== "delivered" || data.complete === false) throw new Error("Serah terima belum lengkap. Periksa rincian dan jumlah barang sebelum menyelesaikan pesanan.");
          toast.success("Status serah terima dipulihkan dari server.");
          if (data.buyer_notified === false) toast.error(BUYER_NOT_NOTIFIED);
        } else {
          // RR3-02/07: handover bisa mengembalikan 409 handover_incomplete
          // (manifest belum lengkap) atau 500 parsial. Item yang TERCATAT
          // tidak diserahkan ulang — lanjut ke item berikutnya, kumpulkan
          // hasil per item, dan laporkan jujur di akhir (bukan gagal total
          // pada item pertama). Klik ulang aman (idempoten + reconcile).
          const failures: string[] = [];
          let recorded = 0;
          let confirmedComplete = false;
          let buyerNotified: boolean | null | undefined;
          for (const item of pending) {
            const response = await fetch(`/api/admin/orders/${encodeURIComponent(action.order.code)}/handover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_index: item.item_index, note: actionNote.trim() || undefined, buyer_message: handoverMessages[item.item_index]?.trim() || undefined }) });
            const data = await response.json().catch(() => ({})) as { error?: string; message?: string; missing_item_indexes?: number[]; fulfillment_status?: string; complete?: boolean; buyer_notified?: boolean | null };
            if (!response.ok) {
              failures.push(`item ${item.item_index}: ${data.message || data.error || `HTTP ${response.status}`}${Array.isArray(data.missing_item_indexes) && data.missing_item_indexes.length ? ` (baris hilang: ${data.missing_item_indexes.join(", ")})` : ""}`);
            } else {
              recorded++;
              confirmedComplete = data.fulfillment_status === "delivered" && data.complete !== false;
              if (typeof data.buyer_notified === "boolean") buyerNotified = data.buyer_notified;
            }
          }
          if (!failures.length && !confirmedComplete) throw new Error("Penyerahan item tercatat, tetapi pesanan belum lengkap. Periksa rincian dan jumlah barang.");
          if (!failures.length) toast.success(recorded > 1 ? `${recorded} item terkirim ke pembeli.` : "Terkirim ke pembeli.");
          else if (recorded > 0) toast.error(`${recorded} item tercatat, ${failures.length} gagal: ${failures.join("; ")}`);
          else throw new Error(failures.join("; "));
          if (buyerNotified === false) toast.error(BUYER_NOT_NOTIFIED);
        }
      } else {
        const nextStatus = action.kind === "paid" ? "lunas" : "dibatalkan";
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(action.order.code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus, admin_note: actionNote.trim() || undefined }) });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Gagal memperbarui pesanan");
        toast.success(action.kind === "paid" ? "Pesanan dikonfirmasi lunas." : "Pesanan dibatalkan.");
      }
      setAction(null); setActionNote(""); setHandoverMessages({}); setSelected(null);
      await load(); onChanged?.();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Tindakan gagal"); }
    finally { setSaving(false); }
  };

  // Tab kanal adalah PEMILIH, jadi angkanya tetap global (berapa pesanan ada
  // di tiap kanal) — bukan hasil filter. `stats` kini mengikuti filter, maka
  // "Semua" dihitung dari counts kanal, bukan stats.total.
  const channelTotal = (counts.web || 0) + (counts.telegram || 0) + (counts.whatsapp || 0);
  const channelTabs = [["all", "Semua", channelTotal, null], ["web", "Web", counts.web || 0, "globe"], ["telegram", "Telegram", counts.telegram || 0, "telegram-app"], ["whatsapp", "WhatsApp", counts.whatsapp || 0, "whatsapp"]] as const;

  return <div className="mt-4 space-y-6">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Total pesanan", stats.total, "text-admin-fg"], ["Pending", stats.pending, "text-admin-warning"], ["Lunas", stats.paid, "text-admin-success"], ["Omzet", formatRupiah(stats.revenue), "text-admin-fg"]].map(([label, value, tone]) => <Card key={String(label)} className="admin-surface rounded-xl p-4">
<p className="text-sm text-admin-muted">{label}</p>
<p className={`mt-1 font-sans text-xl font-semibold tabular-nums sm:text-2xl ${tone}`}>{loading || error ? "—" : value}</p>{hasActiveFilters && <p className="mt-1 text-xs text-admin-accent">hasil filter</p>}</Card>)}
    </div>

    <Card className="admin-surface overflow-hidden rounded-xl">
      <header className="border-b border-admin-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
<div className="min-w-0">
<h2 className="text-xl font-semibold text-admin-fg">Pesanan</h2>
<p className="mt-0.5 text-sm text-admin-muted">Cari, filter, periksa pembayaran, dan proses fulfillment.</p>
</div>
<a href={exportHref} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-admin-border px-3.5 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg">
<IosIcon name="download" size={13} tint="currentColor" /> Export CSV</a>
</div>
        <Tabs value={channel} onValueChange={value => changeFilter(setChannel, value)} className="mt-4">
<TabsList aria-label="Filter kanal pesanan" className="h-auto justify-start">{channelTabs.map(([value, label, count, icon]) => <TabsTrigger key={value} value={value} className="gap-2">{icon ? <IosIcon name={icon} size={13} tint="currentColor" /> : null}{label}<Badge variant="outline" className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${channel === value ? "bg-admin-subtle/15" : "bg-admin-subtle"}`}>{count}</Badge>
</TabsTrigger>)}</TabsList></Tabs>
        <div className="mt-3 grid items-end gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <form onSubmit={(event) => { event.preventDefault(); setQuery(draftQuery.trim()); setPage(1); }}>
<Label className="mb-1 block text-sm font-medium text-admin-muted" htmlFor="order-search">Pencarian</Label>
<div className="relative">
<IosIcon name="search" size={15} tint="currentColor" className="absolute left-3 top-3 opacity-45" />
<Input id="order-search" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} className={`${inputClass} pl-9`} placeholder="Kode, nama, WA, produk…" />
</div>
</form>
          <Label className="block">
<span className="mb-1 block text-sm font-medium text-admin-muted">Status</span>
<NativeSelect value={status} onChange={(event) => changeFilter(setStatus, event.target.value)} className={inputClass}>
<option value="all">Semua status</option>
<option value="pending">Pending</option>
<option value="lunas">Lunas</option>
<option value="dibatalkan">Dibatalkan</option>
<option value="kadaluarsa">Kedaluwarsa</option>
</NativeSelect>
</Label>
          <Label className="block">
<span className="mb-1 block text-sm font-medium text-admin-muted">Jenis</span>
<NativeSelect value={kind} onChange={(event) => changeFilter(setKind, event.target.value)} className={inputClass} aria-label="Filter jenis pesanan">
<option value="all">Semua jenis</option>
<option value="apps">Aplikasi</option>
<option value="pedia">Pedia</option>
<option value="games">Games</option>
</NativeSelect>
</Label>
          <Label className="block">
<span className="mb-1 block text-sm font-medium text-admin-muted">Pembayaran</span>
<NativeSelect value={method} onChange={(event) => changeFilter(setMethod, event.target.value)} className={inputClass}>
<option value="all">Semua pembayaran</option>
<option value="qris">QRIS</option>
<option value="manual">Transfer manual</option>{methods.filter((item) => !["qris"].includes(item)).map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</NativeSelect>
</Label>
          <Label className="block">
<span className="mb-1 block text-sm font-medium text-admin-muted">Dari tanggal</span>
<Input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className={inputClass} />
</Label>
          <Label className="block">
<span className="mb-1 block text-sm font-medium text-admin-muted">Sampai tanggal</span>
<Input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className={inputClass} />
</Label>
          <Button variant="outline" type="button" onClick={clearFilters} className="h-9 whitespace-nowrap rounded-xl border border-admin-border px-3 text-xs font-semibold text-admin-muted hover:bg-admin-subtle">Reset</Button>
        </div>
        {activeFilters.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-admin-muted">Filter aktif</span>
          {activeFilters.map((filter) => <Button variant="outline" size="sm" key={filter.label} type="button" onClick={filter.clear} className="inline-flex h-8 items-center gap-2 rounded-md border border-admin-accent/30 bg-admin-primary/10 px-3 text-xs font-semibold text-admin-accent transition hover:bg-admin-primary/20" aria-label={`Hapus filter ${filter.label}`}>{filter.label}<IosIcon name="close" size={10} tint="currentColor" />
</Button>)}
        </div>}
      </header>

      {error ? <div className="m-4 flex items-center justify-between gap-3 rounded-xl border border-admin-danger/20 bg-admin-danger/10 p-3 text-sm text-admin-danger">
<span>{error}</span>
<Button variant="default" type="button" onClick={() => void load()} className="rounded-lg bg-admin-primary px-3 py-1.5 text-xs font-semibold text-admin-inverse">Coba lagi</Button>
</div> : loading ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-admin-muted">
<div className="w-full space-y-4 p-6">
<Skeleton className="h-16 w-full" />
<Skeleton className="h-16 w-full" />
<span className="sr-only">Memuat pesanan…</span>
</div>
</div> : orders.length === 0 ? <p className="p-10 text-center text-sm text-admin-muted">Tidak ada pesanan yang cocok dengan filter.</p> : <Table className="block md:table">
<TableHeader className="hidden md:table-header-group">
<TableRow>
<TableHead className="w-36">Bukti</TableHead>
<TableHead>Pesanan</TableHead>
<TableHead className="text-right">Tindakan</TableHead>
</TableRow>
</TableHeader>
<TableBody className="block space-y-3 p-3 md:table-row-group md:space-y-0 md:p-0">{orders.map((order) => <OrderRow key={order.code} order={order} onChanged={() => { void load(); onChanged?.(); }} onDetail={() => setSelected(order)} onAction={(kind) => { setAction({ kind, order }); setActionNote(""); }} />)}</TableBody>
</Table>}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3 text-xs text-admin-muted sm:px-5">
<span>Hal {page} dari {pages} · {total} pesanan</span>
<div className="flex gap-2">
<Button variant="outline" size="sm" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="h-8 rounded-md border border-admin-border px-3 transition hover:bg-admin-subtle disabled:opacity-30">Sebelumnya</Button>
<Button variant="outline" size="sm" type="button" disabled={page >= pages || loading} onClick={() => setPage((current) => Math.min(pages, current + 1))} className="h-8 rounded-md border border-admin-border px-3 transition hover:bg-admin-subtle disabled:opacity-30">Berikutnya</Button>
</div>
</footer>
    </Card>

    {selected && <OrderDetail order={selected} onChanged={() => { setSelected(null); void load(); onChanged?.(); }} onClose={() => setSelected(null)} onAction={(kind) => { setSelected(null); setAction({ kind, order: selected }); setActionNote(""); setHandoverMessages({}); }} />}
    {action && action.kind === "handover"
      ? <HandoverDialog order={action.order} note={actionNote} setNote={setActionNote} messages={handoverMessages} setMessages={setHandoverMessages} saving={saving} onClose={() => !saving && setAction(null)} onConfirm={() => void runAction()} />
      : action && <ActionDialog action={action} note={actionNote} setNote={setActionNote} saving={saving} onClose={() => !saving && setAction(null)} onConfirm={() => void runAction()} />}
  </div>;
}

function hasHandoverItems(order:Order):boolean {
  return order.items.some((_,index)=>!order.supplierLinks?.some(link=>link.supplier==="tunvn" && !link.purchase_disabled && link.item_index===index));
}

function OrderRow({ order, onDetail, onAction, onChanged }: { order: Order; onDetail: () => void; onAction: (kind: NonNullable<ActionState>["kind"]) => void; onChanged: () => void }) {
  const qris = order.method.toLowerCase() === "qris";
  // `failed` WAJIB masuk (2026-09-22): itulah status yang ditulis saat order WR
  // kehabisan attempt (warung-rebahan/order.ts) ATAU saat delivery kredensial
  // habis 5 percobaan (deliver.ts). API handover menerimanya
  // (`["manual_required","retry","queued","failed"]`), tetapi tanpa baris ini
  // tombolnya tidak pernah dirender — order gagal hilang dari jangkauan admin
  // dan hanya bisa dipulihkan lewat operasi DB.
  const isPedia = order.kind === "pedia";
  const isMarket = order.kind === "apps";
  const providerPayment = /^(nowpayments|sekalipay_gateway):/i.test(order.method);
  const needsHandover = isMarket && order.status === "lunas"
    && hasHandoverItems(order) && ["manual_required", "retry", "failed"].includes(String(order.fulfillmentStatus ?? ""));
  return <TableRow className="block rounded-md border border-admin-border bg-admin-card md:table-row md:rounded-none md:border-x-0 md:border-t-0">
<TableCell className="block align-top md:table-cell md:w-32">
    {providerPayment ? <Badge variant="secondary" title="Pembayaran diverifikasi provider otomatis; tanpa bukti transfer manual.">Otomatis provider<span className="sr-only">. Tanpa bukti transfer manual.</span></Badge> : qris && !order.fileName ? <Badge variant="success" title="Tidak perlu bukti. Menunggu QRIS Hook.">QRIS otomatis<span className="sr-only">. Tidak perlu bukti, menunggu QRIS Hook.</span></Badge> : <ProofThumbnail proof={order.fileName} />}</TableCell>
    <TableCell className="block min-w-0 align-top md:table-cell">
<div className="min-w-0">
<div className="flex flex-wrap items-center gap-2">
<Button variant="link" type="button" onClick={onDetail} className="h-auto justify-start p-0 font-mono text-xs font-semibold text-admin-accent hover:underline">{order.code}</Button>
<StatusBadge status={order.status} />
<ChannelBadge channel={order.salesChannel} />
<MethodBadge method={order.method} />{isPedia ? <>
<PediaChip />
<PediaStatusChip order={order} />
</> : <FulfillmentBadge status={order.fulfillmentStatus} supplierActive={hasActiveSupplierLink(order.supplierLinks)} />}</div>
<p className="mt-2 truncate text-sm font-semibold text-admin-fg">{displayName(order)}</p>
<p className="mt-0.5 truncate text-xs text-admin-muted">{order.wa || order.email || "Kontak tidak tersedia"}</p>
<p className="mt-1 line-clamp-2 text-xs leading-5 text-admin-muted">{isPedia ? pediaItemLine(order) : order.items.map((item) => `${item.name} x${item.qty}`).join(", ")} · {formatRupiah(order.paymentAmount)}</p>{qris && order.fileName && <p className="mt-1 text-xs text-admin-success">Bukti hanya referensi; status pembayaran tetap dari QRIS Hook.</p>}{order.proofStatus === "rejected" && <p className="mt-1 text-xs leading-4 text-admin-danger">Bukti ditolak{order.proofRejectionReason ? `: ${order.proofRejectionReason}` : ""}</p>}{order.status === "lunas" && order.supplierLinks?.length ? <SupplierLinkActions links={order.supplierLinks} onChanged={onChanged} compact /> : null}</div>
</TableCell>
    <TableCell className="block align-top md:table-cell md:w-64">
<div className="flex flex-wrap gap-2 md:max-w-64 md:justify-end">
<Button variant="outline" type="button" onClick={onDetail} className="inline-flex h-9 items-center rounded-md border border-admin-border bg-admin-subtle px-3 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg">Detail</Button>{isPedia && order.status === "pending" && <PediaAwaitingPayment />}{(!isMarket || providerPayment) && order.status === "pending" && !isPedia && <span className="text-xs text-admin-muted">Menunggu verifikasi provider</span>}{order.kind === "games" && <span className="text-xs font-semibold text-admin-accent">Games · pemrosesan otomatis</span>}{isMarket && !providerPayment && order.status === "pending" && <>{qris ? <>
<Button variant="outline" type="button" onClick={() => onAction("paid_qris")} title="Dana benar masuk (cek mutasi manual) — lunaskan + kirim kredensial seperti hook normal" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-admin-primary px-3.5 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary/90">
<IosIcon name="checked" size={12} tint="currentColor" /> ACC pembayaran</Button>

</> : order.salesChannel === "whatsapp" ? order.proofId && order.proofStatus === "submitted" ? <>
<Button variant="outline" type="button" onClick={() => onAction("approve")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-admin-primary px-3.5 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary/90">
<IosIcon name="checked" size={12} tint="currentColor" /> Mutasi cocok</Button>

</> : <span className="inline-flex h-9 items-center rounded-md border border-admin-border px-3 text-xs text-admin-muted">Menunggu bukti</span> : <Button variant="outline" type="button" onClick={() => onAction("paid")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-admin-primary px-3.5 text-xs font-semibold text-admin-inverse transition hover:bg-admin-primary/90">
<IosIcon name="checked" size={12} tint="currentColor" /> Konfirmasi lunas</Button>}</>}{isMarket && !providerPayment && order.status === "pending" && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label={`Tindakan lain ${order.code}`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{!qris && order.salesChannel === "whatsapp" && order.proofId && order.proofStatus === "submitted" && <DropdownMenuItem className="text-admin-danger" onSelect={() => onAction("reject")}>Tolak bukti</DropdownMenuItem>}<DropdownMenuItem className="text-admin-danger" onSelect={() => onAction("cancel")}>Batalkan pesanan</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}{needsHandover && <Button variant="default" type="button" onClick={() => onAction("handover")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-admin-primary px-3.5 text-xs font-semibold text-admin-inverse transition hover:brightness-110">
<IosIcon name="checked" size={12} tint="currentColor" /> Kirim ke pembeli</Button>}{isPedia && <PediaFollowUpLink order={order} />}</div>
  </TableCell>
</TableRow>;
}

function OrderDetail({ order, onClose, onAction, onChanged }: { order: Order; onClose: () => void; onAction: (kind: NonNullable<ActionState>["kind"]) => void; onChanged: () => void }) {
  const [buyerInputs,setBuyerInputs] = useState<{ item_index:number;value:string }[]>([]);
  const [inputError,setInputError] = useState(false);
  useEffect(() => { let active=true; setBuyerInputs([]); setInputError(false); if (order.kind === "apps") void fetch(`/api/admin/orders/${encodeURIComponent(order.code)}`,{ cache:"no-store" }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { if (active) setBuyerInputs(data.buyerInputs ?? []); }).catch(() => { if (active) setInputError(true); }); return () => { active=false; }; },[order.code,order.kind]);
  const isPedia = order.kind === "pedia";
  const isMarket = order.kind === "apps";
  const providerPayment = /^(nowpayments|sekalipay_gateway):/i.test(order.method);
  const needsHandover = isMarket && order.status === "lunas"
    && hasHandoverItems(order) && ["manual_required", "retry", "failed"].includes(String(order.fulfillmentStatus ?? ""));
  const qris = order.method.toLowerCase() === "qris";
  return <AdminDialog title="Detail pesanan" onClose={onClose}>
<div className="space-y-4">
<div className="flex flex-wrap items-center gap-2">
<p className="font-mono text-sm font-semibold text-admin-accent">{order.code}</p>
<StatusBadge status={order.status} />
</div>
<div className="mt-2 flex flex-wrap items-center gap-2">
<ChannelBadge channel={order.salesChannel} />
<MethodBadge method={order.method} />{isPedia ? <>
<PediaChip />
<PediaStatusChip order={order} />
</> : <FulfillmentBadge status={order.fulfillmentStatus} supplierActive={hasActiveSupplierLink(order.supplierLinks)} />}<span className="text-xs text-admin-muted">{formatDate(order.createdAt)}</span>
</div>{!isPedia && order.status === "lunas" && order.supplierLinks?.length ? <SupplierLinkActions links={order.supplierLinks} onChanged={onChanged} /> : null}{inputError && <p role="alert" className="text-xs text-admin-danger">Input pembeli gagal dimuat. Tutup dan buka kembali detail.</p>}{buyerInputs.map(input => <Info key={input.item_index} label={`Kode Invite Muse · item ${input.item_index+1}`} value={input.value} />)}<Separator />{isMarket && <OrderAccessAdmin key={order.code} code={order.code} />}<div className="grid grid-cols-2 gap-3 text-sm">
<Info label="Pelanggan" value={isPedia ? displayName(order) : order.name || "—"} />
<Info label="WhatsApp" value={order.wa || "—"} />
<Info label="Email" value={order.email || "—"} />
<Info label="Pembayaran" value={`${order.method.toUpperCase()} · ${formatRupiah(order.paymentAmount)}`} />
</div>
<Separator />
<div className="rounded-md border border-admin-border bg-admin-subtle p-4">
<p className="text-sm font-medium text-admin-muted">Item</p>{isPedia ? <PediaItemBox order={order} /> : order.items.map((item, index) => <div key={`${item.name}-${index}`} className="mt-3 flex justify-between gap-4 text-sm">
<span className="text-admin-muted">{item.name} x{item.qty}</span>
<span className="font-semibold text-admin-fg">{formatRupiah(item.price * item.qty)}</span>
</div>)}</div>{isPedia && <PediaFollowUpLink order={order} />}{qris ? <div className="rounded-xl border border-admin-success/15 bg-admin-success/[0.06] p-3 text-xs leading-5 text-admin-success">QRIS diproses otomatis. Bukti gambar, jika ada, hanya dipakai sebagai referensi.</div> : order.fileName ? <ProofThumbnail proof={order.fileName} /> : null}{order.adminNote && <Info label="Catatan admin" value={order.adminNote} />}{order.proofStatus === "rejected" && <Info label="Bukti ditolak" value={order.proofRejectionReason || "Tanpa alasan tercatat"} />}{needsHandover && <div className="flex flex-wrap justify-end gap-2 border-t border-admin-border pt-4">
<Button variant="default" type="button" onClick={() => onAction("handover")} className="inline-flex h-9 items-center gap-2 rounded-md bg-admin-primary px-5 text-sm font-semibold text-admin-inverse transition hover:brightness-110">
<IosIcon name="checked" size={14} tint="currentColor" /> Kirim ke pembeli</Button>
</div>}{isPedia && order.status === "pending" && <div className="border-t border-admin-border pt-4">
<PediaAwaitingPayment />
</div>}{(!isMarket || providerPayment) && !isPedia && order.status === "pending" && <p className="text-sm text-admin-muted">Menunggu verifikasi provider. Pesanan ini tidak memakai aksi manual Market.</p>}{isMarket && !providerPayment && order.status === "pending" && <div className="flex flex-wrap justify-end gap-2 border-t border-admin-border pt-4">{!qris && (order.salesChannel !== "whatsapp" ? <Button variant="default" type="button" onClick={() => onAction("paid")} className="inline-flex h-9 items-center gap-2 rounded-md bg-admin-primary px-5 text-sm font-semibold text-admin-inverse transition hover:bg-admin-primary/90">
<IosIcon name="checked" size={14} tint="currentColor" /> Konfirmasi lunas</Button> : order.proofStatus === "submitted" && <>
<Button variant="default" type="button" onClick={() => onAction("approve")} className="inline-flex h-9 items-center gap-2 rounded-md bg-admin-primary px-5 text-sm font-semibold text-admin-inverse transition hover:bg-admin-primary/90">
<IosIcon name="checked" size={14} tint="currentColor" /> Mutasi cocok</Button>
<Button variant="outline" type="button" onClick={() => onAction("reject")} className="inline-flex h-9 items-center gap-2 rounded-md border border-admin-danger/25 bg-admin-danger/10 px-5 text-sm font-semibold text-admin-danger transition hover:bg-admin-danger/20">
<IosIcon name="close" size={13} tint="currentColor" /> Tolak bukti</Button>
</>)}<Button variant="outline" type="button" onClick={() => onAction("cancel")} className="inline-flex h-9 items-center gap-2 rounded-md border border-admin-danger/25 bg-admin-danger/10 px-5 text-sm font-semibold text-admin-danger transition hover:bg-admin-danger/20">
<IosIcon name="close" size={13} tint="currentColor" /> Batalkan pesanan</Button>
</div>}</div>
</AdminDialog>;
}

function ActionDialog({ action, note, setNote, saving, onClose, onConfirm }: { action: NonNullable<ActionState>; note: string; setNote: (value: string) => void; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const copy = { paid: ["Konfirmasi pesanan lunas?", "Lisensi / key / catatan untuk pembeli", "Konfirmasi lunas"], paid_qris: ["ACC pembayaran QRIS?", "Hasil cek mutasi merchant sesuai invoice (wajib, min. 10 karakter) - cth: mutasi Rp18.286 masuk 12.45 dari TULISIRFAN", "ACC & lunaskan"], handover: ["Kirim ke pembeli", "Catatan internal (opsional)", "Kirim ke pembeli"], approve: ["Mutasi pembayaran sudah cocok?", "Catatan opsional", "Setujui & lunaskan"], reject: ["Tolak bukti pembayaran?", "Alasan penolakan wajib diisi", "Tolak bukti"], cancel: ["Batalkan pesanan?", "Alasan atau catatan pembatalan", "Batalkan pesanan"] }[action.kind];
  const danger = ["reject", "cancel"].includes(action.kind);
  const noteRequired = action.kind === "reject" || action.kind === "paid_qris";
  return <AdminDialog title={copy[0]} onClose={onClose} busy={saving}>{action.kind === "paid_qris" && <div className="rounded-xl border border-admin-warning/25 bg-admin-warning/10 p-3 text-xs leading-5 text-admin-warning">Pastikan dana benar masuk di mutasi merchant sesuai invoice dengan nominal persis {formatRupiah(action.order.paymentAmount)}. ACC melunaskan pesanan dan menjadwalkan pengiriman serta notifikasi - tidak bisa dibatalkan.</div>}<div className="flex flex-wrap items-center gap-2">
<span className="font-mono text-xs font-semibold text-admin-accent">{action.order.code}</span>
<StatusBadge status={action.order.status} />
<ChannelBadge channel={action.order.salesChannel} />
<MethodBadge method={action.order.method} />
</div>
<p className="mt-3 text-sm text-admin-muted">{action.order.name}</p>
<Label className="mt-4 block">
<span className="text-xs font-semibold text-admin-muted">{copy[1]}</span>
<Textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-xl border border-admin-border bg-admin-subtle p-3 text-sm text-admin-fg outline-none focus:border-admin-accent/40" />
</Label>
<div className="mt-5 flex justify-end gap-2">
<Button variant="outline" type="button" disabled={saving} onClick={onClose} className="h-9 rounded-md border border-admin-border px-4 text-sm text-admin-muted transition hover:bg-admin-subtle">Batal</Button>
<Button variant="destructive" type="button" disabled={saving || (noteRequired && !note.trim())} onClick={onConfirm} className={`inline-flex h-9 items-center gap-2 rounded-md px-5 text-sm font-semibold text-admin-inverse transition disabled:opacity-50 ${danger ? "bg-admin-danger hover:bg-admin-danger/90" : "bg-admin-primary hover:bg-admin-primary/90"}`}>{saving ? <Spinner size={14} /> : <IosIcon name={danger ? "close" : "checked"} size={13} tint="currentColor" />}{copy[2]}</Button>
</div>
</AdminDialog>;
}

function AdminDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: React.ReactNode; busy?: boolean }) {
  return <Dialog title={title} onClose={onClose} busy={busy} className="w-[calc(100%-2rem)] max-w-xl p-5 sm:p-6">
<header className="mb-5 flex items-center justify-between gap-3">
<h2 className="text-base font-semibold text-admin-fg">{title}</h2>
<Button variant="outline" size="icon" type="button" disabled={busy} onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-admin-subtle" aria-label="Tutup dialog">
<IosIcon name="close" size={13} />
</Button>
</header>{children}</Dialog>;
}

type HandoverItem = { item_index: number; status: string; label?: string; template_text?: string; fulfillment_mode?: string };

async function fetchHandoverItems(code: string): Promise<HandoverItem[]> {
  return (await fetchHandoverState(code)).items;
}

async function fetchHandoverState(code: string): Promise<{ items: HandoverItem[]; channel: string; email: string | null; error?: string }> {
  try {
    const response = await fetch(`/api/admin/orders/${encodeURIComponent(code)}/handover`, { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as { items?: HandoverItem[]; order?: { sales_channel?: string; customer_email?: string | null }; error?: string };
    if (!response.ok || !Array.isArray(data.items)) return { items: [], channel: "", email: null, error: data.error || `HTTP ${response.status}` };
    return { items: data.items, channel: String(data.order?.sales_channel ?? ""), email: data.order?.customer_email ?? null };
  } catch { return { items: [], channel: "", email: null, error: "Item serah terima gagal dimuat." }; }
}

/**
 * Dialog "Kirim ke pembeli" (2026-09-25). Dulu tombol "Serahkan manual"
 * hanya menandai item terkirim + catatan audit, dan pembeli menerima kabar
 * tanpa isi, jadi admin tetap harus mengirim produk lewat WA. Kini isi yang
 * diketik di sini dikirim ke pembeli (email bermerek untuk web, DM untuk
 * Telegram) dan tersimpan terenkripsi untuk halaman pesanan.
 */
function HandoverDialog({ order, note, setNote, messages, setMessages, saving, onClose, onConfirm }: {
  order: Order; note: string; setNote: (value: string) => void;
  messages: Record<number, string>; setMessages: (value: Record<number, string>) => void;
  saving: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const [state, setState] = useState<{ loading: boolean; items: HandoverItem[]; channel: string; email: string | null; error?: string }>({ loading: true, items: [], channel: "", email: null });
  useEffect(() => {
    let alive = true;
    void fetchHandoverState(order.code).then((next) => {
      if (!alive) return;
      setState({ loading: false, ...next });
      const prefill: Record<number, string> = {};
      for (const item of next.items) if (item.status !== "delivered" && item.template_text) prefill[item.item_index] = item.template_text;
      setMessages(prefill);
    });
    return () => { alive = false; };
  }, [order.code, setMessages]);
  const pending = state.items.filter((item) => item.status !== "delivered");
  const destination = state.channel === "telegram"
    ? "Dikirim lewat DM Telegram pembeli dan tampil di halaman pesanan."
    : state.email
      ? <>Dikirim ke email <span className="font-medium text-admin-muted">{state.email}</span> dan tampil di halaman pesanan.</>
      : "Pesanan ini tidak punya email pembeli. Isi tetap tersimpan di halaman pesanan; kabari pembeli lewat WA.";
  return <AdminDialog title="Kirim ke pembeli" onClose={onClose} busy={saving}>
<div className="flex flex-wrap items-center gap-2">
<span className="font-mono text-xs font-semibold text-admin-accent">{order.code}</span>
<StatusBadge status={order.status} />
<ChannelBadge channel={order.salesChannel} />
</div>
<p className="mt-3 text-sm text-admin-muted">{order.name}</p>
    {state.loading ? <p className="mt-4 text-sm text-admin-muted">Memuat item...</p>
      : state.error ? <p role="alert" className="mt-4 text-sm text-admin-danger">{state.error}</p>
      : <>
        <p className="mt-3 text-xs leading-5 text-admin-muted">{destination}</p>
        {pending.map((item) => <Label key={item.item_index} className="mt-4 block">
<span className="text-xs font-semibold text-admin-muted">Detail untuk pembeli · {item.label || `Item ${item.item_index + 1}`}</span>
<Textarea value={messages[item.item_index] ?? ""} onChange={(event) => setMessages({ ...messages, [item.item_index]: event.target.value })} rows={4} maxLength={4000} placeholder="Akun, link undangan, atau instruksi. Kosongkan bila produk sudah kamu kirim lewat WA." className="mt-2 w-full resize-y rounded-xl border border-admin-border bg-admin-subtle p-3 font-mono text-sm text-admin-fg placeholder:font-sans placeholder:text-admin-muted focus:border-admin-accent/50 focus:outline-none" />
</Label>)}
        <Label className="mt-4 block">
<span className="text-xs font-semibold text-admin-muted">Catatan internal (opsional, tidak dikirim ke pembeli)</span>
<Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="mt-2 h-9 w-full rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg focus:border-admin-accent/50 focus:outline-none" />
</Label>
      </>}
    <div className="mt-5 flex justify-end gap-2">
<Button variant="outline" type="button" onClick={onClose} disabled={saving} className="h-9 rounded-md border border-admin-border px-4 text-sm font-semibold text-admin-muted hover:bg-admin-subtle disabled:opacity-50">Batal</Button>
<Button variant="default" type="button" onClick={onConfirm} disabled={saving || state.loading || Boolean(state.error)} className="inline-flex h-9 items-center gap-2 rounded-md bg-admin-primary px-5 text-sm font-semibold text-admin-inverse disabled:opacity-50">{saving ? "Mengirim..." : "Kirim ke pembeli"}</Button>
</div>
  </AdminDialog>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-admin-border bg-admin-subtle p-3">
<p className="text-sm text-admin-muted">{label}</p>
<p className="mt-1 break-words text-sm text-admin-muted">{value}</p>
</div>; }

/** Penanda jenis pesanan; sama dengan gaya ChannelBadge. */
function PediaChip() { return <Badge variant="outline" className="rounded-md border border-admin-border bg-admin-subtle px-2.5 py-1 text-xs font-semibold text-admin-muted">Pedia</Badge>; }

/**
 * Chip status lifecycle Pedia dari item durable. Hanya untuk pesanan lunas:
 * pending/batal/kedaluwarsa sudah ditunjukkan StatusBadge. Item belum terbaca
 * tampil "Status belum diketahui" (netral), tidak pernah sukses/handover.
 */
function PediaStatusChip({ order }: { order: Order }) {
  if (order.status !== "lunas") return null;
  const status = order.pedia?.status;
  const label = status ? pediaStatusLabel(status) : "Status belum diketahui";
  const tone = !status ? "border-admin-border bg-admin-subtle text-admin-muted"
    : status === "completed" ? "border-admin-success/25 bg-admin-success/10 text-admin-success"
    : status === "needs_check" ? "border-admin-info/30 bg-admin-info/10 text-admin-info"
    : status === "partial" || status === "canceled" ? "border-admin-warning/30 bg-admin-warning/10 text-admin-warning"
    : "border-admin-accent/25 bg-admin-primary/10 text-admin-accent";
  return <Badge data-testid="pedia-status-chip" className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</Badge>;
}

/** Pedia pending: pembayaran hanya via QRIS otomatis; PATCH admin menolak kode AXP, jadi tanpa aksi ACC/Tolak/Batalkan. */
function PediaAwaitingPayment() { return <span className="inline-flex h-9 items-center rounded-md border border-admin-border px-3 text-xs text-admin-muted">Menunggu pembayaran QRIS</span>; }

/** Tautan ke Admin → Pedia → Pesanan untuk tindak lanjut; tidak mengimplementasi ulang aksi Pedia. */
function PediaFollowUpLink({ order }: { order: Order }) {
  const status = order.pedia?.status;
  if (order.status !== "lunas" || !status || !["needs_check", "partial", "canceled"].includes(status)) return null;
  return <a href="/admin?section=pedia&tab=orders" className="inline-flex min-h-9 items-center rounded-md border border-admin-border bg-admin-subtle px-3 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg sm:h-9 sm:min-h-0">Tindak lanjut di Pedia</a>;
}

/** Jumlah beli Pedia = quantity item (bukan qty baris keranjang yang selalu 1). */
function pediaQuantity(order: Order): number | null {
  const fromItem = knownCount(order.pedia?.quantity);
  if (fromItem !== null) return fromItem;
  const nested = (order.items[0] as { pedia?: { quantity?: unknown } } | undefined)?.pedia?.quantity;
  return knownCount(nested);
}

function pediaItemLine(order: Order): string {
  const quantity = pediaQuantity(order);
  const parts = [order.items[0]?.name || "Layanan Pedia"];
  if (quantity !== null) parts.push(formatCount(quantity));
  const done = order.pedia?.done;
  if (order.status === "lunas" && quantity !== null && typeof done === "number") parts.push(`${formatCount(done)}/${formatCount(quantity)} masuk`);
  return parts.join(" · ");
}

function PediaItemBox({ order }: { order: Order }) {
  const quantity = pediaQuantity(order);
  const done = order.pedia?.done;
  return <div className="mt-3 space-y-2 text-sm">
<p className="text-admin-muted">{order.items[0]?.name || "Layanan Pedia"}{quantity !== null ? ` · ${formatCount(quantity)}` : ""}</p>{order.pedia?.target && <p className="break-all text-xs text-admin-muted">Tujuan: {order.pedia.target}</p>}{order.status === "lunas" && quantity !== null && typeof done === "number" && <p className="text-xs text-admin-muted">{formatCount(done)}/{formatCount(quantity)} masuk</p>}{order.pedia?.lastError && <p className="break-words text-xs text-admin-warning">Catatan: {order.pedia.lastError}</p>}<p className="pt-1 font-semibold text-admin-fg">{formatRupiah(order.paymentAmount)}</p>
</div>;
}

/** Nama dari server; baris lama kosong memakai turunan email (seperti Market). */
function displayName(order: Order): string {
  const stored = order.name.trim();
  if (stored) return stored;
  if (order.kind === "pedia" && order.email) return deriveNameFromEmail(order.email);
  return "Tanpa nama";
}

/**
 * Badge status pengiriman produk. Sebelumnya `fulfillment_status` sudah
 * di-parse `normalizeOrder` tetapi TIDAK PERNAH dirender, sehingga admin harus
 * membuka Detail satu per satu untuk menemukan order yang perlu diserahkan
 * manual. `failed` sengaja merah: itu order lunas yang pembelinya belum
 * menerima apa pun.
 */
function FulfillmentBadge({ status, supplierActive = false }: { status?: string; supplierActive?: boolean }) {
  if (!status || status === "not_required" || status === "delivered") return null;
  // Item WR/SK berstatus manual_required selama supplier masih memproses —
  // "Perlu handover" di situ menyesatkan (2026-10-10). Status supplier tampil
  // di SupplierLinkActions; handover manual tetap tersedia sebagai cadangan.
  if (supplierActive && status === "manual_required") return <Badge variant="outline" className="rounded-md border border-admin-accent/25 bg-admin-primary/10 px-2.5 py-1 text-xs font-semibold text-admin-accent">Via supplier</Badge>;
  const label = status === "manual_required" ? "Perlu handover"
    : status === "failed" ? "Kirim GAGAL"
    : status === "queued" ? "Antre kirim"
    : status === "sending" ? "Mengirim…"
    : status;
  const tone = status === "failed"
    ? "border-admin-danger/30 bg-admin-danger/10 text-admin-danger"
    : status === "manual_required"
      ? "border-admin-warning/30 bg-admin-warning/10 text-admin-warning"
      : "border-admin-border bg-admin-subtle text-admin-muted";
  return <Badge variant="outline" className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</Badge>;
}
// Timestamp D1 berformat spasi adalah UTC — parsing wajib lewat helper kanonis
// (formatWibDateTime), bukan `new Date(value)` yang membacanya sebagai lokal.
function formatDate(value: string) { return formatWibDateTime(value) ?? value; }
function normalizePedia(raw: unknown): PediaSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const status = typeof value.status === "string" && value.status ? value.status : "";
  if (!status) return null;
  return { status, quantity: knownCount(value.quantity), done: knownCount(value.done), target: typeof value.target === "string" && value.target ? value.target : null, lastError: typeof value.last_error === "string" && value.last_error ? value.last_error : null };
}
function normalizeOrder(raw: Record<string, unknown>): Order { const code = String(raw.code || ""); const kind: Order["kind"] = raw.order_kind === "games" || /^AXG-/.test(code) ? "games" : raw.order_kind === "pedia" || (raw.order_kind == null && /^AXP-/.test(code)) ? "pedia" : "apps"; return { kind, pedia: kind === "pedia" ? normalizePedia(raw.pedia) : null, code, name: String(raw.customer_name || ""), wa: String(raw.customer_wa || ""), email: String(raw.customer_email || ""), method: String(raw.payment_method || ""), items: Array.isArray(raw.items) ? raw.items as Order["items"] : [], subtotal: Number(raw.subtotal || 0), paymentAmount: Number(raw.payment_amount || raw.subtotal || 0), status: String(raw.status || "pending"), paymentStatus: String(raw.payment_status || "unpaid"), fulfillmentStatus: raw.fulfillment_status ? String(raw.fulfillment_status) : undefined, salesChannel: (["web", "telegram", "whatsapp"].includes(String(raw.sales_channel)) ? raw.sales_channel : "web") as OrderChannel, fileName: raw.proof_url ? String(raw.proof_url) : undefined, proofId: raw.proof_id == null ? undefined : Number(raw.proof_id), proofStatus: (["submitted", "approved", "rejected"].includes(String(raw.proof_status)) ? raw.proof_status : undefined) as Order["proofStatus"], proofClaimedMethod: raw.proof_claimed_method as Order["proofClaimedMethod"], proofRejectionReason: raw.proof_rejection_reason ? String(raw.proof_rejection_reason) : undefined, adminNote: raw.admin_note ? String(raw.admin_note) : undefined, createdAt: String(raw.created_at || ""), supplierLinks: Array.isArray(raw.supplier_links) ? raw.supplier_links as SupplierLink[] : [] }; }
