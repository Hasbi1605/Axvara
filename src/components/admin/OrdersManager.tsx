"use client";
import { Badge, Button, Card, Input, Label, Textarea, Table, TableHeader, TableHead, TableBody, TableRow, TableCell, Separator, Skeleton, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, Popover, PopoverTrigger, PopoverContent, PageHeader, StatCard } from "@/components/admin/ui";

import { ChevronDown, Download, MoreHorizontal, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveNameFromEmail, formatRupiah, formatWibDateTime } from "@/lib/utils";
import { pediaStatusLabel } from "@/components/pedia/StatusWidgets";
import { formatCount, knownCount } from "@/components/pedia/status-view";
import { ChannelBadge, IosIcon } from "@/components/admin/AdminIcon";
import { Spinner } from "@/components/ui/Loading";
import { Dialog } from "@/components/ui/Dialog";
import { OrderAccessAdmin } from "@/components/admin/OrderAccessAdmin";
import { ProofThumbnail } from "@/components/admin/ProofThumbnail";
import { useToast } from "@/components/ui/Toast";
import { hasActiveSupplierLink, SupplierLinkActions, type SupplierLink } from "@/components/admin/SupplierLinkActions";
import { ExpenseFormSheet } from "@/components/admin/finance/ExpenseFormSheet";

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

const PER_PAGE = 25;
const statusLabels: Record<string, string> = { pending: "Pending", lunas: "Lunas", dibatalkan: "Dibatalkan", kadaluarsa: "Kedaluwarsa" };
function methodLabel(method: string) {
  if (/^nowpayments:/i.test(method)) return `Crypto · ${method.split(":")[1].toUpperCase().replace("USDTBSC", "USDT BSC")}`;
  if (/^sekalipay_gateway:/i.test(method)) return `Gateway · ${method.split(":")[1].toUpperCase()}`;
  return ({ qris: "QRIS", manual: "Transfer manual", seabank: "SeaBank", ewallet: "E-wallet" } as Record<string, string>)[method.toLowerCase()] || method.toUpperCase();
}
function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "lunas" ? "success" : status === "pending" ? "warning" : status === "dibatalkan" ? "destructive" : "secondary"}>{statusLabels[status] || status}</Badge>;
}
function MethodBadge({ method }: { method: string }) { return <Badge variant="outline">{methodLabel(method)}</Badge>; }

function OrderFilter({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; count?: number }[]; onChange: (value: string) => void }) {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="gap-2">{label}{value !== "all" && <span className="sr-only">: {options.find(option => option.value === value)?.label || value}</span>}<ChevronDown size={14} /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={value} onValueChange={onChange}>{options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} className="gap-4">{option.label}{option.count !== undefined && <span className="ml-auto tabular-nums text-admin-muted">{option.count}</span>}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
  </DropdownMenu>;
}
const BUYER_NOT_NOTIFIED = "Serah terima tercatat, tetapi kabar ke pembeli GAGAL terkirim. Hubungi pembeli secara manual.";

export function OrdersManager({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  // Deep links initialize filters; popstate restores browser navigation below.
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
  const loaded = useRef({ filters: "", page: 0 });

  const load = useCallback(async (signal?: AbortSignal, append = false) => {
    const request = ++loadRequest.current;
    const params = new URLSearchParams(requestParams);
    params.delete("page");
    const filters = params.toString();
    const appendNext = append && loaded.current.filters === filters && loaded.current.page === page - 1;
    if (!appendNext) setOrders([]);
    setLoading(true); setError("");
    try {
      let data: ApiData = {};
      const rows: Order[] = [];
      let lastPage = page;
      for (let next = appendNext ? page : 1; next <= lastPage; next++) {
        params.set("page", String(next));
        const response = await fetch(`/api/admin/orders?${params}`, { cache: "no-store", signal });
        data = await response.json().catch(() => ({})) as ApiData;
        if (signal?.aborted || request !== loadRequest.current) return;
        if (!response.ok) throw new Error("Gagal memuat pesanan. Coba lagi.");
        rows.push(...(data.orders || []).map(normalizeOrder));
        lastPage = Math.min(page, Number(data.pagination?.pages || 1));
      }
      if (signal?.aborted || request !== loadRequest.current) return;
      setOrders(current => appendNext ? [...current, ...rows.filter(row => !current.some(item => item.code === row.code))] : rows);
      loaded.current = { filters, page: lastPage };
      setPage(lastPage);
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
  }, [requestParams, page]);

  // Setiap requestParams baru membatalkan fetch sebelumnya: tanpa abort,
  // respons filter lama yang tiba belakangan menimpa daftar filter baru
  // (temuan audit: fetch urutan terbalik).
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal, true);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ["channel", "kind", "status", "method", "proof", "q", "date_from", "date_to", "page"]) url.searchParams.delete(key);
    requestParams.forEach((value, key) => { if (key !== "limit") url.searchParams.set(key, value); });
    history.replaceState(history.state, "", `${url.pathname}?${url.searchParams}`);
  }, [requestParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(draftQuery.trim()); setPage(current => draftQuery.trim() === query ? current : 1); }, 300);
    return () => window.clearTimeout(timer);
  }, [draftQuery, query]);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      setChannel(params.get("channel") || "all"); setKind(params.get("kind") || "all"); setStatus(params.get("status") || "all"); setMethod(params.get("method") || "all"); setProof(params.get("proof") || "");
      setDraftQuery(params.get("q") || ""); setQuery(params.get("q") || ""); setDateFrom(params.get("date_from") || ""); setDateTo(params.get("date_to") || "");
      const value = Number(params.get("page")); setPage(Number.isInteger(value) && value >= 1 ? value : 1);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const clearFilters = () => { setChannel("all"); setKind("all"); setStatus("all"); setMethod("all"); setProof(""); setDraftQuery(""); setQuery(""); setDateFrom(""); setDateTo(""); setPage(1); };
  // Filter yang tidak punya kontrol sendiri di layar (terutama `proof`, yang
  // datang dari kartu "Bukti manual" di Ringkasan) sebelumnya menyaring daftar
  // secara diam-diam: semua dropdown menampilkan "Semua" sementara hasilnya
  // tersaring, sehingga pesanan terlihat hilang. Chip ini membuat setiap
  // filter aktif terlihat dan bisa dilepas satu per satu.
  const activeFilters: { label: string; clear: () => void }[] = [];
  if (proof === "submitted") activeFilters.push({ label: "Bukti manual menunggu", clear: () => changeFilter(setProof, "") });
  if (channel !== "all") activeFilters.push({ label: `Kanal: ${{ web: "Web", telegram: "Telegram", whatsapp: "WhatsApp" }[channel] || channel}`, clear: () => changeFilter(setChannel, "all") });
  if (kind !== "all") activeFilters.push({ label: `Jenis: ${kind === "pedia" ? "Pedia" : kind === "games" ? "Games" : "Aplikasi"}`, clear: () => changeFilter(setKind, "all") });
  if (status !== "all") activeFilters.push({ label: `Status: ${statusLabels[status] || status}`, clear: () => changeFilter(setStatus, "all") });
  if (method !== "all") activeFilters.push({ label: `Pembayaran: ${methodLabel(method)}`, clear: () => changeFilter(setMethod, "all") });
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

  const channelTotal = (counts.web || 0) + (counts.telegram || 0) + (counts.whatsapp || 0);

  return <div className="mt-4 space-y-6">
    <PageHeader title="Pesanan" description="Cari, periksa pembayaran, dan proses pesanan dari semua kanal." actions={<><Button asChild variant="outline" size="sm"><a href="/admin/refund">Hitung Refund</a></Button><Button asChild variant="outline" size="sm"><a href={exportHref}><Download size={14} /> Ekspor CSV</a></Button></>} />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Total pesanan", stats.total], ["Pending", stats.pending], ["Lunas", stats.paid], ["Omzet", formatRupiah(stats.revenue)]].map(([label, value]) => <StatCard key={label} label={label} value={loading || error ? <Skeleton className="h-8 w-24" /> : value} hint={hasActiveFilters ? "Hasil filter" : undefined} />)}
    </div>

    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" aria-label="Filter pesanan">
        <div className="relative min-w-0 flex-1 basis-52">
          <Label className="sr-only" htmlFor="order-search">Pencarian</Label><Search size={15} className="absolute left-3 top-2.5 text-admin-muted" />
          <Input id="order-search" value={draftQuery} onChange={event => setDraftQuery(event.target.value)} className="h-9 pl-9" placeholder="Kode, nama, WA, produk…" />
        </div>
        <OrderFilter label="Kanal" value={channel} onChange={value => changeFilter(setChannel, value)} options={[{ value: "all", label: "Semua kanal", count: loading ? undefined : channelTotal }, ...[["web", "Web"], ["telegram", "Telegram"], ["whatsapp", "WhatsApp"]].map(([value, label]) => ({ value, label, count: loading ? undefined : counts[value] || 0 }))]} />
        <OrderFilter label="Status" value={status} onChange={value => changeFilter(setStatus, value)} options={[{ value: "all", label: "Semua status" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
        <OrderFilter label="Jenis" value={kind} onChange={value => changeFilter(setKind, value)} options={[{ value: "all", label: "Semua jenis" }, { value: "apps", label: "Aplikasi" }, { value: "pedia", label: "Pedia" }, { value: "games", label: "Games" }]} />
        <OrderFilter label="Pembayaran" value={method} onChange={value => changeFilter(setMethod, value)} options={[...new Set(["all", "qris", "manual", ...methods, ...(method !== "all" ? [method] : [])])].map(value => ({ value, label: value === "all" ? "Semua pembayaran" : methodLabel(value) }))} />
        <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="gap-2">Tanggal<ChevronDown size={14} /></Button></PopoverTrigger><PopoverContent align="end" className="w-72 space-y-4">
          <div className="space-y-2"><Label htmlFor="orders-date-from">Dari tanggal</Label><Input id="orders-date-from" type="date" value={dateFrom} onChange={event => changeFilter(setDateFrom, event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="orders-date-to">Sampai tanggal</Label><Input id="orders-date-to" type="date" value={dateTo} onChange={event => changeFilter(setDateTo, event.target.value)} /></div>
        </PopoverContent></Popover>
      </div>
      {hasActiveFilters && <div className="flex flex-wrap items-center gap-2" aria-label="Filter aktif">
        {activeFilters.map(filter => <Button variant="outline" size="sm" key={filter.label} onClick={filter.clear} className="h-auto min-h-8 max-w-full gap-2 whitespace-normal text-left" aria-label={`Hapus filter ${filter.label}`}>{filter.label}<X size={12} className="shrink-0" /></Button>)}
        <Button variant="ghost" size="sm" onClick={clearFilters}>Reset</Button>
      </div>}
    </div>

    <Card className="overflow-hidden">
      {error && <div role="alert" className="m-4 flex items-center justify-between gap-3 rounded-md border border-admin-danger/20 bg-admin-danger/10 p-3 text-sm text-admin-danger">
<span>{error}</span>
<Button variant="outline" size="sm" type="button" onClick={() => void load(undefined, true)}>Coba lagi</Button>
</div>}
      {loading && orders.length === 0 ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-admin-muted">
<div className="w-full space-y-4 p-6">
<Skeleton className="h-16 w-full" />
<Skeleton className="h-16 w-full" />
<span className="sr-only">Memuat pesanan…</span>
</div>
</div> : orders.length === 0 ? !error && <p className="p-10 text-center text-sm text-admin-muted">Tidak ada pesanan yang cocok dengan filter.</p> : <Table className="block md:table md:table-fixed" aria-label="Daftar pesanan">
<TableHeader className="hidden md:table-header-group">
<TableRow>
<TableHead className="w-[22%]">Pesanan</TableHead>
<TableHead className="w-[16%]">Produk</TableHead>
<TableHead className="w-[11%] text-right">Total</TableHead>
<TableHead className="w-[11%]">Status</TableHead>
<TableHead className="w-[12%]">Kanal/Metode</TableHead>
<TableHead className="w-[13%]">Waktu</TableHead>
<TableHead className="w-[15%] text-right">Aksi</TableHead>
</TableRow>
</TableHeader>
<TableBody className="block space-y-3 p-3 md:table-row-group md:space-y-0 md:p-0">{orders.map((order) => <OrderRow key={order.code} order={order} onChanged={() => { void load(); onChanged?.(); }} onDetail={() => setSelected(order)} onAction={(kind) => { setAction({ kind, order }); setActionNote(""); }} />)}</TableBody>
</Table>}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3 text-xs text-admin-muted sm:px-5">
<span role="status">{loading && orders.length === 0 ? "Memuat pesanan…" : error && orders.length === 0 ? "Pesanan belum termuat" : `Menampilkan ${orders.length} dari ${total}`}</span>
{orders.length > 0 && page < pages && <Button variant="outline" size="sm" disabled={loading || !!error} onClick={() => setPage(current => current + 1)}>{loading ? "Memuat…" : "Muat 25 lagi"}</Button>}
</footer>
    </Card>

    {selected && <OrderDetail order={selected} onChanged={() => { setSelected(null); void load(); onChanged?.(); }} onClose={() => setSelected(null)} onAction={(kind) => { setSelected(null); setAction({ kind, order: selected }); setActionNote(""); setHandoverMessages({}); }} />}
    {action && action.kind === "handover"
      ? <HandoverDialog order={action.order} note={actionNote} setNote={setActionNote} messages={handoverMessages} setMessages={setHandoverMessages} saving={saving} onClose={() => !saving && setAction(null)} onConfirm={() => void runAction()} />
      : action && <ActionDialog action={action} note={actionNote} setNote={setActionNote} saving={saving} onClose={() => !saving && setAction(null)} onConfirm={() => void runAction()} />}
  </div>;
}

// TUNVN menahan serah terima hanya selama supplier masih memegang item
// (pending/claimed/processing — sama dengan guard backend handover.ts) atau
// Retry pra-beli aman tersedia. needs_admin tanpa Retry (mis. balasan 500
// tanpa batch_id) adalah jalan buntu: admin wajib bisa serah terima manual.
function tunvnHoldsItem(link:SupplierLink):boolean {
  return link.supplier==="tunvn" && !link.purchase_disabled && (["pending","claimed","processing"].includes(link.status) || Boolean(link.can_retry));
}
function hasHandoverItems(order:Order):boolean {
  return order.items.some((_,index)=>!order.supplierLinks?.some(link=>tunvnHoldsItem(link) && link.item_index===index));
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
    <TableCell className="block min-w-0 align-top first:pl-4 md:table-cell md:first:pl-6">
<Button variant="link" type="button" onClick={onDetail} className="h-auto max-w-full justify-start whitespace-normal break-all p-0 text-left font-mono text-xs font-semibold text-admin-fg">{order.code}</Button>
<p className="mt-2 truncate text-sm font-medium text-admin-fg" title={displayName(order)}>{displayName(order)}</p>
<p className="mt-0.5 truncate text-xs text-admin-muted" title={order.wa || order.email}>{order.wa || order.email || "Kontak tidak tersedia"}</p>
    </TableCell>
    <TableCell className="block align-top md:table-cell"><span className="mr-2 text-xs text-admin-muted md:hidden">Produk</span><span className="break-words text-sm">{isPedia ? pediaItemLine(order) : order.items.map(item => `${item.name} x${item.qty}`).join(", ")}</span>{isPedia && <div className="mt-2"><PediaChip /></div>}</TableCell>
    <TableCell className="block align-top md:table-cell md:text-right"><span className="mr-2 text-xs text-admin-muted md:hidden">Total</span><span className="tabular-nums text-admin-fg">{formatRupiah(order.paymentAmount)}</span></TableCell>
    <TableCell className="block align-top md:table-cell"><div className="flex flex-wrap gap-2 [&>span]:whitespace-normal"><StatusBadge status={order.status} />{isPedia ? <>
<PediaStatusChip order={order} />
</> : <FulfillmentBadge status={order.fulfillmentStatus} supplierActive={hasActiveSupplierLink(order.supplierLinks)} />}</div>{isPedia && order.status === "pending" && <PediaAwaitingPayment />}{order.proofStatus === "rejected" && <p className="mt-1 text-xs text-admin-danger" title={order.proofRejectionReason}>Bukti ditolak</p>}{(!isMarket || providerPayment) && order.status === "pending" && !isPedia && <p className="mt-1 text-xs text-admin-muted" title="Menunggu verifikasi provider">Otomatis</p>}</TableCell>
    <TableCell className="block align-top md:table-cell"><div className="flex flex-wrap gap-2 [&>span]:whitespace-normal [&>span]:break-words"><ChannelBadge channel={order.salesChannel} /><MethodBadge method={order.method} /></div></TableCell>
    <TableCell className="block whitespace-nowrap align-top text-xs text-admin-muted md:table-cell"><time dateTime={order.createdAt} title={`${formatDate(order.createdAt)} WIB`}>{formatOrderTime(order.createdAt)}</time></TableCell>
    <TableCell className="block align-top last:pr-4 md:table-cell md:last:pr-6"><div className="flex flex-wrap gap-2 md:justify-end">
    <div className="flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={onDetail}>Detail</Button>
      {(needsHandover || (isMarket && !providerPayment && order.status === "pending")) && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Tindakan lain ${order.code}`}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
        {needsHandover && <DropdownMenuItem onSelect={() => onAction("handover")}>Kirim ke pembeli</DropdownMenuItem>}
        {isMarket && !providerPayment && order.status === "pending" && <>
          {qris ? <DropdownMenuItem onSelect={() => onAction("paid_qris")}>ACC pembayaran</DropdownMenuItem> : order.salesChannel !== "whatsapp" ? <DropdownMenuItem onSelect={() => onAction("paid")}>Konfirmasi lunas</DropdownMenuItem> : order.proofId && order.proofStatus === "submitted" ? <><DropdownMenuItem onSelect={() => onAction("approve")}>Mutasi cocok</DropdownMenuItem><DropdownMenuItem className="text-admin-danger" onSelect={() => onAction("reject")}>Tolak bukti</DropdownMenuItem></> : <DropdownMenuItem disabled>Menunggu bukti</DropdownMenuItem>}
          <DropdownMenuItem className="text-admin-danger" onSelect={() => onAction("cancel")}>Batalkan pesanan</DropdownMenuItem>
        </>}
      </DropdownMenuContent></DropdownMenu>}
      </div>{isPedia && <PediaFollowUpLink order={order} />}
      {order.status === "lunas" && order.supplierLinks?.length ? <SupplierLinkActions links={order.supplierLinks} onChanged={onChanged} compact /> : null}
    </div>
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
<p className="break-all font-mono text-sm font-semibold text-admin-fg">{order.code}</p>
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
<Info label="Pembayaran" value={`${methodLabel(order.method)} · ${formatRupiah(order.paymentAmount)}`} />
</div>
<Separator />
<div className="rounded-md border border-admin-border bg-admin-subtle p-4">
<p className="text-sm font-medium text-admin-muted">Item</p>{order.kind === "games" ? <GamesItemBox order={order} onChanged={onChanged} /> : isPedia ? <PediaItemBox order={order} /> : order.items.map((item, index) => <div key={`${item.name}-${index}`} className="mt-3 flex justify-between gap-4 text-sm">
<span className="text-admin-muted">{item.name} x{item.qty}</span>
<span className="font-semibold text-admin-fg">{formatRupiah(item.price * item.qty)}</span>
</div>)}</div>{isPedia && <PediaFollowUpLink order={order} />}{order.status === "lunas" && <RefundReplaceAction order={order} onChanged={onChanged} />}{qris && <div className="rounded-md border border-admin-info/20 bg-admin-info/10 p-3 text-xs leading-5 text-admin-info">QRIS diproses otomatis. Bukti gambar, jika ada, hanya dipakai sebagai referensi.</div>}{order.fileName && <ProofThumbnail proof={order.fileName} />}{order.adminNote && <Info label="Catatan admin" value={order.adminNote} />}{order.proofStatus === "rejected" && <Info label="Bukti ditolak" value={order.proofRejectionReason || "Tanpa alasan tercatat"} />}{needsHandover && <div className="flex flex-wrap justify-end gap-2 border-t border-admin-border pt-4">
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

type GamesDetail = { game_name?: string | null; product_name?: string | null; customer_no?: string | null; nickname?: string | null; status?: string | null; sn?: string | null; supplier?: string | null; sk_invoice?: string | null; supplier_ref?: string | null; last_error?: string | null; cost?: number | null; max_price?: number | null };
const GAMES_ITEM_STATUS: Record<string, string> = { awaiting_payment: "Menunggu pembayaran", queued: "Antre kirim", submitting: "Dikirim ke Sekalipay", pending: "Diproses Sekalipay", success: "Berhasil", needs_check: "Perlu dicek admin", expired: "Kedaluwarsa", failed: "Gagal" };

/** Item Games (games_order_items) + pemulihan "Cek ulang Sekalipay" (GET status by ref, tanpa beli ulang). */
function GamesItemBox({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const toast = useToast();
  const [detail, setDetail] = useState<GamesDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    let active = true; setDetail(null); setFailed(false);
    void fetch(`/api/admin/games/orders/${encodeURIComponent(order.code)}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => { if (active) setDetail(data.games ?? null); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [order.code]);
  const recheck = async () => {
    if (busy) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch(`/api/admin/games/orders/${encodeURIComponent(order.code)}/recheck`, { method: "POST", cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : typeof data.message === "string" ? data.message : "Cek ulang gagal");
      const status = String(data.item_status ?? "");
      setDetail((current) => current ? { ...current, status, sn: data.sn ?? current.sn } : current);
      const text = status === "success" ? `Berhasil — SN ${data.sn ?? "-"}` : `${GAMES_ITEM_STATUS[status] ?? status}${data.message ? ` · ${data.message}` : ""}`;
      setResult(text);
      if (status === "success") { toast.success(`${order.code} ditandai berhasil.`); onChanged(); }
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : "Cek ulang gagal");
    } finally { setBusy(false); }
  };
  const fallback = order.items[0]?.name;
  const status = String(detail?.status ?? "");
  const canRecheck = order.status === "lunas" && (detail?.supplier ?? "sekalipay") === "sekalipay" && ["needs_check", "pending", "submitting"].includes(status);
  return <div className="mt-3 space-y-2 text-sm">
    {failed && <p role="alert" className="text-xs text-admin-danger">Detail Games gagal dimuat.</p>}
    <p className="font-semibold text-admin-fg">{detail ? [detail.game_name, detail.product_name].filter(Boolean).join(" — ") || fallback || "Top up game" : fallback || "Memuat…"}</p>
    {detail?.customer_no && <p className="break-all text-xs text-admin-muted">ID akun: {detail.customer_no}{detail.nickname ? ` · ${detail.nickname}` : ""}</p>}
    {detail && <p className="text-xs text-admin-muted">Status: <span className={status === "success" ? "text-admin-success" : status === "needs_check" ? "text-admin-warning" : "text-admin-fg"}>{GAMES_ITEM_STATUS[status] ?? (status || "—")}</span>{detail.sk_invoice ? ` · Invoice ${detail.sk_invoice}` : ""}</p>}
    {detail?.sn && <p className="break-all font-mono text-xs text-admin-fg">SN: {detail.sn}</p>}
    {detail?.last_error && status !== "success" && <p className="break-words text-xs text-admin-warning">Catatan: {detail.last_error}</p>}
    {detail && typeof detail.cost === "number" && <p className="text-xs text-admin-muted">Modal Sekalipay: {formatRupiah(detail.cost)}</p>}
    <p className="pt-1 font-semibold text-admin-fg">{formatRupiah(order.paymentAmount)}</p>
    {canRecheck && <div className="border-t border-admin-border pt-3">
      <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void recheck()}>{busy ? "Mengecek Sekalipay…" : "Cek ulang Sekalipay"}</Button>
      <p className="mt-1 text-[11px] text-admin-muted">Menarik status transaksi yang sudah dikirim (tanpa membeli ulang).</p>
    </div>}
    {result && <p role="status" className="text-xs text-admin-fg">{result}</p>}
  </div>;
}

/** Catat refund/replace order ini sebagai pengeluaran (16 Nov 2026); masuk Untung Bersih Ringkasan. */
function RefundReplaceAction({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-admin-border p-3">
    <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>Catat refund/replace</Button>
    <ExpenseFormSheet open={open} onOpenChange={setOpen} draft={{ category: "refund", order_code: order.code, amount: order.paymentAmount > 0 ? order.paymentAmount : undefined }}
      onSaved={() => { toast.success(`Dicatat sebagai pengeluaran untuk ${order.code}.`); onChanged(); }} />
  </div>;
}

function ActionDialog({ action, note, setNote, saving, onClose, onConfirm }: { action: NonNullable<ActionState>; note: string; setNote: (value: string) => void; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const copy = { paid: ["Konfirmasi pesanan lunas?", "Lisensi / key / catatan untuk pembeli", "Konfirmasi lunas"], paid_qris: ["ACC pembayaran QRIS?", "Hasil cek mutasi merchant sesuai invoice (wajib, min. 10 karakter) - cth: mutasi Rp18.286 masuk 12.45 dari TULISIRFAN", "ACC & lunaskan"], handover: ["Kirim ke pembeli", "Catatan internal (opsional)", "Kirim ke pembeli"], approve: ["Mutasi pembayaran sudah cocok?", "Catatan opsional", "Setujui & lunaskan"], reject: ["Tolak bukti pembayaran?", "Alasan penolakan wajib diisi", "Tolak bukti"], cancel: ["Batalkan pesanan?", "Alasan atau catatan pembatalan", "Batalkan pesanan"] }[action.kind];
  const danger = ["reject", "cancel"].includes(action.kind);
  const noteRequired = action.kind === "reject" || action.kind === "paid_qris";
  return <AdminDialog title={copy[0]} onClose={onClose} busy={saving}>{action.kind === "paid_qris" && <div className="rounded-xl border border-admin-warning/25 bg-admin-warning/10 p-3 text-xs leading-5 text-admin-warning">Pastikan dana benar masuk di mutasi merchant sesuai invoice dengan nominal persis {formatRupiah(action.order.paymentAmount)}. ACC melunaskan pesanan dan menjadwalkan pengiriman serta notifikasi - tidak bisa dibatalkan.</div>}<div className="flex flex-wrap items-center gap-2">
<span className="break-all font-mono text-xs font-semibold text-admin-fg">{action.order.code}</span>
<StatusBadge status={action.order.status} />
<ChannelBadge channel={action.order.salesChannel} />
<MethodBadge method={action.order.method} />
</div>
<p className="mt-3 text-sm text-admin-muted">{action.order.name}</p>
<Label className="mt-4 block">
<span className="text-sm font-medium">{copy[1]}</span>
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
<span className="break-all font-mono text-xs font-semibold text-admin-fg">{order.code}</span>
<StatusBadge status={order.status} />
<ChannelBadge channel={order.salesChannel} />
</div>
<p className="mt-3 text-sm text-admin-muted">{order.name}</p>
    {state.loading ? <p className="mt-4 text-sm text-admin-muted">Memuat item...</p>
      : state.error ? <p role="alert" className="mt-4 text-sm text-admin-danger">{state.error}</p>
      : <>
        <p className="mt-3 text-xs leading-5 text-admin-muted">{destination}</p>
        {pending.map((item) => <Label key={item.item_index} className="mt-4 block">
<span className="text-sm font-medium">Detail untuk pembeli · {item.label || `Item ${item.item_index + 1}`}</span>
<Textarea value={messages[item.item_index] ?? ""} onChange={(event) => setMessages({ ...messages, [item.item_index]: event.target.value })} rows={4} maxLength={4000} placeholder="Akun, link undangan, atau instruksi. Kosongkan bila produk sudah kamu kirim lewat WA." className="mt-2 w-full resize-y rounded-xl border border-admin-border bg-admin-subtle p-3 font-mono text-sm text-admin-fg placeholder:font-sans placeholder:text-admin-muted focus:border-admin-accent/50 focus:outline-none" />
</Label>)}
        <Label className="mt-4 block">
<span className="text-sm font-medium">Catatan internal (opsional, tidak dikirim ke pembeli)</span>
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
  const label = status === "manual_required" ? "Perlu tindakan"
    : status === "failed" ? "Gagal kirim"
    : status === "queued" ? "Antre kirim"
    : status === "sending" ? "Mengirim…"
    : status === "retry" ? "Menunggu percobaan ulang"
    : "Perlu diperiksa";
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
function formatOrderTime(value: string) {
  const currentYear = formatWibDateTime(new Date().toISOString(), { year: "numeric" });
  const year = formatWibDateTime(value, { year: "numeric" });
  return formatWibDateTime(value, { day: "numeric", month: "short", ...(year !== currentYear ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" })?.replace(",", "") ?? "—";
}
function normalizePedia(raw: unknown): PediaSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const status = typeof value.status === "string" && value.status ? value.status : "";
  if (!status) return null;
  return { status, quantity: knownCount(value.quantity), done: knownCount(value.done), target: typeof value.target === "string" && value.target ? value.target : null, lastError: typeof value.last_error === "string" && value.last_error ? value.last_error : null };
}
function normalizeOrder(raw: Record<string, unknown>): Order { const code = String(raw.code || ""); const kind: Order["kind"] = raw.order_kind === "games" || /^AXG-/.test(code) ? "games" : raw.order_kind === "pedia" || (raw.order_kind == null && /^AXP-/.test(code)) ? "pedia" : "apps"; return { kind, pedia: kind === "pedia" ? normalizePedia(raw.pedia) : null, code, name: String(raw.customer_name || ""), wa: String(raw.customer_wa || ""), email: String(raw.customer_email || ""), method: String(raw.payment_method || ""), items: Array.isArray(raw.items) ? raw.items as Order["items"] : [], subtotal: Number(raw.subtotal || 0), paymentAmount: Number(raw.payment_amount || raw.subtotal || 0), status: String(raw.status || "pending"), paymentStatus: String(raw.payment_status || "unpaid"), fulfillmentStatus: raw.fulfillment_status ? String(raw.fulfillment_status) : undefined, salesChannel: (["web", "telegram", "whatsapp"].includes(String(raw.sales_channel)) ? raw.sales_channel : "web") as OrderChannel, fileName: raw.proof_url ? String(raw.proof_url) : undefined, proofId: raw.proof_id == null ? undefined : Number(raw.proof_id), proofStatus: (["submitted", "approved", "rejected"].includes(String(raw.proof_status)) ? raw.proof_status : undefined) as Order["proofStatus"], proofClaimedMethod: raw.proof_claimed_method as Order["proofClaimedMethod"], proofRejectionReason: raw.proof_rejection_reason ? String(raw.proof_rejection_reason) : undefined, adminNote: raw.admin_note ? String(raw.admin_note) : undefined, createdAt: String(raw.created_at || ""), supplierLinks: Array.isArray(raw.supplier_links) ? raw.supplier_links as SupplierLink[] : [] }; }
