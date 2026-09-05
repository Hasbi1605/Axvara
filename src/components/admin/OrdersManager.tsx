"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatRupiah } from "@/lib/utils";
import { IosIcon } from "@/components/ui/IosIcon";
import { Spinner } from "@/components/ui/Loading";
import { ProofThumbnail } from "@/components/admin/ProofThumbnail";
import { useToast } from "@/components/ui/Toast";

type OrderChannel = "web" | "telegram" | "whatsapp";
type Order = {
  code: string; name: string; wa: string; email: string; method: string;
  items: { name: string; price: number; qty: number }[];
  subtotal: number; paymentAmount: number; status: string; paymentStatus: string;
  salesChannel: OrderChannel; fileName?: string; proofId?: number;
  proofStatus?: "submitted" | "approved" | "rejected";
  proofClaimedMethod?: "QRIS" | "SEABANK" | "EWALLET";
  proofRejectionReason?: string; adminNote?: string; createdAt: string;
};
type ApiData = {
  orders?: Record<string, unknown>[];
  pagination?: { page: number; limit: number; total: number; pages: number };
  stats?: { total: number; pending: number; paid: number; revenue: number };
  counts?: { channels?: Record<string, number>; statuses?: Record<string, number> };
  methods?: string[];
  error?: string;
};
type ActionState = { kind: "paid" | "approve" | "reject" | "cancel"; order: Order } | null;

const PER_PAGE = 8;
const inputClass = "h-10 w-full rounded-xl border border-white/10 bg-white/[0.055] px-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40";

export function OrdersManager({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const initial = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [channel, setChannel] = useState(initial.get("channel") || "all");
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
  const [saving, setSaving] = useState(false);

  const requestParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE) });
    if (channel !== "all") params.set("channel", channel);
    if (status !== "all") params.set("status", status);
    if (method !== "all") params.set("method", method);
    if (proof) params.set("proof", proof);
    if (query) params.set("q", query);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return params;
  }, [channel, status, method, proof, query, dateFrom, dateTo, page]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/orders?${requestParams}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as ApiData;
      if (!response.ok) throw new Error(data.error || "Gagal memuat pesanan");
      setOrders((data.orders || []).map(normalizeOrder));
      setPage(Number(data.pagination?.page || 1));
      setPages(Number(data.pagination?.pages || 1));
      setTotal(Number(data.pagination?.total || 0));
      setStats(data.stats || { total: 0, pending: 0, paid: 0, revenue: 0 });
      setCounts(data.counts?.channels || {});
      setMethods(data.methods || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal memuat pesanan"); }
    finally { setLoading(false); }
  }, [requestParams]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const key of ["channel", "status", "method", "proof", "q", "date_from", "date_to", "page"]) url.searchParams.delete(key);
    requestParams.forEach((value, key) => { if (key !== "limit") url.searchParams.set(key, value); });
    history.replaceState(null, "", `${url.pathname}?${url.searchParams}`);
  }, [requestParams]);

  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const clearFilters = () => { setChannel("all"); setStatus("all"); setMethod("all"); setProof(""); setDraftQuery(""); setQuery(""); setDateFrom(""); setDateTo(""); setPage(1); };
  const exportHref = `/api/admin/orders?${new URLSearchParams([...requestParams.entries()].filter(([key]) => !["page", "limit"].includes(key)).concat([["export", "csv"]])).toString()}`;

  const runAction = async () => {
    if (!action) return;
    if (action.kind === "reject" && !actionNote.trim()) { toast.error("Alasan penolakan wajib diisi."); return; }
    setSaving(true);
    try {
      if (action.kind === "approve" || action.kind === "reject") {
        if (!action.order.proofId) throw new Error("Bukti pembayaran belum tersedia.");
        const response = await fetch(`/api/admin/proofs/${action.order.proofId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action.kind, reason: actionNote.trim() || undefined }) });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Review bukti gagal");
        toast.success(action.kind === "approve" ? "Mutasi cocok dan pesanan dikonfirmasi lunas." : "Bukti ditolak.");
      } else {
        const nextStatus = action.kind === "paid" ? "lunas" : "dibatalkan";
        const response = await fetch(`/api/admin/orders/${encodeURIComponent(action.order.code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus, admin_note: actionNote.trim() || undefined }) });
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(data.error || "Gagal memperbarui pesanan");
        toast.success(action.kind === "paid" ? "Pesanan dikonfirmasi lunas." : "Pesanan dibatalkan.");
      }
      setAction(null); setActionNote(""); setSelected(null);
      await load(); onChanged?.();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Tindakan gagal"); }
    finally { setSaving(false); }
  };

  const channelTabs = [["all", "Semua", stats.total], ["web", "Web", counts.web || 0], ["telegram", "Telegram", counts.telegram || 0], ["whatsapp", "WhatsApp", counts.whatsapp || 0]] as const;

  return <div className="mt-4 space-y-4">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[["Total pesanan", stats.total, "text-white"], ["Pending", stats.pending, "text-[#FFB800]"], ["Lunas", stats.paid, "text-emerald-300"], ["Omzet", formatRupiah(stats.revenue), "text-white"]].map(([label, value, tone]) => <div key={String(label)} className="ax-glass rounded-2xl p-4"><p className="text-[11px] uppercase tracking-wide text-white/50">{label}</p><p className={`mt-1 font-display text-xl font-bold sm:text-2xl ${tone}`}>{loading ? "—" : value}</p></div>)}
    </div>

    <section className="ax-glass overflow-hidden rounded-[20px]">
      <header className="border-b border-white/10 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5"><IosIcon name="purchase-order" size={17} tint="white" /></span><div><h2 className="text-sm font-semibold text-white">Pesanan</h2><p className="mt-0.5 text-[11px] text-white/40">Cari, filter, periksa pembayaran, dan proses fulfillment.</p></div><a href={exportHref} className="ml-auto inline-flex h-9 items-center gap-2 rounded-xl border border-[#00E5FF]/25 bg-[#00E5FF]/10 px-3 text-xs font-semibold text-[#5cefff]"><IosIcon name="external-link" size={13} tint="#00E5FF" /> Export CSV</a></div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex" role="tablist" aria-label="Filter kanal pesanan">{channelTabs.map(([value, label, count]) => <button key={value} role="tab" aria-selected={channel === value} onClick={() => changeFilter(setChannel, value)} className={`inline-flex h-9 items-center justify-between gap-2 rounded-xl border px-3 text-xs font-semibold sm:justify-center ${channel === value ? "border-[#00E5FF]/40 bg-[#00E5FF] text-[#07101f]" : "border-white/10 bg-white/[0.05] text-white/60"}`}>{label}<span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">{count}</span></button>)}</div>
        <div className="mt-3 grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(130px,.7fr))_auto]">
          <form onSubmit={(event) => { event.preventDefault(); setQuery(draftQuery.trim()); setPage(1); }}><label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/35" htmlFor="order-search">Pencarian</label><div className="relative"><IosIcon name="search" size={15} tint="white" className="absolute left-3 top-3 opacity-45" /><input id="order-search" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} className={`${inputClass} pl-9`} placeholder="Kode, nama, WA, produk…" /></div></form>
          <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/35">Status</span><select value={status} onChange={(event) => changeFilter(setStatus, event.target.value)} className={inputClass}><option value="all">Semua status</option><option value="pending">Pending</option><option value="lunas">Lunas</option><option value="dibatalkan">Dibatalkan</option><option value="kadaluarsa">Kedaluwarsa</option></select></label>
          <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/35">Pembayaran</span><select value={method} onChange={(event) => changeFilter(setMethod, event.target.value)} className={inputClass}><option value="all">Semua pembayaran</option><option value="qris">QRIS</option><option value="manual">Transfer manual</option>{methods.filter((item) => !["qris"].includes(item)).map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/35">Dari tanggal</span><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} className={inputClass} /></label>
          <label className="block"><span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-white/35">Sampai tanggal</span><input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} className={inputClass} /></label>
          <button onClick={clearFilters} className="h-10 whitespace-nowrap rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/55 hover:bg-white/5">Reset</button>
        </div>
      </header>

      {error ? <div className="m-4 flex items-center justify-between gap-3 rounded-xl border border-red-400/20 bg-red-500/10 p-3 text-sm text-red-200"><span>{error}</span><button onClick={() => void load()} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#080C1E]">Coba lagi</button></div> : loading ? <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-white/45"><Spinner size={22} /> Memuat pesanan…</div> : orders.length === 0 ? <p className="p-10 text-center text-sm text-white/40">Tidak ada pesanan yang cocok dengan filter.</p> : <div className="divide-y divide-white/[0.06]">{orders.map((order) => <OrderRow key={order.code} order={order} onDetail={() => setSelected(order)} onAction={(kind) => { setAction({ kind, order }); setActionNote(""); }} />)}</div>}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-xs text-white/40 sm:px-5"><span>Hal {page} dari {pages} · {total} pesanan</span><div className="flex gap-2"><button disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} className="h-8 rounded-lg border border-white/10 px-3 disabled:opacity-30">Sebelumnya</button><button disabled={page >= pages || loading} onClick={() => setPage((current) => Math.min(pages, current + 1))} className="h-8 rounded-lg border border-white/10 px-3 disabled:opacity-30">Berikutnya</button></div></footer>
    </section>

    {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onAction={(kind) => { setSelected(null); setAction({ kind, order: selected }); setActionNote(""); }} />}
    {action && <ActionDialog action={action} note={actionNote} setNote={setActionNote} saving={saving} onClose={() => !saving && setAction(null)} onConfirm={() => void runAction()} />}
  </div>;
}

function OrderRow({ order, onDetail, onAction }: { order: Order; onDetail: () => void; onAction: (kind: NonNullable<ActionState>["kind"]) => void }) {
  const qris = order.method.toLowerCase() === "qris";
  return <article className="grid gap-4 px-4 py-4 hover:bg-white/[0.025] sm:px-5 lg:grid-cols-[136px_minmax(0,1fr)_auto] lg:items-center">
    {qris && !order.fileName ? <div className="flex h-[90px] items-center justify-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] px-3 text-center"><div><p className="text-xs font-semibold text-emerald-300">QRIS otomatis</p><p className="mt-1 text-[10px] leading-4 text-white/35">Tidak perlu bukti. Menunggu QRIS Hook.</p></div></div> : <ProofThumbnail proof={order.fileName} />}
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><button onClick={onDetail} className="font-mono text-xs font-bold text-[#00E5FF] hover:underline">{order.code}</button><StatusBadge status={order.status} /><span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase text-white/45">{order.salesChannel}</span></div><p className="mt-2 truncate text-sm font-semibold text-white">{order.name || "Tanpa nama"}</p><p className="mt-0.5 truncate text-xs text-white/40">{order.wa || order.email || "Kontak tidak tersedia"}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-white/50">{order.items.map((item) => `${item.name} ×${item.qty}`).join(", ")} · {order.method.toUpperCase()} · {formatRupiah(order.paymentAmount)}</p>{qris && order.fileName && <p className="mt-1 text-[10px] text-emerald-300/65">Bukti hanya referensi; status pembayaran tetap dari QRIS Hook.</p>}</div>
    <div className="flex flex-wrap gap-2 lg:max-w-[310px] lg:justify-end"><button onClick={onDetail} className="h-9 rounded-full border border-white/10 bg-white/[0.05] px-3 text-xs font-semibold text-white/65">Detail</button>{order.status === "pending" && <>{qris ? <span className="inline-flex h-9 items-center rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 text-xs text-emerald-300">Menunggu Hook</span> : order.salesChannel === "whatsapp" ? order.proofId && order.proofStatus === "submitted" ? <><button onClick={() => onAction("approve")} className="h-9 rounded-full bg-emerald-500 px-3 text-xs font-bold text-white">Mutasi cocok</button><button onClick={() => onAction("reject")} className="h-9 rounded-full border border-red-400/20 bg-red-500/10 px-3 text-xs font-semibold text-red-200">Tolak</button></> : <span className="inline-flex h-9 items-center rounded-full border border-white/10 px-3 text-xs text-white/45">Menunggu bukti</span> : <button onClick={() => onAction("paid")} className="h-9 rounded-full bg-emerald-500 px-3 text-xs font-bold text-white">Konfirmasi lunas</button>}<button onClick={() => onAction("cancel")} className="h-9 rounded-full border border-white/10 px-3 text-xs font-semibold text-white/55">Batalkan</button></>}</div>
  </article>;
}

function OrderDetail({ order, onClose, onAction }: { order: Order; onClose: () => void; onAction: (kind: NonNullable<ActionState>["kind"]) => void }) {
  const qris = order.method.toLowerCase() === "qris";
  return <AdminDialog title="Detail pesanan" onClose={onClose}><div className="space-y-4"><div><p className="font-mono text-sm font-bold text-[#00E5FF]">{order.code}</p><p className="mt-1 text-xs text-white/40">{formatDate(order.createdAt)} · {order.salesChannel.toUpperCase()}</p></div><div className="grid grid-cols-2 gap-3 text-sm"><Info label="Pelanggan" value={order.name || "—"} /><Info label="WhatsApp" value={order.wa || "—"} /><Info label="Email" value={order.email || "—"} /><Info label="Pembayaran" value={`${order.method.toUpperCase()} · ${formatRupiah(order.paymentAmount)}`} /></div><div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-white/40">Item</p>{order.items.map((item, index) => <div key={`${item.name}-${index}`} className="mt-3 flex justify-between gap-4 text-sm"><span className="text-white/70">{item.name} ×{item.qty}</span><span className="font-semibold text-white">{formatRupiah(item.price * item.qty)}</span></div>)}</div>{qris ? <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3 text-xs text-emerald-200">QRIS diproses otomatis. Bukti gambar, jika ada, hanya dipakai sebagai referensi.</div> : order.fileName ? <ProofThumbnail proof={order.fileName} /> : null}{order.adminNote && <Info label="Catatan admin" value={order.adminNote} />}{order.status === "pending" && <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">{!qris && (order.salesChannel !== "whatsapp" ? <button onClick={() => onAction("paid")} className="h-10 rounded-full bg-emerald-500 px-4 text-sm font-bold text-white">Konfirmasi lunas</button> : order.proofStatus === "submitted" && <button onClick={() => onAction("approve")} className="h-10 rounded-full bg-emerald-500 px-4 text-sm font-bold text-white">Mutasi cocok</button>)}<button onClick={() => onAction("cancel")} className="h-10 rounded-full border border-red-400/20 bg-red-500/10 px-4 text-sm font-semibold text-red-200">Batalkan pesanan</button></div>}</div></AdminDialog>;
}

function ActionDialog({ action, note, setNote, saving, onClose, onConfirm }: { action: NonNullable<ActionState>; note: string; setNote: (value: string) => void; saving: boolean; onClose: () => void; onConfirm: () => void }) {
  const copy = { paid: ["Konfirmasi pesanan lunas?", "Lisensi / key / catatan untuk pembeli", "Konfirmasi lunas"], approve: ["Mutasi pembayaran sudah cocok?", "Catatan opsional", "Setujui & lunaskan"], reject: ["Tolak bukti pembayaran?", "Alasan penolakan wajib diisi", "Tolak bukti"], cancel: ["Batalkan pesanan?", "Alasan atau catatan pembatalan", "Batalkan pesanan"] }[action.kind];
  return <AdminDialog title={copy[0]} onClose={onClose}><p className="text-sm text-white/55">Pesanan <span className="font-mono font-bold text-[#00E5FF]">{action.order.code}</span> · {action.order.name}</p><label className="mt-4 block"><span className="text-xs font-semibold text-white/55">{copy[1]}</span><textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.055] p-3 text-sm text-white outline-none focus:border-[#00E5FF]/40" /></label><div className="mt-5 flex justify-end gap-2"><button disabled={saving} onClick={onClose} className="h-10 rounded-full border border-white/10 px-4 text-sm text-white/60">Batal</button><button disabled={saving} onClick={onConfirm} className={`inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold text-white disabled:opacity-50 ${["reject", "cancel"].includes(action.kind) ? "bg-red-500" : "bg-emerald-500"}`}>{saving && <Spinner size={14} />}{copy[2]}</button></div></AdminDialog>;
}

function AdminDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; document.addEventListener("keydown", key); return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", key); }; }, [onClose]);
  return <div className="fixed inset-0 z-[80] isolate flex items-end justify-center bg-[#040612]/95 p-0 sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className="relative z-10 max-h-[94vh] w-full overflow-y-auto rounded-t-[26px] border border-white/10 bg-[#0B1025] p-5 shadow-[0_30px_100px_rgba(0,0,0,.8)] sm:max-w-xl sm:rounded-[26px] sm:p-6"><header className="mb-5 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">{title}</h2><button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10" aria-label="Tutup dialog"><IosIcon name="close" size={14} tint="white" /></button></header>{children}</section></div>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-white/[0.035] p-3"><p className="text-[10px] uppercase tracking-wide text-white/35">{label}</p><p className="mt-1 break-words text-sm text-white/75">{value}</p></div>; }
function StatusBadge({ status }: { status: string }) { return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold capitalize ${status === "pending" ? "border-[#FFB800]/20 bg-[#FFB800]/10 text-[#FFCF55]" : status === "lunas" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/[0.05] text-white/45"}`}>{status}</span>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(date); }
function normalizeOrder(raw: Record<string, unknown>): Order { return { code: String(raw.code || ""), name: String(raw.customer_name || ""), wa: String(raw.customer_wa || ""), email: String(raw.customer_email || ""), method: String(raw.payment_method || ""), items: Array.isArray(raw.items) ? raw.items as Order["items"] : [], subtotal: Number(raw.subtotal || 0), paymentAmount: Number(raw.payment_amount || raw.subtotal || 0), status: String(raw.status || "pending"), paymentStatus: String(raw.payment_status || "unpaid"), salesChannel: (["web", "telegram", "whatsapp"].includes(String(raw.sales_channel)) ? raw.sales_channel : "web") as OrderChannel, fileName: raw.proof_url ? String(raw.proof_url) : undefined, proofId: raw.proof_id == null ? undefined : Number(raw.proof_id), proofStatus: (["submitted", "approved", "rejected"].includes(String(raw.proof_status)) ? raw.proof_status : undefined) as Order["proofStatus"], proofClaimedMethod: raw.proof_claimed_method as Order["proofClaimedMethod"], proofRejectionReason: raw.proof_rejection_reason ? String(raw.proof_rejection_reason) : undefined, adminNote: raw.admin_note ? String(raw.admin_note) : undefined, createdAt: String(raw.created_at || "") }; }
