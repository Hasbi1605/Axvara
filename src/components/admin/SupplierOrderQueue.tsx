import { TUNVN_ERROR_LABEL } from "./SupplierLinkActions";
import { supplierMoney, supplierTime, type OrderLink, type SupplierConfig } from "./supplier-admin-data";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui";

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

export function supplierOrderError(error: string | null | undefined, tunvn?: boolean) {
  if (!error) return null;
  if (tunvn && Object.hasOwn(TUNVN_ERROR_LABEL, error)) return TUNVN_ERROR_LABEL[error];
  return Object.hasOwn(commonErrors, error) ? commonErrors[error] : "Perlu diperiksa";
}

function OrderStatus({ link, tunvn }: { link: OrderLink; tunvn?: boolean }) {
  const { status } = link;
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

type Action = "retry" | "reconcile" | "reveal";
export function SupplierOrderQueue({ links, config, labels, locked, onAction }: {
  links: OrderLink[] | null; config: SupplierConfig; labels: Map<string | number, string>; locked: boolean;
  onAction: (link: OrderLink, action: Action, trigger: HTMLButtonElement) => void;
}) {
  const { name, currency, buff } = config;
  if (links == null) return null;
  const rows = links.map(link => {
    const id = link[config.orderId];
    const isBuff = link.kind === "buff" || link.kind === "muse_buff";
    const product = id == null ? "Produk" : labels.get(id) ?? (typeof id === "number" ? `#${id}` : id);
    const unit = `${isBuff ? "Buff Token Muse" : product} · ${link.quantity} ${isBuff ? "miliar token" : "unit"}`;
    const cost = supplierMoney(currency, currency === "USD" ? link.cost_usd : link.cost_usdt);
    const time = supplierTime(link.completed_at ?? link.request_sent_at ?? link.updated_at ?? link.created_at) ?? "—";
    const button = (action: Action, label: string) => <Button key={action} variant={action === "reveal" ? "ghost" : "outline"}
      size="sm" className="min-h-11 whitespace-nowrap md:min-h-0" disabled={locked} onClick={event => onAction(link, action, event.currentTarget)}>{label}</Button>;
    const buttons = [
      link.can_retry === 1 && link.purchase_disabled !== 1 && link.status === "needs_admin" && button("retry", "Coba lagi"),
      buff && link.kind === "buff" && link.provider_batch_id && ["processing", "needs_admin"].includes(link.status) && button("reconcile", "Periksa status"),
      link.has_receipt === 1 && button("reveal", "Lihat receipt"),
    ];
    return { link, item: link.item_index == null ? null : `item ${link.item_index + 1}`, unit, cost, time, buttons };
  });
  return <Card className="overflow-hidden">
    <CardHeader className="p-4 pb-3">
      <CardTitle className="text-base">Pengiriman otomatis</CardTitle>
      <CardDescription className="mt-1 text-xs">100 pesanan terbaru.{buff && " Rekonsiliasi hanya membaca batch yang diketahui; tidak membeli ulang."}</CardDescription>
    </CardHeader>
    <CardContent className="p-0">
      {rows.length === 0 ? <p className="p-6 text-sm text-admin-muted">Belum ada pesanan {name}.</p> : <>
        <div className="hidden overflow-x-auto md:block"><Table>
          <caption className="sr-only">Pengiriman otomatis {name}</caption>
          <TableHeader><TableRow>
            <TableHead>Pesanan</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Biaya</TableHead>
            <TableHead>Status</TableHead><TableHead>Waktu</TableHead><TableHead className="text-right">Aksi</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(({ link, item, unit, cost, time, buttons }) => <TableRow key={link.id}>
            <TableCell className="whitespace-nowrap"><p className="font-medium text-admin-fg">{link.order_code}</p>{item && <p className="mt-1 text-xs text-admin-muted">{item}</p>}</TableCell>
            <TableCell className="max-w-52 break-words text-xs text-admin-muted">{unit}</TableCell>
            <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{cost}</TableCell>
            <TableCell className="min-w-36 text-xs"><OrderStatus link={link} tunvn={buff} /></TableCell>
            <TableCell className="whitespace-nowrap text-xs text-admin-muted">{time}</TableCell>
            <TableCell><div className="flex flex-wrap justify-end gap-1.5">{buttons}</div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        <div className="space-y-3 p-4 md:hidden" aria-label={`Kartu pengiriman ${name}`}>
          {rows.map(({ link, item, unit, cost, time, buttons }) => <article key={link.id} className="space-y-2 rounded-xl border border-admin-border p-4 text-xs text-admin-muted">
            <p className="break-words font-medium text-admin-fg">{link.order_code}{item && ` · ${item}`}</p>
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><span className="min-w-0 break-words">{unit}</span><span className="tabular-nums text-admin-fg">{cost}</span></div>
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><div className="min-w-0"><OrderStatus link={link} tunvn={buff} /></div><p>{time}</p></div>
            {buttons.some(Boolean) && <div className="flex flex-wrap gap-2">{buttons}</div>}
          </article>)}
        </div>
      </>}
    </CardContent>
  </Card>;
}
