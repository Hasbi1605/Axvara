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

import { useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";

export type SupplierLink = {
  supplier: "wr" | "sk";
  id: number;
  status: string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  supplier_order_id: string | null;
  delivery_status: string | null;
};

const SUPPLIER_NAME = { wr: "Warung Rebahan", sk: "Sekalipay" } as const;

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
};

/** Link aktif = supplier masih bertanggung jawab (bukan handover manual). */
export function hasActiveSupplierLink(links: SupplierLink[] | undefined): boolean {
  return (links ?? []).some((l) => !["completed", "failed"].includes(l.status));
}

/** Cermin aturan route retry WR/SK: kuota tersisa, atau failed pra-kirim (WR). */
export function canRetrySupplierLink(link: SupplierLink): boolean {
  if (!["pending", "retry", "failed", "blocked_balance"].includes(link.status)) return false;
  if (link.status === "failed") {
    return link.supplier === "wr" && !link.supplier_order_id && !String(link.last_error ?? "").startsWith("cancelled_by_admin");
  }
  return link.attempt_count < link.max_attempts;
}

function canVoid(link: SupplierLink): boolean {
  return ["pending", "retry", "blocked_balance"].includes(link.status);
}

function canCheck(link: SupplierLink): boolean {
  // WR: sync-now = tanya status order yang SUDAH terkirim ke WR.
  // SK tidak punya route sync-now — tombol hanya untuk WR agar tidak 404.
  return link.supplier === "wr" && ["processing", "submitted", "ordering"].includes(link.status) && Boolean(link.supplier_order_id);
}

export function SupplierLinkActions({ links, onChanged, compact = false }: { links: SupplierLink[]; onChanged: () => void; compact?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!links.length) return null;
  const base = (link: SupplierLink) => `/api/admin/${link.supplier === "wr" ? "warung" : "sekalipay"}/orders/${link.id}`;
  const run = async (link: SupplierLink, action: "retry" | "void" | "sync-now") => {
    if (action === "void" && !window.confirm(`Batalkan order ke ${SUPPLIER_NAME[link.supplier]}? Order tidak akan dikirim ke supplier lagi — serahkan manual ke pembeli bila perlu.`)) return;
    setBusy(`${link.supplier}:${link.id}:${action}`);
    try {
      const res = await fetch(`${base(link)}/${action}`, { method: "POST" });
      const body = await res.json().catch(() => ({})) as { error?: string; link?: { status?: string; last_error?: string | null } };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const next = String(body.link?.status ?? "");
      if (action === "void") toast.success("Order supplier dibatalkan.");
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
      const tone = link.status === "failed" || link.status === "blocked_balance"
        ? "border-red-400/25 bg-red-500/[0.07] text-red-200"
        : link.status === "completed" ? "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-200"
        : "border-[#00E5FF]/20 bg-[#00E5FF]/[0.06] text-[#9ff4ff]";
      const key = `${link.supplier}:${link.id}`;
      return <div key={key} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[11px] ${tone}`}>
        <span className="font-semibold">{link.supplier.toUpperCase()} · {STATUS_LABEL[link.status] ?? link.status}</span>
        {link.supplier_order_id && <span className="font-mono text-[10px] opacity-60">{link.supplier_order_id}</span>}
        {link.status === "completed" && link.delivery_status && link.delivery_status !== "delivered" && <span className="opacity-75">· kredensial: {link.delivery_status === "failed" ? "gagal kirim (dicoba ulang)" : "antre kirim"}</span>}
        {link.last_error && !["completed"].includes(link.status) && <span className="w-full truncate font-mono text-[10px] opacity-60" title={link.last_error}>{link.last_error}</span>}
        <span className="ml-auto flex gap-1.5">
          {canRetrySupplierLink(link) && <button onClick={() => void run(link, "retry")} disabled={busy !== null} className="inline-flex h-7 items-center gap-1 rounded-full bg-[#00E5FF] px-2.5 text-[11px] font-bold text-[#07101f] disabled:opacity-40">{busy === `${key}:retry` ? <Spinner size={11} /> : <IosIcon name="refresh" size={11} tint="black" />} Retry</button>}
          {canCheck(link) && <button onClick={() => void run(link, "sync-now")} disabled={busy !== null} className="inline-flex h-7 items-center gap-1 rounded-full border border-white/15 px-2.5 text-[11px] font-semibold text-white/75 disabled:opacity-40">{busy === `${key}:sync-now` ? <Spinner size={11} /> : <IosIcon name="refresh" size={11} tint="white" />} Cek status</button>}
          {canVoid(link) && <button onClick={() => void run(link, "void")} disabled={busy !== null} className="inline-flex h-7 items-center gap-1 rounded-full border border-red-400/30 bg-red-500/10 px-2.5 text-[11px] font-semibold text-red-200 disabled:opacity-40">{busy === `${key}:void` ? <Spinner size={11} /> : <IosIcon name="close" size={11} tint="#FCA5A5" />} Batal</button>}
        </span>
      </div>;
    })}
  </div>;
}
