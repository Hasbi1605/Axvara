"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SALES_BOT_NUMBER, normalizeBotNumber } from "@/lib/whatsapp/bot-number";

type State = { config?: { enabled: boolean; botNumber?: string; botRevision?: string }; gateway?: { connected: boolean; botNumber: string; botRevision?: string; groupName?: string; pairingCode?: string; blocked?: boolean; error?: string } | null; error?: string };
export function WhatsAppNotifications() {
  const [state, setState] = useState<State>({});
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [editing, setEditing] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const phone = state.gateway?.botNumber;
  const revision = state.gateway?.botRevision || "initial";
  const active = state.config?.enabled && (state.config.botNumber || DEFAULT_SALES_BOT_NUMBER) === phone && (state.config.botRevision || "initial") === revision;
  async function refresh() {
    const fresh = await fetch("/api/admin/whatsapp-notifications", { cache: "no-store" });
    if (!fresh.ok) throw new Error("Gagal memeriksa koneksi.");
    const body = await fresh.json();
    setState(body);
    setCode("");
  }
  async function request(action?: string) {
    setBusy(true);
    if (action === "number") setCode("");
    try {
      const r = await fetch("/api/admin/whatsapp-notifications", action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, botNumber: phone, botRevision: revision, ...(action === "number" ? { newBotNumber: newNumber } : {}) }) } : { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Gagal memeriksa koneksi.");
      if (body.gateway === null) setCode("");
      if (body.gateway && (body.gateway.botNumber !== phone || (body.gateway.botRevision || "initial") !== revision)) setCode("");
      if (body.gateway?.pairingCode) setCode(body.gateway.pairingCode);
      if (["enable", "disable", "number"].includes(action || "")) {
        await refresh();
        if (action === "number") { setEditing(false); setNewNumber(""); }
      } else {
        setState(current => ({ ...current, ...body, error: body.error }));
        if (body.gateway?.connected) setCode("");
      }
    } catch (error) {
      // A timeout may still have changed the durable gateway settings. Refresh
      // identity before another action, and never keep displaying an old code.
      if (action === "number") { try { await refresh(); } catch { /* retain last known identity */ } }
      setState(current => ({ ...current, error: error instanceof Error ? error.message : "Gateway belum siap." }));
    } finally { setBusy(false); }
  }
  useEffect(() => { void request(); }, []);
  return <section className="ax-glass mt-5 rounded-[22px] p-5" aria-label="Notifikasi transaksi WhatsApp">
    <h2 className="text-base font-semibold text-white">Notifikasi transaksi ke grup WhatsApp</h2>
    <p className="mt-2 text-xs leading-6 text-white/60">Bot {phone || "belum tersedia"} · Grup AXVARA&apos;S. Hanya pesanan selesai, identitas pembeli disamarkan. Pengaktifan mulai dari transaksi baru.</p>
    <p className="mt-2 text-sm text-white/75">{state.gateway?.connected ? `Bot tersambung${state.gateway.groupName ? ` · ${state.gateway.groupName}` : " · grup belum ditemukan"}` : "Bot belum tersambung"} · {active ? "Notifikasi aktif" : "Notifikasi belum aktif"}</p>
    {state.gateway?.blocked && <p role="status" className="mt-2 text-xs text-amber-200">Pengiriman dijeda. Periksa WhatsApp nomor bot sebelum melanjutkan.</p>}
    {(state.error || state.gateway?.error) && <p role="alert" className="mt-2 text-xs text-amber-200">{state.error || state.gateway?.error}</p>}
    {code && state.gateway && !state.gateway.connected && <div className="mt-3 rounded-xl border border-cyan-400/20 p-3">
      <p className="text-xl font-bold tracking-widest text-cyan-200">{code}</p>
      <p className="mt-2 text-xs leading-6 text-white/65">Di WhatsApp {phone}: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon. Masukkan kode ini, lalu cek koneksi. Kode berlaku singkat; jangan dibagikan.</p>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">
      {([['pair','Hubungkan nomor bot'],['status','Cek koneksi'],[active ? 'disable' : 'enable',active ? 'Nonaktifkan notifikasi' : 'Aktifkan notifikasi']] as const).map(([action,label]) => <button type="button" key={action} disabled={busy || (action !== "status" && !state.gateway) || (action === "pair" && Boolean(state.gateway?.connected))} onClick={() => void request(action === "status" ? undefined : action)} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-semibold text-white/80 disabled:opacity-40">{busy ? "Memproses…" : label}</button>)}
      <button type="button" disabled={busy || !state.gateway?.botRevision} onClick={() => { setEditing(!editing); setNewNumber(""); }} className="min-h-11 rounded-xl border border-white/15 px-4 text-xs font-semibold text-white/80 disabled:opacity-40">{editing ? "Batal ganti nomor" : "Ganti nomor bot"}</button>
    </div>
    {editing && <form className="mt-4 max-w-xl space-y-3 rounded-xl border border-white/10 p-4" onSubmit={event => { event.preventDefault(); if (!busy && normalizeBotNumber(newNumber) && normalizeBotNumber(newNumber) !== phone) void request("number"); }}>
      <label className="block text-sm text-white/80" htmlFor="notification-bot-number">Nomor WhatsApp bot baru</label>
      <input id="notification-bot-number" type="tel" inputMode="tel" autoComplete="off" required maxLength={24} value={newNumber} onChange={event => setNewNumber(event.target.value)} placeholder="628123456789 atau 08123456789" disabled={busy} aria-describedby="notification-bot-number-help" className="min-h-11 w-full rounded-xl border border-white/10 bg-[#101428] px-3 text-sm text-white outline-none focus:border-cyan-400/60"/>
      <p id="notification-bot-number-help" className="text-xs leading-6 text-white/60">Menyimpan nomor baru memutus koneksi bot lama dan menjeda notifikasi. Setelah itu, hubungkan nomor baru, masukkan ke grup AXVARA&apos;S, cek koneksi, lalu aktifkan notifikasi kembali. Nomor WhatsApp admin toko tetap terpisah.</p>
      <button type="submit" disabled={busy || !normalizeBotNumber(newNumber) || normalizeBotNumber(newNumber) === phone} className="min-h-11 rounded-xl bg-cyan-400 px-4 text-xs font-semibold text-[#080c1e] disabled:opacity-40">{busy ? "Menyimpan…" : "Simpan nomor bot"}</button>
    </form>}
  </section>;
}
