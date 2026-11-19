"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { formatRupiah } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Loading";
import { TUNVN_ERROR_LABEL } from "./SupplierLinkActions";
import { RETRYABLE_WR_STATUS, WR_STATUS_LABEL, canRetryWrLink } from "./WarungRebahanManager";
import { RETRYABLE_SK_STATUS, SK_STATUS_LABEL, canRetrySkLink } from "./SekalipayManager";
import { ageLabel, supplierMoney, supplierTime, type OrderLink, type Supplier, type SupplierConfig } from "./supplier-admin-data";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, NativeSelect, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

const statuses = {
  pending: ["Menunggu", "secondary"], claimed: ["Memproses", "info"],
  processing: ["Menunggu supplier", "info"], completed: ["Selesai", "success"],
  needs_admin: ["Perlu diperiksa", "warning"], blocked_balance: ["Saldo kurang", "warning"],
  failed: ["Gagal", "destructive"], manual: ["Penanganan manual", "warning"],
} as const;

const commonErrors: Record<string, string> = {
  insufficient_balance: "Saldo supplier tidak cukup.", blocked_balance: "Saldo supplier tidak cukup.",
  balance_unavailable: "Saldo supplier belum dapat diperiksa.", stock_unavailable: "Stok supplier belum tersedia.",
  catalog_unavailable: "Katalog supplier belum dapat diperiksa.", price_increased: "Harga supplier naik.",
  price_conflict: "Harga supplier berubah.", activation_required: "Supplier membutuhkan aktivasi manual.",
  attempts_exhausted: "Batas percobaan tercapai.", dispatch_unconfirmed: "Pembelian belum terkonfirmasi.",
};

const ORDER_FILTERS: [string, string][] = [
  ["all", "Semua"], ["pending", "Pending"], ["submitted", "Terkirim"], ["processing", "Diproses"],
  ["retry", "Retry"], ["blocked_balance", "Saldo habis"], ["failed", "Gagal"], ["completed", "Selesai"],
];

export function supplierOrderError(error: string | null | undefined, tunvn?: boolean) {
  if (!error) return null;
  if (tunvn && Object.hasOwn(TUNVN_ERROR_LABEL, error)) return TUNVN_ERROR_LABEL[error];
  return Object.hasOwn(commonErrors, error) ? commonErrors[error] : "Perlu diperiksa";
}

function OrderStatus({ link, supplier, tunvn }: { link: OrderLink; supplier: Supplier; tunvn?: boolean }) {
  const { status } = link;
  if (supplier === "warung" || supplier === "sekalipay") {
    const label = supplier === "warung" ? (WR_STATUS_LABEL[status] ?? status) : (SK_STATUS_LABEL[status] ?? status);
    const tone = status === "completed" ? "success"
      : status === "failed" || status === "canceled" ? "destructive"
      : status === "blocked_balance" ? "warning"
      : supplier === "warung" && (status === "processing" || status === "ordering") ? "info"
      : supplier === "warung" ? "warning"
      : "secondary";
    return <>
      <Badge variant={tone}>{label}</Badge>
      {link.purchase_disabled === 1 && <p className="mt-1 break-words text-xs text-admin-muted">Pembelian otomatis dinonaktifkan.</p>}
    </>;
  }
  if (link.resolved_manually === true) {
    return <Badge variant="secondary">Diselesaikan manual</Badge>;
  }
  const code = link.purchase_disabled === 1 ? "manual"
    : status === "needs_admin" && ["insufficient_balance", "blocked_balance"].includes(link.last_error ?? "") ? "blocked_balance"
    : ["submitted", "ordering"].includes(status) ? "processing"
    : ["cancelled", "canceled"].includes(status) ? "failed" : status;
  const [label, tone] = Object.hasOwn(statuses, code) ? statuses[code as keyof typeof statuses] : statuses.needs_admin;
  const reason = code === "manual" ? "Pembelian otomatis dinonaktifkan." : supplierOrderError(link.last_error, tunvn);
  return <><Badge variant={tone}>{label}</Badge>
    {reason && reason !== label && <p className="mt-1 break-words text-xs text-admin-muted">{reason}</p>}
  </>;
}

function BlockedRetry({ supplier, order }: { supplier: "warung" | "sekalipay"; order: OrderLink }) {
  let badge = "Percobaan habis";
  let reason = "Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan.";
  if (supplier === "warung") {
    if (order.status === "failed") {
      badge = "Tak bisa retry";
      reason = "Order ini sudah pernah terkirim ke WR atau dibatalkan admin — retry = beli ulang (dobel bayar). Serahkan manual dari tab Pesanan.";
    } else if (order.purchase_disabled === 1) {
      badge = "Tak bisa retry";
      reason = "Pembelian otomatis order ini dinonaktifkan.";
    } else {
      reason = "Percobaan otomatis sudah habis. Serahkan manual dari tab Pesanan, atau naikkan batas percobaan.";
    }
  } else {
    if (order.sk_invoice || order.request_sent_at || String(order.last_error ?? "").startsWith("cancelled_by_admin")) {
      badge = "Tak bisa retry";
      reason = "Order ini sudah pernah terkirim ke SK atau dibatalkan admin — retry = beli ulang (dobel bayar). Gunakan rekonsiliasi atau serahkan manual dari tab Pesanan.";
    } else if ((order.order_status != null && order.order_status !== "lunas") ||
        (order.order_payment_status != null && order.order_payment_status !== "paid")) {
      badge = "Tak bisa retry";
      reason = "Pesanan belum lunas — retry supplier ditolak.";
    } else if (order.purchase_disabled === 1) {
      badge = "Tak bisa retry";
      reason = "Pembelian otomatis order ini dinonaktifkan.";
    }
  }
  return <div className="space-y-1 md:text-right">
    <Badge variant="destructive">{badge}</Badge>
    <p className="max-w-[260px] text-xs leading-4 text-admin-muted">{reason}</p>
  </div>;
}

type Action = "retry" | "void" | "reconcile" | "reveal";
export function SupplierOrderQueue({
  supplier, links, config, labels, locked, loading = false,
  orderQuery = "", onOrderQueryChange, orderStatus = "all", onOrderStatusChange,
  orderPage = 1, orderTotal = 0, orderPerPage = 20, onPageChange,
  busyOrderAction = null, onAction,
}: {
  supplier: Supplier;
  links: OrderLink[] | null; config: SupplierConfig; labels: Map<string | number, string>; locked: boolean; loading?: boolean;
  orderQuery?: string; onOrderQueryChange?: (q: string) => void;
  orderStatus?: string; onOrderStatusChange?: (status: string) => void;
  orderPage?: number; orderTotal?: number; orderPerPage?: number; onPageChange?: (page: number) => void;
  busyOrderAction?: string | null;
  onAction: (link: OrderLink, action: Action, trigger: HTMLButtonElement) => void;
}) {
  const { name, currency, buff, mode } = config;
  const isWrSk = mode === "fixed";
  const [voidConfirm, setVoidConfirm] = useState<{ link: OrderLink; trigger: HTMLButtonElement } | null>(null);

  if (links == null && !isWrSk) return null;
  const list = links ?? [];
  const orderPages = Math.max(1, Math.ceil(orderTotal / orderPerPage));

  const rows = list.map(link => {
    const isBuff = link.kind === "buff" || link.kind === "muse_buff";
    let unit: string;
    let cost: string;
    if (supplier === "warung") {
      const productPart = link.wr_product_name ? `${link.wr_product_name} — ` : "";
      const variantPart = link.wr_variant_name ?? (link.wr_product_name ? "Varian" : "Produk");
      unit = `${productPart}${variantPart} · ${link.quantity} unit`;
      cost = formatRupiah(Number(link.wr_cost ?? 0));
    } else if (supplier === "sekalipay") {
      const productPart = link.sk_product_name ? `${link.sk_product_name} — ` : "";
      const variantPart = link.sk_variant_name ?? (link.sk_product_name ? "Varian" : "Produk");
      unit = `${productPart}${variantPart} · ${link.quantity} unit`;
      cost = formatRupiah(Number(link.sk_cost ?? 0));
    } else {
      const id = link[config.orderId];
      const product = id == null ? "Produk" : labels.get(id) ?? (typeof id === "number" ? `#${id}` : id);
      unit = `${isBuff ? "Buff Token Muse" : product} · ${link.quantity} ${isBuff ? "miliar token" : "unit"}`;
      cost = supplierMoney(currency, currency === "USD" ? link.cost_usd : link.cost_usdt);
    }

    const buyer = [link.customer_name, link.customer_wa, link.customer_email].filter(Boolean).join(" · ") || "—";
    const buyerText = link.sales_channel ? `${buyer} · ${link.sales_channel}` : buyer;
    const resolved = !isWrSk && link.resolved_manually === true;
    const terminal = resolved || ["completed", "failed", "canceled"].includes(link.status);
    const age = terminal ? null : ageLabel(link);
    const time = supplierTime(link.completed_at ?? link.request_sent_at ?? link.updated_at ?? link.created_at) ?? "—";
    const refId = isWrSk ? (link.wr_order_id ?? link.sk_invoice ?? null) : null;

    let actionsNode: React.ReactNode = null;
    if (supplier === "warung" || supplier === "sekalipay") {
      const retryable = supplier === "warung" ? canRetryWrLink(link) : canRetrySkLink(link);
      const retryList = supplier === "warung" ? RETRYABLE_WR_STATUS : RETRYABLE_SK_STATUS;
      const rowBusy = busyOrderAction === `retry:${link.id}` || busyOrderAction === `void:${link.id}`;
      // Void keeps the old queue action for nonterminal links even when SK retry is fenced.
      const voidable = retryList.includes(link.status) && link.status !== "failed" &&
        Number(link.attempt_count ?? 0) < Number(link.max_attempts ?? 3);
      if (retryList.includes(link.status)) {
        actionsNode = <>
          {retryable ? <Button size="sm" className="min-h-11 md:min-h-0" disabled={locked || rowBusy} onClick={e => onAction(link, "retry", e.currentTarget)}>
            {busyOrderAction === `retry:${link.id}` ? <Spinner size={13} /> : <RefreshCw />} Retry
          </Button> : <BlockedRetry supplier={supplier} order={link} />}
          {voidable && <Button size="sm" variant="outline" className="min-h-11 border-admin-danger/30 text-admin-danger md:min-h-0" disabled={locked || rowBusy}
            onClick={e => setVoidConfirm({ link, trigger: e.currentTarget })}>
            {busyOrderAction === `void:${link.id}` ? <Spinner size={13} /> : <X />} Batal
          </Button>}
        </>;
      }
    } else {
      const button = (action: Action, label: string) => <Button key={action} variant={action === "reveal" ? "ghost" : "outline"}
        size="sm" className="min-h-11 whitespace-nowrap md:min-h-0" disabled={locked} onClick={event => onAction(link, action, event.currentTarget)}>{label}</Button>;
      const buttons = [
        !resolved && link.can_retry === 1 && link.purchase_disabled !== 1 && link.status === "needs_admin" && button("retry", "Coba lagi"),
        !resolved && buff && link.kind === "buff" && link.provider_batch_id && ["processing", "needs_admin"].includes(link.status) && button("reconcile", "Periksa status"),
        link.has_receipt === 1 && button("reveal", "Lihat receipt"),
      ].filter(Boolean);
      if (buttons.length) actionsNode = buttons;
    }

    return {
      link,
      item: link.item_index == null ? null : `item ${link.item_index + 1}`,
      refId,
      unit,
      cost,
      buyerText,
      age,
      time,
      actionsNode,
    };
  });

  return <>
    <Card className="overflow-hidden">
      <CardHeader className="gap-3 p-4 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-base">Antrean pengiriman</CardTitle>
          {!isWrSk && list.length >= 100 && <CardDescription className="mt-1 text-xs">100 pesanan terbaru</CardDescription>}
        </div>
        {isWrSk && (
          <div className="flex flex-wrap items-center gap-2">
            <Input value={orderQuery} onChange={e => onOrderQueryChange?.(e.target.value)}
              placeholder={config.searchPlaceholder} aria-label={config.searchLabel} className="min-h-11 w-full sm:max-w-[260px] md:min-h-0" />
            <NativeSelect value={orderStatus} onChange={e => onOrderStatusChange?.(e.target.value)}
              aria-label={config.statusFilterLabel} className="min-h-11 w-[180px] md:min-h-0">
              {ORDER_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </NativeSelect>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {loading && list.length === 0 ? <p role="status" className="p-6 text-sm text-admin-muted">Memuat antrean {name}…</p>
          : rows.length === 0 ? <p className="p-6 text-sm text-admin-muted">{isWrSk ? `Belum ada order ${supplier === "warung" ? "WR" : "SK"} pada filter ini.` : `Belum ada pesanan ${name}.`}</p>
          : <>
            <div className="hidden overflow-x-auto border-t border-admin-border md:block"><Table>
              <caption className="sr-only">Pengiriman otomatis {name}</caption>
              <TableHeader><TableRow>
                <TableHead>Pesanan</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Biaya</TableHead>
                <TableHead>Status</TableHead><TableHead>Pembeli</TableHead><TableHead>Umur antrean</TableHead><TableHead className="text-right">Aksi</TableHead>
              </TableRow></TableHeader>
              <TableBody>{rows.map(({ link, item, refId, unit, cost, buyerText, age, time, actionsNode }) => {
                const late = age ? age.hours >= 13 : false;
                return <TableRow key={link.id}>
                  <TableCell className="whitespace-nowrap">
                    <p className="font-medium text-admin-fg">{link.order_code}</p>
                    {item && <p className="mt-1 text-xs text-admin-muted">{item}</p>}
                    {refId && <p className="mt-1 font-mono text-xs text-admin-muted">{refId}</p>}
                    {isWrSk && link.last_error && <p className="mt-1 max-w-52 break-words font-mono text-xs text-admin-danger">{link.last_error}</p>}
                  </TableCell>
                  <TableCell className="max-w-52 break-words text-xs text-admin-muted">{unit}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{cost}</TableCell>
                  <TableCell className="min-w-36 text-xs"><OrderStatus link={link} supplier={supplier} tunvn={buff} /></TableCell>
                  <TableCell className="max-w-56 break-words text-xs text-admin-muted">{buyerText}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {age && <Badge variant={late ? "destructive" : "secondary"}>{age.text}{late ? " · lewat batas" : ""}</Badge>}
                    {isWrSk ? (!age && <span className="text-admin-muted">—</span>)
                      : <p className={age ? "mt-1 text-admin-muted" : "text-admin-muted"}>{time}</p>}
                  </TableCell>
                  <TableCell><div className="flex flex-wrap justify-end gap-1.5">{actionsNode}</div></TableCell>
                </TableRow>;
              })}</TableBody>
            </Table></div>
            <div className="space-y-3 border-t border-admin-border p-4 md:hidden" aria-label={`Kartu pengiriman ${name}`}>
              {rows.map(({ link, item, refId, unit, cost, buyerText, age, time, actionsNode }) => {
                const late = age ? age.hours >= 13 : false;
                return <article key={link.id} className="space-y-2 rounded-xl border border-admin-border p-4 text-xs text-admin-muted">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="break-words font-medium text-admin-fg">{link.order_code}{item && ` · ${item}`}</p>
                    {age && <Badge variant={late ? "destructive" : "secondary"}>{age.text}{late ? " · lewat batas" : ""}</Badge>}
                  </div>
                  {refId && <p className="break-all font-mono text-xs text-admin-muted">{refId}</p>}
                  <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="min-w-0 break-words">{unit}</span><span className="tabular-nums text-admin-fg">{cost}</span></div>
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0"><OrderStatus link={link} supplier={supplier} tunvn={buff} /></div>
                    {!isWrSk && <p>{time}</p>}
                  </div>
                  <p className="break-words text-xs text-admin-muted">Pembeli: {buyerText}</p>
                  {isWrSk && link.last_error && <p className="break-words font-mono text-xs text-admin-danger">{link.last_error}</p>}
                  {actionsNode && <div className="flex flex-wrap gap-2">{actionsNode}</div>}
                </article>;
              })}
            </div>
          </>}
        {isWrSk && orderTotal > orderPerPage && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-admin-border px-4 py-3">
            <p className="text-xs text-admin-muted">Hal {orderPage} dari {orderPages} · {orderTotal} order</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={locked || orderPage <= 1} onClick={() => onPageChange?.(orderPage - 1)}><ChevronLeft /> Sebelumnya</Button>
              <Button variant="outline" size="sm" className="min-h-11 md:min-h-0" disabled={locked || orderPage >= orderPages} onClick={() => onPageChange?.(orderPage + 1)}>Berikutnya <ChevronRight /></Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
    <ConfirmDialog
      open={voidConfirm !== null}
      title={`Batalkan order ${supplier === "warung" ? "WR" : "SK"} ${voidConfirm?.link.order_code ?? ""}?`}
      description={`Link tidak akan diproses lagi (terminal failed). Pastikan order ${voidConfirm?.link.order_code ?? ""} tidak perlu dikirim ulang ke supplier.`}
      confirmLabel="Batalkan order"
      cancelLabel="Kembali"
      loading={Boolean(voidConfirm && busyOrderAction === `void:${voidConfirm.link.id}`)}
      onClose={() => setVoidConfirm(null)}
      onConfirm={() => {
        if (!voidConfirm) return;
        const { link, trigger } = voidConfirm;
        setVoidConfirm(null);
        onAction(link, "void", trigger);
      }}
    />
  </>;
}
