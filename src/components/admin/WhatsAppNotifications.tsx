"use client";
import { useEffect, useState } from "react";

type State = { config?: { enabled: boolean }; gateway?: { connected: boolean; botNumber: string; groupName?: string; pairingCode?: string; blocked?: boolean; error?: string } | null; error?: string };
export function WhatsAppNotifications() {
  const [state, setState] = useState<State>({});
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  async function request(action?: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/whatsapp-notifications", action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) } : { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Gagal memeriksa koneksi.");
      if (body.gateway?.pairingCode) setCode(body.gateway.pairingCode);
      if (action === "enable" || action === "disable") {
        const fresh = await fetch("/api/admin/whatsapp-notifications", { cache: "no-store" });
        if (!fresh.ok) throw new Error("Gagal memeriksa koneksi.");
        setState(await fresh.json());
      } else setState(current => ({ ...current, ...body, error: body.error }));
    } catch (error) { setState(current => ({ ...current, error: error instanceof Error ? error.message : "Gateway belum siap." })); }
    finally { setBusy(false); }
  }
  useEffect(() => { void request(); }, []);
  return <section className="ax-glass mt-5 rounded-[22px] p-5" aria-label="Notifikasi transaksi WhatsApp">
    <h2 className="text-base font-semibold text-white">Notifikasi transaksi ke grup WhatsApp</h2>
    <p className="mt-2 text-xs leading-6 text-white/60">Bot 6283181632507 · Grup AXVARA&apos;S. Hanya pesanan selesai, identitas pembeli disamarkan. Pengaktifan mulai dari transaksi baru.</p>
    <p className="mt-2 text-sm text-white/75">{state.gateway?.connected ? `Bot tersambung${state.gateway.groupName ? ` · ${state.gateway.groupName}` : " · grup belum ditemukan"}` : "Bot belum tersambung"} · {state.config?.enabled ? "Notifikasi aktif" : "Notifikasi belum aktif"}</p>
    {state.gateway?.blocked && <p role="status" className="mt-2 text-xs text-amber-200">Pengiriman dijeda. Periksa WhatsApp nomor bot sebelum melanjutkan.</p>}
    {(state.error || state.gateway?.error) && <p role="alert" className="mt-2 text-xs text-amber-200">{state.error || state.gateway?.error}</p>}
    {code && !state.gateway?.connected && <div className="mt-3 rounded-xl border border-cyan-400/20 p-3">
      <p className="text-xl font-bold tracking-widest text-cyan-200">{code}</p>
      <p className="mt-2 text-xs leading-6 text-white/65">Di WhatsApp nomor bot: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon. Masukkan kode ini, lalu cek koneksi. Kode berlaku singkat; jangan dibagikan.</p>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">
      {([['pair','Hubungkan nomor bot'],['status','Cek koneksi'],[state.config?.enabled ? 'disable' : 'enable',state.config?.enabled ? 'Nonaktifkan notifikasi' : 'Aktifkan notifikasi']] as const).map(([action,label]) => <button type="button" key={action} disabled={busy || (action === "pair" && Boolean(state.gateway?.connected))} onClick={() => void request(action === "status" ? undefined : action)} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-semibold text-white/80 disabled:opacity-40">{busy ? "Memproses…" : label}</button>)}
    </div>
  </section>;
}
