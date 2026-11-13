"use client";
// src/components/admin/SupplierLinkActions.tsx — Status supplier (WR/SK) +
// Retry / Batal / Cek status langsung di baris Pesanan (insiden 2026-10-10).
//
// Masalah: order WR/SK yang tertahan (saldo supplier habis, antre, diproses)
// di menu Pesanan hanya tampil "Perlu handover" — tanpa sebab dan tanpa tombol
// apa pun selain "Kirim ke pembeli". Tombol Retry/Batal hanya ada di tab
// Warung Rebahan/Sekalipay, sehingga setelah top-up saldo admin mengira order
// tidak bisa diulang dan akhirnya menyerahkan semuanya manual.
// Komponen ini memakai endpoint admin yang SAMA (CAS berpagar, tanpa jalur baru).

import { useId, useState } from "react";
import { IosIcon } from "@/components/admin/AdminIcon";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";

export type SupplierLink = {
  supplier: "wr" | "sk" | "tunvn";
  id: number;
  status: string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  supplier_order_id: string | null;
  delivery_status: string | null;
  can_retry?: boolean;
  can_reconcile?: boolean;
  item_index?: number;
  purchase_disabled?: boolean;
};

const SUPPLIER_NAME = { wr: "Warung Rebahan", sk: "Sekalipay", tunvn: "TUNVN" } as const;

export const TUNVN_ERROR_LABEL: Record<string,string> = {
  insufficient_balance: "Saldo supplier TUNVN tidak cukup. Top up saldo TUNVN, lalu tekan Retry.",
  balance_unavailable: "Saldo TUNVN belum dapat diperiksa. Pembelian belum dikirim; coba Retry setelah koneksi pulih.",
  catalog_unavailable: "Katalog TUNVN belum dapat diperiksa. Pembelian belum dikirim.",
  stock_unavailable: "Stok supplier belum tersedia. Pembelian belum dikirim.",
  buff_unavailable: "Layanan Buff atau kode tujuan belum dapat diverifikasi. Pembelian belum dikirim.",
  cost_changed: "Order tertahan pemeriksaan modal versi lama. Retry memakai harga supplier terkini tanpa batas modal snapshot.",
  dispatch_unconfirmed: "Proses TUNVN belum terkonfirmasi. Retry hanya tersedia bila belum ada penanda pembelian.",
  buff_status_unavailable: "Status Buff belum dapat dibaca. Sistem memeriksa ulang otomatis tanpa membeli lagi.",
};
const SK_ERROR_LABEL: Record<string,string> = {
  preflight_item_unavailable: "Stok atau varian supplier belum tersedia. Sistem memeriksa ulang otomatis sebelum membeli.",
  preflight_insufficient_balance: "Saldo Sekalipay tidak cukup untuk harga aktual. Top up saldo; sistem memeriksa ulang otomatis.",
  preflight_balance_unavailable: "Saldo Sekalipay belum dapat diperiksa. Pembelian belum dikirim dan akan dicoba kembali.",
  preflight_unavailable: "Pemeriksaan supplier belum berhasil. Pembelian belum dikirim dan akan dicoba kembali.",
  preflight_disabled: "Pembelian otomatis Sekalipay dinonaktifkan. Tidak ada pembelian baru.",
  completed_without_license: "Supplier menyatakan selesai, tetapi lisensi belum tersedia. Sistem memeriksa ulang tanpa membeli lagi.",
  completed_partial_license: "Lisensi supplier belum lengkap atau identitasnya berbeda. Data tersimpan privat; belum dikirim ke pembeli.",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Antre dikirim ke supplier",
  claimed: "Sedang dikirim ke supplier",
  retry: "Gagal sementara — dicoba ulang otomatis",
  blocked_balance: "Saldo supplier habis",
  submitted: "Terkirim, menunggu konfirmasi supplier",
  ordering: "Terkirim, menunggu konfirmasi supplier",
  processing: "Diproses supplier",
  completed: "Selesai di supplier",
  failed: "Gagal di supplier",
  needs_admin: "Perlu pemeriksaan supplier",
};

/** Link aktif = supplier masih bertanggung jawab (bukan handover manual). */
export function hasActiveSupplierLink(links: SupplierLink[] | undefined): boolean {
  return (links ?? []).some((l) => !l.purchase_disabled && !["completed", "failed"].includes(l.status));
}

/** Cermin aturan route retry WR/SK: kuota tersisa, atau failed pra-kirim (WR). */
export function canRetrySupplierLink(link: SupplierLink): boolean {
  if (link.supplier === "tunvn") return !link.purchase_disabled && link.can_retry === true;
  if (!["pending", "retry", "failed", "blocked_balance"].includes(link.status)) return false;
  if (link.status === "failed") {
    return link.supplier === "wr" && !link.supplier_order_id && !String(link.last_error ?? "").startsWith("cancelled_by_admin");
  }
  return link.attempt_count < link.max_attempts;
}

function canVoid(link: SupplierLink): boolean {
  if (link.supplier === "tunvn") return false;
  return ["pending", "retry", "blocked_balance"].includes(link.status);
}

function canCheck(link: SupplierLink): boolean {
  if (link.supplier === "tunvn") return link.can_reconcile === true;
  // sync-now = tanya status order yang SUDAH terkirim ke supplier sekarang
  // (WR /transactions, SK /v1/trx). Kedua supplier punya route-nya sejak
  // paritas 2026-10-13 — tombol tampil untuk keduanya.
  return ["processing", "submitted", "ordering"].includes(link.status) && Boolean(link.supplier_order_id);
}

export function SupplierLinkActions({ links, onChanged, compact = false }: { links: SupplierLink[]; onChanged: () => void; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Record<string, string>>({});
  const formId = useId();
  if (!links.length) return null;
  const base = (link: SupplierLink) => `/api/admin/${link.supplier === "wr" ? "warung" : "sekalipay"}/orders/${link.id}`;
  const run = async (link: SupplierLink, action: "retry" | "void" | "sync-now", invoice?: string) => {
    if (action === "void" && !window.confirm(`Batalkan order ke ${SUPPLIER_NAME[link.supplier]}? Order tidak akan dikirim ke supplier lagi — serahkan manual ke pembeli bila perlu.`)) return;
    setBusy(`${link.supplier}:${link.id}:${action}`);
    try {
      const tunvn = link.supplier === "tunvn";
      const res = await fetch(tunvn ? "/api/admin/tunvn/orders" : `${base(link)}/${action}`, {
        method: "POST",
        ...(tunvn ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id:link.id,action:action==="sync-now" ? "reconcile" : action }) } : invoice ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wr_order_id: invoice }) } : {}),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string; link?: { status?: string; last_error?: string | null } };
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      const next = String(body.link?.status ?? "");
      if (tunvn && next === "needs_admin") toast.error(TUNVN_ERROR_LABEL[String(body.link?.last_error)] ?? "TUNVN masih memerlukan pemeriksaan admin; tidak membeli ulang secara buta.");
      else if (action === "void") toast.success("Order supplier dibatalkan.");
      else if (next === "blocked_balance") toast.error("Saldo supplier masih belum cukup — isi saldo lalu coba lagi.");
      else if (next === "processing" || next === "completed") toast.success(action === "retry" ? "Order diteruskan ke supplier." : "Status supplier diperbarui.");
      else toast.success(next ? `Status sekarang: ${STATUS_LABEL[next] ?? next}` : "Diperbarui.");
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Aksi gagal");
    } finally {
      setBusy(null);
    }
  };
  return <div className={compact ? "mt-2 space-y-1.5" : "space-y-2"}>
    {links.map((link) => {
      const tone = link.status === "failed" || link.status === "blocked_balance" || link.status === "needs_admin"
        ? "border-red-400/25 bg-red-500/[0.07] text-admin-danger"
        : link.status === "completed" ? "border-emerald-400/20 bg-emerald-500/[0.06] text-admin-success"
        : "border-admin-accent/20 bg-admin-primary/[0.06] text-admin-accent";
      const key = `${link.supplier}:${link.id}`;
      return <div key={key} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${tone}`}>
        <span className="font-semibold">{link.supplier.toUpperCase()} · {link.purchase_disabled ? "Pembelian otomatis dinonaktifkan · penanganan manual" : link.supplier==="tunvn" && link.last_error==="insufficient_balance" ? "Saldo supplier tidak cukup" : STATUS_LABEL[link.status] ?? link.status}</span>
        {link.supplier_order_id && <span className="font-mono text-xs opacity-60">{link.supplier_order_id}</span>}
        {link.status === "completed" && link.delivery_status && link.delivery_status !== "delivered" && <span className="opacity-75">· kredensial: {link.delivery_status === "failed" ? "gagal kirim (dicoba ulang)" : "antre kirim"}</span>}
        {link.last_error && !link.purchase_disabled && !["completed"].includes(link.status) && <span className="w-full break-words text-xs opacity-80">{(link.supplier==="tunvn" ? TUNVN_ERROR_LABEL : link.supplier==="sk" ? SK_ERROR_LABEL : {})[link.last_error] ?? link.last_error}</span>}
        <span className="ml-auto flex gap-1.5">
          {canRetrySupplierLink(link) && <button type="button" onClick={() => void run(link, "retry")} disabled={busy !== null} className="inline-flex h-12 items-center gap-1 rounded-md bg-admin-primary px-2.5 text-xs font-bold text-admin-inverse disabled:opacity-40">{busy === `${key}:retry` ? <Spinner size={11} /> : <IosIcon name="refresh" size={11} tint="black" />} Retry</button>}
          {canCheck(link) && <button type="button" onClick={() => void run(link, "sync-now")} disabled={busy !== null} className="inline-flex h-12 items-center gap-1 rounded-md border border-admin-border px-2.5 text-xs font-semibold text-admin-muted disabled:opacity-40">{busy === `${key}:sync-now` ? <Spinner size={11} /> : <IosIcon name="refresh" size={11} tint="white" />} Cek status</button>}
          {canVoid(link) && <button type="button" onClick={() => void run(link, "void")} disabled={busy !== null} className="inline-flex h-12 items-center gap-1 rounded-md border border-red-400/30 bg-red-500/10 px-2.5 text-xs font-semibold text-admin-danger disabled:opacity-40">{busy === `${key}:void` ? <Spinner size={11} /> : <IosIcon name="close" size={11} tint="#FCA5A5" />} Batal</button>}
        </span>
        {link.supplier === "wr" && !link.supplier_order_id && ["submitted", "ordering", "claimed"].includes(link.status) &&
          <form className="flex w-full flex-wrap items-end gap-2" onSubmit={(event) => {
            event.preventDefault();
            void run(link, "sync-now", invoices[key]?.trim());
          }}>
            <div className="min-w-0 flex-1">
              <label htmlFor={`${formId}-${key}`} className="mb-1 block text-admin-muted">Invoice WR yang telah diverifikasi</label>
              <input id={`${formId}-${key}`} value={invoices[key] ?? ""} onChange={(event) => setInvoices({ ...invoices, [key]: event.target.value })}
                required maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" autoComplete="off" disabled={busy !== null}
                className="h-11 w-full rounded-lg border border-admin-border bg-black/20 px-3 text-sm text-admin-fg focus:outline-none focus:ring-2 focus:ring-admin-accent" />
            </div>
            <button type="submit" disabled={busy !== null || !invoices[key]?.trim()}
              className="min-h-11 rounded-lg border border-admin-border px-3 text-xs font-semibold text-admin-fg focus:outline-none focus:ring-2 focus:ring-admin-accent disabled:opacity-40">Hubungkan invoice WR</button>
            <p className="w-full text-admin-muted">Pilih invoice milik pesanan ini di riwayat WR. Nama produk dan waktu saja tidak membuktikan kecocokan.</p>
          </form>}
      </div>;
    })}
  </div>;
}
