"use client";

import { useEffect, useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { refillStatusLabel } from "@/lib/pedia/refill-policy";
import { OrderAccessAdmin } from "../OrderAccessAdmin";
import { BUTTON, PRIMARY, INPUT, Field, Panel, Feedback, Pagination, STATUS, needsAction, type Row, type PanelState } from "./shared";

export function OrdersPanel({ panel, onlyAction }: { panel: PanelState<{ rows: Row[] }>; onlyAction: boolean }) {
  const [status, setStatus] = useState(onlyAction ? "action" : ""), [page, setPage] = useState(1), [copied, setCopied] = useState("");
  const [action, setAction] = useState<{ code: string; action: string; sid?: string } | null>(null);
  useEffect(() => { setStatus(onlyAction ? "action" : ""); setPage(1); }, [onlyAction]);
  // ponytail: paginate the API's latest 100 rows; older history needs server-side pagination first.
  const attention = panel.data.rows.filter(needsAction), remaining = panel.data.rows.filter(r => !needsAction(r) && (!status || r.status === status));
  const path = (r: Row) => `/api/admin/pedia/orders/${encodeURIComponent(String(r.order_code))}`;
  const write = (r: Row, body: Row, message: string) => panel.write(path(r), body, message, "POST");
  async function copy(r: Row) {
    try { await navigator.clipboard.writeText(String(r.target_normalized ?? "")); setCopied(String(r.order_code)); }
    catch { panel.setError("Target belum tersalin. Salin teks dari detail pesanan."); }
  }
  function order(r: Row) {
    const code = String(r.order_code), active = needsAction(r);
    return <article key={code} aria-label={`Pesanan ${code}`} className={`min-w-0 border-b border-white/10 p-4 last:border-b-0 ${active ? "bg-amber-300/[0.025]" : ""}`}>
      <div className="grid min-w-0 gap-3 text-xs md:grid-cols-[1.2fr_1fr_1fr_80px_105px] md:items-start">
        <div className="min-w-0"><h5 className="break-all font-semibold text-white">{code}</h5><p className="mt-1 text-white/45">{formatWibDateTime(String(r.created_at ?? "")) ?? "-"}</p></div>
        <div className="min-w-0"><p className="break-words font-medium text-white">{String(r.product_name)}</p><p className="mt-1 text-white/60">{String(r.quantity)} unit</p></div>
        <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate text-white/60" title={String(r.target_normalized ?? "")}>{String(r.target_normalized ?? "-")}</span><button className="min-h-11 shrink-0 text-[#00E5FF]" onClick={() => void copy(r)} aria-label={`Salin target ${code}`}>{copied === code ? "Tersalin" : "Salin"}</button></div>
        <strong className="text-white">{formatRupiah(Number(r.total))}</strong><span className={`w-fit rounded-full border border-current/20 px-2 py-1 ${active ? "text-amber-300" : r.status === "completed" ? "text-emerald-300" : "text-white/65"}`}>{STATUS[String(r.status)] ?? "Status tidak dikenal"}</span>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-4 text-xs text-white/45"><p className="break-words">IndoSMM · layanan #{String(r.supplier_service_id ?? "-")} · {r.supplier_order_id ? `order ${String(r.supplier_order_id)}` : "order belum diketahui"}</p>
        <details className="min-w-0 basis-full"><summary className="min-h-11 w-fit cursor-pointer py-3 text-white/65">Detail pesanan</summary><div className="space-y-2 break-words pb-3"><p className="break-all">Target: {String(r.target_normalized ?? "-")}</p><p>Mulai: {String(r.start_count ?? "-")} / Tersisa: {String(r.remains ?? "-")} / Biaya supplier: {r.supplier_charge == null ? "Belum tersedia" : formatRupiah(Number(r.supplier_charge))}</p>{r.last_error ? <p className="break-all text-red-300">Kendala: {String(r.last_error)}</p> : null}{r.refill_status != null && <p>Refill: {refillStatusLabel(r.refill_status)} · {formatWibDateTime(String(r.refill_last_at ?? "")) ?? "-"}{r.refill_supplier_id ? ` · ID refill ${String(r.refill_supplier_id)}` : ""}</p>}{r.followup_state === "handled" && <p className="whitespace-pre-wrap">Selesai ditangani: {String(r.followup_note)} · {String(r.handled_by)} · {formatWibDateTime(String(r.handled_at))}</p>}<OrderAccessAdmin code={code} /></div></details>
      </div>
      {active && <div className="space-y-3 rounded-xl border border-amber-300/20 p-3 text-xs text-white/70" aria-label={`Tindakan ${code}`}>
        {r.followup_state === "open" && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void write(r, { action: "mark_handled", note: String(new FormData(e.currentTarget).get("note")), confirm: true }, "Tindak lanjut dicatat."); }}><p className="text-amber-200">Perlu tindak lanjut dengan pembeli; pencatatan tidak memindahkan dana.</p><label className="block">Catatan penyelesaian di luar website<textarea name="note" required minLength={10} maxLength={1000} className={INPUT} /></label><button disabled={panel.busy} className={BUTTON}>Selesai ditangani</button></form>}
        {["manual_requested", "needs_check", "requested"].includes(String(r.refill_status)) && <div className="space-y-2"><p className="text-amber-200">{r.refill_status === "manual_requested" ? `Ajukan refill ke CS IndoSMM dengan Order ID ${String(r.supplier_order_id ?? "-")}, lalu tandai hasilnya.` : "Hasil refill belum pasti. Periksa riwayat order IndoSMM, lalu tandai hasilnya."}</p><div className="flex flex-wrap gap-2"><button disabled={panel.busy} className={BUTTON} onClick={() => void write(r, { action: "refill_resolve", refill_outcome: "completed", confirm: true }, "Refill ditandai selesai.")}>Refill selesai</button><button disabled={panel.busy} className={`${BUTTON} text-red-300`} onClick={() => void write(r, { action: "refill_resolve", refill_outcome: "rejected", confirm: true }, "Refill ditandai ditolak.")}>Ditolak supplier</button></div></div>}
        {r.status === "needs_check" && <>
          <p className="text-amber-200">{r.can_resubmit === true ? "Pesanan belum dikirim. Periksa IndoSMM sebelum memilih tindakan." : "Hasil pengiriman belum pasti. Cocokkan ID order di IndoSMM."}</p>
          <form aria-label={`Tandai sudah dibuat ${code}`} className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); setAction({ code, action: "mark_submitted", sid: String(new FormData(e.currentTarget).get("sid")) }); }}><Field label="ID order supplier"><input name="sid" required maxLength={60} className={INPUT} /></Field><button className={BUTTON} disabled={panel.busy}>Tandai sudah dibuat</button></form>
          <div className="flex flex-wrap gap-2"><button disabled={panel.busy} className={BUTTON} onClick={async () => { const result = await write(r, { action: "check_balance" }, "Saldo diperiksa."); if (result) panel.setSuccess(`Saldo IndoSMM: ${formatRupiah(Number((result.balance as Row)?.balance))}`); }}>Cek saldo supplier</button><button disabled={panel.busy || r.can_resubmit !== true} aria-describedby={r.can_resubmit !== true ? `blocked-${code}` : undefined} className={BUTTON} onClick={() => setAction({ code, action: "resubmit" })}>Kirim ulang</button><button disabled={panel.busy || r.can_resubmit !== true} aria-describedby={r.can_resubmit !== true ? `blocked-${code}` : undefined} className={`${BUTTON} text-red-300`} onClick={() => setAction({ code, action: "cancel_manual" })}>Batalkan &amp; tindak lanjuti</button></div>
          {r.can_resubmit !== true && <p id={`blocked-${code}`} className="text-amber-200">Kirim ulang dan pembatalan dinonaktifkan: pengiriman sudah dicoba atau hasil belum pasti; hindari tagihan ganda.</p>}
          {panel.busy && <p className="text-white/55">Tindakan dinonaktifkan selama perubahan disimpan.</p>}
        </>}
      </div>}
    </article>;
  }
  return <Panel title="Pesanan" description="Tinjau pesanan yang memerlukan tindakan sebelum melanjutkan pekerjaan lainnya.">
    <Feedback panel={panel} />
    <div className="my-4 max-w-xs"><Field label="Status pesanan"><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); setAction(null); }} className={INPUT}><option value="">Semua status</option><option value="action">Perlu tindakan</option>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
    {!panel.loading && !panel.error && <>
      <section aria-label="Pesanan perlu tindakan"><h4 className="mb-3 text-sm font-semibold text-white">Perlu tindakan ({attention.length})</h4>{attention.length ? <div className="overflow-hidden rounded-2xl border border-amber-300/20">{attention.map(order)}</div> : <p className="py-3 text-sm text-white/55">Tidak ada pesanan yang perlu tindakan.</p>}</section>
      {status !== "action" && <section className="mt-6" aria-label="Semua pesanan"><h4 className="mb-3 text-sm font-semibold text-white">Semua pesanan</h4><p className="mb-3 text-xs text-white/45">Pesanan perlu tindakan ditampilkan di atas.</p>{remaining.length ? <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">{remaining.slice((page - 1) * 25, page * 25).map(order)}</div> : <p className="py-3 text-sm text-white/55">Belum ada pesanan Pedia untuk status ini.</p>}<Pagination page={page} total={remaining.length} size={25} loading={panel.loading} onPage={setPage} /></section>}
    </>}
    {action && <form aria-label="Verifikasi tindakan pesanan" className="mt-4 space-y-3 rounded-xl border border-amber-400/30 p-4" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      if (action.action === "resubmit" && (!f.has("checked_supplier") || !f.has("accept_charge"))) return;
      void panel.write(`/api/admin/pedia/orders/${encodeURIComponent(action.code)}`, { action: action.action, supplier_order_id: action.sid, confirm: true, ...(action.action === "resubmit" ? { checked_supplier: true, accept_charge: true } : {}) }, "Tindakan pesanan tersimpan.", "POST").then(result => { if (result) setAction(null); });
    }}><p className="break-all font-semibold text-white">Konfirmasi {action.code}</p><p className="text-sm text-white/65">{action.action === "resubmit" ? "Periksa dashboard supplier. Jangan kirim ulang pesanan yang sudah dibuat." : action.action === "cancel_manual" ? "Pesanan dibatalkan. Penyelesaian dengan pembeli dilakukan manual di luar website." : `Tandai pesanan telah dibuat dengan ID ${action.sid}.`}</p>{action.action === "resubmit" && <><label className="flex min-h-11 items-center gap-2 text-sm text-white/80"><input name="checked_supplier" type="checkbox" required />Saya telah memastikan pesanan belum ada di supplier</label><label className="flex min-h-11 items-center gap-2 text-sm text-white/80"><input name="accept_charge" type="checkbox" required />Saya memahami risiko tagihan ganda</label></>}<div className="flex gap-2"><button disabled={panel.busy} className={PRIMARY}>Konfirmasi tindakan</button><button type="button" disabled={panel.busy} className={BUTTON} onClick={() => setAction(null)}>Batal</button></div></form>}
  </Panel>;
}
