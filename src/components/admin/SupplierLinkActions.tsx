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
import { RefreshCw, X } from "lucide-react";
import { Badge, Button, Input, Label } from "@/components/admin/ui";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

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

function toneOf(link: SupplierLink) {
  if (link.status === "failed" || link.status === "blocked_balance" || link.status === "needs_admin") return "destructive" as const;
  if (link.status === "completed") return "success" as const;
  return "info" as const;
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
  return <div className={cn("space-y-2", compact && "mt-2 space-y-1.5")}>
    {links.map((link) => {
      const key = `${link.supplier}:${link.id}`;
      const heading = link.purchase_disabled
        ? "Pembelian otomatis dinonaktifkan · penanganan manual"
        : link.supplier === "tunvn" && link.last_error === "insufficient_balance" ? "Saldo supplier tidak cukup"
        : STATUS_LABEL[link.status] ?? link.status;
      const explanation = link.last_error && !link.purchase_disabled && !["completed"].includes(link.status)
        ? (link.supplier === "tunvn" ? TUNVN_ERROR_LABEL : link.supplier === "sk" ? SK_ERROR_LABEL : {})[link.last_error] ?? link.last_error
        : null;
      return <div key={key} className="rounded-md border border-admin-border bg-admin-subtle/40 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={toneOf(link)}>{link.supplier.toUpperCase()}</Badge>
          <span className="font-medium text-admin-fg">{heading}</span>
          {link.supplier_order_id && <span className="font-mono text-admin-muted">{link.supplier_order_id}</span>}
          {link.status === "completed" && link.delivery_status && link.delivery_status !== "delivered" && <span className="text-admin-muted">· kredensial: {link.delivery_status === "failed" ? "gagal kirim (dicoba ulang)" : "antre kirim"}</span>}
        </div>
        {explanation && <p className="mt-1 break-words text-xs leading-4 text-admin-muted">{explanation}</p>}
        {(canRetrySupplierLink(link) || canCheck(link) || canVoid(link)) && <div className="mt-2 flex flex-wrap gap-2">
          {canRetrySupplierLink(link) && <Button variant="outline" size="sm" className="h-12 px-3 text-xs font-semibold" onClick={() => void run(link, "retry")} disabled={busy !== null}>{busy === `${key}:retry` ? <Spinner size={11} /> : <RefreshCw />} Retry</Button>}
          {canCheck(link) && <Button variant="outline" size="sm" className="h-12 px-3 text-xs font-semibold" onClick={() => void run(link, "sync-now")} disabled={busy !== null}>{busy === `${key}:sync-now` ? <Spinner size={11} /> : <RefreshCw />} Cek status</Button>}
          {canVoid(link) && <Button variant="outline" size="sm" className="h-12 border-admin-danger/30 px-3 text-xs font-semibold text-admin-danger" onClick={() => void run(link, "void")} disabled={busy !== null}>{busy === `${key}:void` ? <Spinner size={11} /> : <X />} Batal</Button>}
        </div>}
        {link.supplier === "wr" && !link.supplier_order_id && ["submitted", "ordering", "claimed"].includes(link.status) &&
          <form className="mt-2 space-y-2" onSubmit={(event) => {
            event.preventDefault();
            void run(link, "sync-now", invoices[key]?.trim());
          }}>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-${key}`} className="text-xs">Invoice WR yang telah diverifikasi</Label>
              <Input id={`${formId}-${key}`} value={invoices[key] ?? ""} onChange={(event) => setInvoices({ ...invoices, [key]: event.target.value })}
                required maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" autoComplete="off" disabled={busy !== null} className="font-mono" />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-11 px-3 text-xs font-semibold" disabled={busy !== null || !invoices[key]?.trim()}>Hubungkan invoice WR</Button>
            <p className="text-xs leading-4 text-admin-muted">Pilih invoice milik pesanan ini di riwayat WR. Nama produk dan waktu saja tidak membuktikan kecocokan.</p>
          </form>}
      </div>;
    })}
  </div>;
}
