"use client";

import { useEffect, useState } from "react";
import { ClipboardCopy } from "lucide-react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { refillStatusLabel } from "@/lib/pedia/refill-policy";
import { Badge, Button, Checkbox, Input, Label, Textarea } from "@/components/admin/ui";
import { OrderAccessAdmin } from "../OrderAccessAdmin";
import { Field, Feedback, STATUS, needsAction, type Row, type PanelState } from "./shared";

/**
 * Tab "Perlu tindakan": HANYA pesanan Pedia yang memerlukan tindakan admin,
 * dengan seluruh guard aksi yang sudah ada. Riwayat lengkap ada di Pesanan
 * utama (Jenis = Pedia) — tautan di toolbar menuju ke sana.
 */
export function OrdersPanel({ panel }: { panel: PanelState<{ rows: Row[] }> }) {
  const [copied, setCopied] = useState("");
  const [action, setAction] = useState<{ code: string; action: string; sid?: string } | null>(null);
  // Data bisa berubah setelah aksi; form konfirmasi menutup diri bila ordernya
  // sudah tidak lagi memerlukan tindakan.
  useEffect(() => { if (action && !panel.loading && !panel.data.rows.some(r => String(r.order_code) === action.code && needsAction(r))) setAction(null); }, [action, panel.loading, panel.data.rows]);
  const attention = panel.data.rows.filter(needsAction);
  const path = (r: Row) => `/api/admin/pedia/orders/${encodeURIComponent(String(r.order_code))}`;
  const write = (r: Row, body: Row, message: string) => panel.write(path(r), body, message, "POST");
  async function copy(r: Row) {
    try { await navigator.clipboard.writeText(String(r.target_normalized ?? "")); setCopied(String(r.order_code)); }
    catch { panel.setError("Target belum tersalin. Salin teks dari detail pesanan."); }
  }
  function order(r: Row) {
    const code = String(r.order_code);
    return <article key={code} aria-label={`Pesanan ${code}`} className="min-w-0 border-b border-admin-border p-4 last:border-b-0">
      <div className="grid min-w-0 gap-3 text-xs md:grid-cols-[1.2fr_1fr_1fr_80px_105px] md:items-start">
        <div className="min-w-0"><h5 className="break-all font-semibold text-admin-fg">{code}</h5><p className="mt-1 text-admin-muted">{formatWibDateTime(String(r.created_at ?? "")) ?? "-"}</p></div>
        <div className="min-w-0"><p className="break-words font-medium text-admin-fg">{String(r.product_name)}</p><p className="mt-1 text-admin-muted">{String(r.quantity)} unit</p></div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-admin-muted" title={String(r.target_normalized ?? "")}>{String(r.target_normalized ?? "-")}</span>
          <Button variant="ghost" size="sm" className="shrink-0 px-2" onClick={() => void copy(r)} aria-label={`Salin target ${code}`}><ClipboardCopy />{copied === code ? "Tersalin" : "Salin"}</Button>
        </div>
        <strong className="text-admin-fg tabular-nums">{formatRupiah(Number(r.total))}</strong>
        <Badge variant={r.status === "completed" ? "success" : r.status === "needs_check" ? "warning" : "secondary"} className="w-fit">{STATUS[String(r.status)] ?? "Status tidak dikenal"}</Badge>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 text-xs text-admin-muted">
        <p className="break-words">Layanan IndoSMM #{String(r.supplier_service_id ?? "-")} · {r.supplier_order_id ? "sudah dibuat di supplier" : "belum dibuat di supplier"}</p>
        <details className="min-w-0 basis-full"><summary className="min-h-11 w-fit cursor-pointer py-3 text-admin-muted">Detail pesanan</summary>
          <div className="space-y-2 break-words pb-3">
            <p className="break-all">Target: {String(r.target_normalized ?? "-")}</p>
            <p>Mulai: {String(r.start_count ?? "-")} / Tersisa: {String(r.remains ?? "-")} / Biaya supplier: {r.supplier_charge == null ? "Belum tersedia" : formatRupiah(Number(r.supplier_charge))}</p>
            {/* ID supplier WAJIB ada (hanya di detail terlipat): admin butuh
                supplier_service_id untuk CS IndoSMM, supplier_order_id untuk
                refill/cek status, dan refill_supplier_id untuk riwayat refill. */}
            <p>Layanan IndoSMM: #{String(r.supplier_service_id ?? "-")}</p>
            <p className="break-all">ID order supplier: {r.supplier_order_id ? String(r.supplier_order_id) : "Belum dibuat di supplier"}</p>
            {r.last_error ? <p className="break-all text-admin-danger">Kendala: {String(r.last_error)}</p> : null}
            {r.refill_status != null && <p>Refill: {refillStatusLabel(r.refill_status)} · {formatWibDateTime(String(r.refill_last_at ?? "")) ?? "-"}{r.refill_supplier_id ? ` · ID refill ${String(r.refill_supplier_id)}` : ""}</p>}
            {r.followup_state === "handled" && <p className="whitespace-pre-wrap">Selesai ditangani: {String(r.followup_note)} · {String(r.handled_by)} · {formatWibDateTime(String(r.handled_at))}</p>}
            <OrderAccessAdmin code={code} />
          </div>
        </details>
      </div>
      {needsAction(r) && <div className="mt-3 space-y-3 rounded-md border border-admin-warning/30 p-3 text-xs text-admin-muted" aria-label={`Tindakan ${code}`}>
        {r.followup_state === "open" && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void write(r, { action: "mark_handled", note: String(new FormData(e.currentTarget).get("note")), confirm: true }, "Tindak lanjut dicatat."); }}>
          <p className="text-admin-warning">Perlu tindak lanjut dengan pembeli; pencatatan tidak memindahkan dana.</p>
          <Field label="Catatan penyelesaian di luar website"><Textarea name="note" required minLength={10} maxLength={1000} /></Field>
          <Button variant="outline" size="sm" disabled={panel.busy}>Selesai ditangani</Button>
        </form>}
        {["manual_requested", "needs_check", "requested"].includes(String(r.refill_status)) && <div className="space-y-2">
          <p className="text-admin-warning">{r.refill_status === "manual_requested"
            ? `Ajukan refill ke CS IndoSMM dengan Order ID ${r.supplier_order_id ? String(r.supplier_order_id) : "(belum ada — buat pesanan dulu)"}${r.refill_supplier_id ? ` (ID refill ${String(r.refill_supplier_id)})` : ""}, lalu tandai hasilnya.`
            : `Hasil refill belum pasti. Periksa riwayat order ${r.supplier_order_id ? String(r.supplier_order_id) : ""} di IndoSMM, lalu tandai hasilnya.`}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={panel.busy} onClick={() => void write(r, { action: "refill_resolve", refill_outcome: "completed", confirm: true }, "Refill ditandai selesai.")}>Refill selesai</Button>
            <Button size="sm" variant="outline" className="text-admin-danger" disabled={panel.busy} onClick={() => void write(r, { action: "refill_resolve", refill_outcome: "rejected", confirm: true }, "Refill ditandai ditolak.")}>Ditolak supplier</Button>
          </div>
        </div>}
        {r.status === "needs_check" && <>
          <p className="text-admin-warning">{r.can_resubmit === true ? "Pesanan belum dikirim. Periksa IndoSMM sebelum memilih tindakan." : "Hasil pengiriman belum pasti. Cocokkan ID order di IndoSMM."}</p>
          <form aria-label={`Tandai sudah dibuat ${code}`} className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setAction({ code, action: "mark_submitted", sid: String(new FormData(e.currentTarget).get("sid")) }); }}>
            <Field label="ID order supplier"><Input name="sid" required maxLength={60} className="w-40" /></Field>
            <Button variant="outline" size="sm" disabled={panel.busy}>Tandai sudah dibuat</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={panel.busy} onClick={async () => { const result = await write(r, { action: "check_balance" }, "Saldo diperiksa."); if (result) panel.setSuccess(`Saldo IndoSMM: ${formatRupiah(Number((result.balance as Row)?.balance))}`); }}>Cek saldo supplier</Button>
            <Button size="sm" variant="outline" disabled={panel.busy || r.can_resubmit !== true} aria-describedby={r.can_resubmit !== true ? `blocked-${code}` : undefined} onClick={() => setAction({ code, action: "resubmit" })}>Kirim ulang</Button>
            <Button size="sm" variant="outline" className="text-admin-danger" disabled={panel.busy || r.can_resubmit !== true} aria-describedby={r.can_resubmit !== true ? `blocked-${code}` : undefined} onClick={() => setAction({ code, action: "cancel_manual" })}>Batalkan &amp; tindak lanjuti</Button>
          </div>
          {r.can_resubmit !== true && <p id={`blocked-${code}`} className="text-admin-warning">Kirim ulang dan pembatalan dinonaktifkan: pengiriman sudah dicoba atau hasil belum pasti; hindari tagihan ganda.</p>}
          {panel.busy && <p className="text-admin-muted">Tindakan dinonaktifkan selama perubahan disimpan.</p>}
        </>}
      </div>}
    </article>;
  }
  return <section className="min-w-0 space-y-4" aria-label="Perlu tindakan Pedia">
    <Feedback panel={panel} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {/* D6: saat panel masih memuat, jangan tampilkan "(0)" yang menyesatkan. */}
        <p className="text-sm font-medium text-admin-fg">{panel.loading ? "Perlu tindakan · memuat…" : `Perlu tindakan (${attention.length})`}</p>
        <p className="mt-0.5 text-xs text-admin-muted">Hanya pesanan yang menunggu admin. Riwayat lengkap ada di <a className="underline underline-offset-2 hover:text-admin-fg" href="/admin?section=orders&kind=pedia">Pesanan</a>.</p>
      </div>
      <Button variant="outline" size="sm" disabled={panel.loading} onClick={() => void panel.load()}>Muat ulang</Button>
    </div>
    {!panel.loading && !panel.error && (attention.length
      ? <div className="overflow-hidden rounded-xl border border-admin-border">{attention.map(order)}</div>
      : <p className="rounded-xl border border-admin-border p-8 text-center text-sm text-admin-muted">Tidak ada pesanan yang perlu tindakan.</p>)}
    {action && <form aria-label="Verifikasi tindakan pesanan" className="space-y-3 rounded-xl border border-admin-warning/40 bg-admin-warning/5 p-4" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      if (action.action === "resubmit" && (!f.has("checked_supplier") || !f.has("accept_charge"))) return;
      void panel.write(`/api/admin/pedia/orders/${encodeURIComponent(action.code)}`, { action: action.action, supplier_order_id: action.sid, confirm: true, ...(action.action === "resubmit" ? { checked_supplier: true, accept_charge: true } : {}) }, "Tindakan pesanan tersimpan.", "POST").then(result => { if (result) setAction(null); });
    }}>
      <p className="break-all font-semibold text-admin-fg">Konfirmasi {action.code}</p>
      <p className="text-sm text-admin-muted">{action.action === "resubmit" ? "Periksa dashboard supplier. Jangan kirim ulang pesanan yang sudah dibuat." : action.action === "cancel_manual" ? "Pesanan dibatalkan. Penyelesaian dengan pembeli dilakukan manual di luar website." : `Tandai pesanan telah dibuat dengan ID ${action.sid}.`}</p>
      {action.action === "resubmit" && <>
        <div className="flex items-start gap-2">
          <Checkbox id={`checked-${action.code}`} name="checked_supplier" required />
          <Label htmlFor={`checked-${action.code}`} className="text-sm font-normal leading-6 text-admin-muted">Saya telah memastikan pesanan belum ada di supplier</Label>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id={`charge-${action.code}`} name="accept_charge" required />
          <Label htmlFor={`charge-${action.code}`} className="text-sm font-normal leading-6 text-admin-muted">Saya memahami risiko tagihan ganda</Label>
        </div>
      </>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={panel.busy}>Konfirmasi tindakan</Button>
        <Button type="button" size="sm" variant="outline" disabled={panel.busy} onClick={() => setAction(null)}>Batal</Button>
      </div>
    </form>}
  </section>;
}
