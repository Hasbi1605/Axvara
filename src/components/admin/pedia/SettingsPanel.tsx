"use client";

import { useState } from "react";
import { formatRupiah, formatWibDateTime } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BUTTON, PRIMARY, INPUT, Field, Panel, Feedback, type PanelState, type ProviderHealth, type Row } from "./shared";

export type SettingsData = { settings: Record<string, number>; balance_history: Row[] };
export function SettingsPanel({ health, settings }: { health: PanelState<{ providers: ProviderHealth[] }>; settings: PanelState<SettingsData> }) {
  const [draft, setDraft] = useState<Row | null>(null);
  const provider = health.data.providers.find(p => p.supplier === "indosmm");
  const hasSettings = Object.keys(settings.data.settings).length > 0;
  return <Panel title="Pengaturan" description="Atur kelompok harga. Batas operasional mengikuti konfigurasi server.">
    <Feedback panel={settings} />
    {!settings.loading && !settings.error && !hasSettings && <p className="py-4 text-sm text-white/55">Belum ada pengaturan harga. Muat ulang untuk memeriksa kembali.</p>}
    {!settings.loading && !settings.error && hasSettings && <>
      <form aria-label="Pengaturan Pedia" className="space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setDraft(Object.fromEntries([1, 2, 3].flatMap(g => [`pedia_markup_g${g}`, `pedia_min_profit_g${g}`]).map(key => [key, Number(f.get(key))]))); }}>
        <h4 className="text-sm font-semibold text-white">Kelompok harga</h4><fieldset disabled={settings.busy} className="grid gap-3 sm:grid-cols-3">{[1, 2, 3].map(g => <div key={g} className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4"><h5 className="text-sm font-semibold text-white">G{g}</h5><Field label={`Markup G${g} (%)`}><input name={`pedia_markup_g${g}`} type="number" min={0} max={1000} step="any" required defaultValue={settings.data.settings[`pedia_markup_g${g}`]} className={INPUT} /></Field><Field label={`Minimum untung G${g} (Rp)`}><input name={`pedia_min_profit_g${g}`} type="number" min={0} max={10000000} required defaultValue={settings.data.settings[`pedia_min_profit_g${g}`]} className={INPUT} /></Field></div>)}</fieldset>
        <p className="text-xs text-white/55">Harga setiap varian tetap dikelola melalui editor produk.</p><button className={PRIMARY} disabled={settings.busy}>Simpan pengaturan</button>
      </form>
      <dl className="my-5 grid gap-3 sm:grid-cols-2">{[["pedia_min_order_rp", "Minimum order"], ["pedia_balance_alert_rp", "Ambang saldo"]].map(([key, label]) => <div key={key} className="rounded-xl border border-white/10 p-4"><dt className="text-xs text-white/55">{label} <span className="block pt-1 text-white/40">dari konfigurasi server</span></dt><dd className="mt-2 text-sm font-semibold text-white">{settings.data.settings[key] == null ? "Belum tersedia" : formatRupiah(settings.data.settings[key])}</dd></div>)}</dl>
    </>}
    <section className="my-5 space-y-3 border-t border-white/10 pt-5" aria-label="Saldo dan kesehatan IndoSMM"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold text-white">Saldo dan kesehatan IndoSMM</h4><button className={BUTTON} disabled={health.loading} onClick={() => void health.load()}>Periksa saldo dan health</button></div><Feedback panel={health} />{provider && <div className="space-y-1 text-xs text-white/65"><p className="text-sm font-semibold text-white">{provider.balance.value == null ? "Saldo belum tersedia" : formatRupiah(provider.balance.value)} <span className="font-normal text-white/55">{provider.balance.stale ? "· saldo tersimpan" : "· saldo terkini"}</span></p><p>{provider.pricing_verified ? "Katalog dan tarif terbaca" : "Katalog dan tarif belum terverifikasi"} · Diperbarui {formatWibDateTime(provider.last_sync_at ?? "") ?? "belum tersedia"}</p>{provider.error && <p className="text-amber-300">Pemeriksaan IndoSMM belum lengkap. Coba periksa kembali.</p>}</div>}</section>
    <details className="border-t border-white/10 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-white">Riwayat saldo 7 hari</summary><div className="divide-y divide-white/10">{settings.data.balance_history.filter(r => r.supplier === "indosmm").map((r, i) => <div key={i} className="flex flex-wrap justify-between gap-2 py-3 text-xs"><strong className="text-white">{formatRupiah(Number(r.balance))}</strong><span className="text-white/55">{formatWibDateTime(String(r.created_at)) ?? "-"}</span></div>)}</div>{!settings.loading && !settings.error && !settings.data.balance_history.length && <p className="py-3 text-sm text-white/55">Belum ada riwayat saldo.</p>}</details>
    <ConfirmDialog open={!!draft} title="Simpan pengaturan Pedia?" description="Nilai kelompok harga akan diperbarui. Pengaturan varian tetap dikelola per produk." confirmLabel="Simpan" variant="default" loading={settings.busy} onClose={() => { if (!settings.busy) setDraft(null); }} onConfirm={async () => { if (draft && await settings.write("/api/admin/pedia/settings", draft, "Pengaturan tersimpan.")) setDraft(null); }} />
  </Panel>;
}
