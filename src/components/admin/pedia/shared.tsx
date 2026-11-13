"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pediaBounds } from "@/lib/pedia/bounds";
import { pediaMargin } from "@/lib/pedia/pricing";
import { pediaServiceHealth } from "@/lib/pedia/service-stats";
import { Button, Label, Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/admin/ui";
import { buttonVariants } from "@/components/admin/ui/button";
import { cn } from "@/lib/utils";

export type Row = Record<string, unknown>;
export type Product = {
  id: number; slug: string; platform: string; metric: string; target_kind: string;
  name: string; tagline: string | null; description_md?: string | null; checklist_json?: string;
  packages_json: string; step: number; sort_order: number; is_active: number; is_featured: number;
};
export type Tier = {
  id: number; product_id: number; tier: string; label_note: string | null;
  supplier: "indosmm"; supplier_service_id: number; backup_service_id: number | null;
  price_group: string; markup_pct: number; min_profit_rp: number; refill_days: number;
  eta_start: string | null; eta_finish: string | null; package_prices_json: string; is_active: number;
  auto_disabled_reason: string | null; live_rate?: number | null; live_min?: number | null; live_max?: number | null;
  live_present?: number | null; live_name?: string | null; live_type?: string | null; live_api_refill?: number | null;
  min_qty_override?: number | null; max_qty_override?: number | null; quantity_step?: number;
  region?: "indonesia" | "global" | "mixed"; quality?: "ekonomis" | "standar" | "hq" | "real";
  is_recommended?: number; speed_note?: string | null; drop_risk?: "rendah" | "sedang" | "tinggi";
  public_name?: string | null; description_md?: string | null; terms_md?: string | null; instructions_md?: string | null;
  recommendation_note?: string | null; speed_per_day?: string | null; drop_label?: string | null; input_kind?: string | null;
  target_format?: "url" | "username"; refill_anchor?: "created" | "completed";
};
export type Catalog = { products: Product[]; tiers: Tier[] };
export type ProviderHealth = { supplier: string; balance: { value: number | null; stale: boolean; history?: { created_at: string }[] }; error: string | null; pricing_verified: boolean; last_sync_at: string | null };

/** Kelas kontrol lama yang masih dipakai panel; primitif Input/Textarea sudah memuatnya. */
export const INPUT = "";
export const BUTTON = buttonVariants({ variant: "outline", size: "sm" });
export const PRIMARY = buttonVariants({ size: "default" });
export const EDIT = buttonVariants({ size: "sm" });

export const TIER_ORDER = ["hemat", "standar", "premium"];
export const STATUS: Record<string, string> = { awaiting_payment: "Menunggu pembayaran", queued: "Antrean", submitting: "Sedang dikirim", submitted: "Diproses", in_progress: "Berjalan", completed: "Selesai", partial: "Selesai sebagian", canceled: "Dibatalkan", needs_check: "Perlu diperiksa", expired: "Kedaluwarsa" };
export function parse<T>(raw: unknown, fallback: T): T { try { return JSON.parse(String(raw)) ?? fallback; } catch { return fallback; } }
export function packagesOf(p: Product): number[] {
  const values = parse<unknown>(p.packages_json, []);
  return Array.isArray(values) ? values.map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
}
export function usablePackages(p: Product, t: Tier): number[] {
  const prices = parse<Record<string, number>>(t.package_prices_json, {});
  const bounds = pediaBounds({ min_qty: t.live_min, max_qty: t.live_max }, t, p.step);
  return packagesOf(p).filter(qty => bounds && qty >= bounds.min && qty <= bounds.max && t.supplier === "indosmm" && qty % bounds.step === 0 && t.live_present === 1 && t.live_type === "Default" &&
    t.live_rate != null && Number.isFinite(Number(t.live_rate)) && Number(t.live_rate) > 0 && t.live_min != null && t.live_max != null && qty >= t.live_min && qty <= t.live_max &&
    Number.isFinite(Number(prices[qty])) && Number(prices[qty]) > 0 && pediaMargin({ supplierRatePer1k: Number(t.live_rate), quantity: qty, sellPrice: Number(prices[qty]) }) >= t.min_profit_rp);
}
export function productStatus(p: Product, tiers: Tier[]) {
  if (!p.is_active) return { label: "Nonaktif", reason: "", style: "text-admin-muted", variant: "secondary" as const };
  if (tiers.some(t => t.is_active && usablePackages(p, t).length)) return { label: "Siap dijual", reason: "", style: "text-admin-success", variant: "success" as const };
  const active = tiers.filter(t => t.is_active);
  const reason = !active.length ? "Belum ada varian aktif" : active.every(t => !Object.values(parse<Record<string, number>>(t.package_prices_json, {})).some(v => Number(v) > 0)) ? "Belum ada harga" : "Periksa batas jumlah, layanan, dan margin";
  return { label: "Aktif, belum bisa dijual", reason, style: "text-admin-warning", variant: "warning" as const };
}
export function needsAction(r: Row) { return r.status === "needs_check" || r.followup_state === "open" || ["manual_requested", "needs_check", "requested"].includes(String(r.refill_status)); }
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    const messages: Record<string, string> = {
      unauthorized: "Sesi admin berakhir. Masuk kembali.", save_failed: "Perubahan gagal disimpan.", load_failed: "Data gagal dimuat. Coba lagi.", not_found: "Data tidak ditemukan. Muat ulang daftar.", proxy_failed: "Supplier belum dapat dihubungi. Coba lagi.",
      max_attempts: "Batas percobaan tercapai.", not_needs_check: "Status pesanan sudah berubah. Muat ulang daftar.", reprice_failed: "Perubahan tersimpan, tetapi harga belum berhasil diperbarui. Muat ulang dan periksa layanan.", save_partial: "Sebagian pengaturan tersimpan. Muat ulang sebelum menyimpan kembali.",
      unsupported_currency: "Mata uang akun belum terverifikasi IDR.", pricing_unverified: "Tarif per 1.000 belum terverifikasi.", provider_unavailable: "IndoSMM belum dapat dihubungi.", service_unavailable: "Layanan tidak tersedia atau tidak kompatibel dengan link dan jumlah.", provider_retired: "Penjualan baru hanya memakai IndoSMM.", premium_tool_excluded: "Tools premium tidak dimasukkan ke Pedia SMM.", supplier_service_pair_required: "Pilih ID layanan IndoSMM.", reconcile_required: "Hasil pengiriman belum pasti. Periksa ID order di IndoSMM sebelum tindakan lain.", supplier_order_conflict: "ID order sudah terhubung ke pesanan lain.",
    };
    const error = new Error(messages[data?.error] || "Permintaan gagal. Muat ulang lalu coba lagi.");
    Object.assign(error, { saved: data?.saved === true, id: data?.id }); throw error;
  }
  return data as T;
}
export function usePanel<T>(url: string, initial: T) {
  const [data, setData] = useState(initial), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const generation = useRef(0), writing = useRef(false);
  const load = useCallback(async () => {
    const current = ++generation.current; setLoading(true); setError("");
    try { const next = await request<T>(url); if (current === generation.current) setData(next); return true; }
    catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Gagal memuat data."); return false; }
    finally { if (current === generation.current) setLoading(false); }
  }, [url]);
  useEffect(() => { const pending = generation; void load(); return () => { pending.current++; }; }, [load]);
  async function write(path: string, body: Row, message: string, method = "PUT") {
    if (writing.current) return null;
    writing.current = true; setBusy(true); setError(""); setSuccess("");
    try { const result = await request<Row>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const refreshed = await load(); if (Array.isArray(result.errors) && result.errors.length) throw new Error("Perubahan tersimpan sebagian. Muat ulang sebelum mencoba lagi."); setSuccess(`${message}${refreshed ? "" : " Daftar belum berhasil dimuat ulang."}`); return result; }
    catch (e) { const saved = e instanceof Error && "saved" in e && e.saved === true; await load(); setError(e instanceof Error ? e.message : "Gagal menyimpan perubahan."); return saved ? { saved: true, id: "id" in e ? e.id : undefined } : null; }
    finally { writing.current = false; setBusy(false); }
  }
  return { data, loading, busy, error, success, load, write, setError, setSuccess };
}
export type PanelState<T> = ReturnType<typeof usePanel<T>>;

/** Umpan balik status panel (loading/busy/error/sukses) dengan aksi coba lagi. */
export function Feedback({ panel }: { panel: Pick<PanelState<unknown>, "loading" | "busy" | "error" | "success" | "load"> }) {
  return <div aria-live="polite" className="space-y-2 text-sm">
    {panel.loading && <p role="status" className="text-admin-muted">Memuat data...</p>}
    {panel.busy && <p role="status" className="text-admin-accent">Menyimpan perubahan...</p>}
    {panel.error && <div role="alert" className="rounded-md border border-admin-danger/30 bg-admin-danger/10 px-3 py-2 text-admin-danger">
      <p>{panel.error}</p>
      <Button variant="outline" size="sm" className="mt-2" disabled={panel.busy || panel.loading} onClick={() => void panel.load()}>Coba lagi</Button>
    </div>}
    {panel.success && <p role="status" className="text-admin-success">{panel.success}</p>}
  </div>;
}

/** Label + kontrol form (gap rapat label→input, asosiasi implisit lewat <label>). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <Label className="block min-w-0 space-y-2 text-xs font-medium text-admin-muted"><span className="block">{label}</span>{children}</Label>;
}

/** Bagian panel: header judul + deskripsi muted. */
export function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="mt-4 min-w-0"><header className="mb-4"><h3 className="text-base font-semibold text-admin-fg">{title}</h3><p className="mt-1 text-sm leading-5 text-admin-muted">{description}</p></header>{children}</section>;
}

export function DataTable({ title, columns, children }: { title: string; columns: string[]; children: ReactNode }) {
  return <div className="rounded-md border border-admin-border">
    <Table>
      <caption className="sr-only">{title}</caption>
      <TableHeader><TableRow>{columns.map(column => <TableHead key={column} className="text-sm">{column}</TableHead>)}</TableRow></TableHeader>
      <TableBody className="[&_td]:align-top [&_td]:break-words">{children}</TableBody>
    </Table>
  </div>;
}

export function Pagination({ page, total, size, loading, onPage }: { page: number; total: number; size: number; loading: boolean; onPage: (page: number) => void }) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
    <span className="text-xs text-admin-muted">Halaman {page} / {Math.max(1, Math.ceil(total / size))} · {total} hasil</span>
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}><ChevronLeft /> Sebelumnya</Button>
      <Button variant="outline" size="sm" disabled={page * size >= total || loading} onClick={() => onPage(page + 1)}>Berikutnya <ChevronRight /></Button>
    </div>
  </div>;
}

export function HealthLine({ row }: { row: Row }) {
  const health = pediaServiceHealth({ orders_7d: row.stat_orders, success_rate: row.stat_success, cancel_rate: row.stat_cancel, ai_score: row.stat_score });
  return <p className={cn("text-xs", health === "berisiko" ? "text-admin-danger" : "text-admin-muted")}>{health === "belum_ada_data" ? "Belum ada data 7 hari" : `${health === "sehat" ? "Sehat" : health === "cukup" ? "Cukup" : "Berisiko"} · ${Number(row.stat_orders)} pesanan/7 hari · success ${Math.round(Number(row.stat_success))}% · cancel ${Math.round(Number(row.stat_cancel))}%`}</p>;
}
