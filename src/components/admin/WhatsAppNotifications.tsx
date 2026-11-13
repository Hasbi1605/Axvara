"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SALES_BOT_NUMBER, normalizeBotNumber } from "@/lib/whatsapp/bot-number";
import { Button, Card, Input, Label } from "./ui";

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
  return <Card className="mt-6 p-6" role="region" aria-label="Katalog ready WhatsApp">
    <h2 className="text-base font-semibold text-admin-fg">Katalog ready ke grup WhatsApp</h2>
    <p className="mt-1 text-sm text-admin-muted">Bot {phone || "belum tersedia"} · Grup AXVARA&apos;S. Katalog ready beserta gambar promosi pukul 09.00 dan 17.00 WIB. Notifikasi pembelian berhasil tidak dikirim ke grup.</p>
    <p className="mt-3 flex items-center gap-2 text-sm font-medium text-admin-fg"><span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${active ? "bg-admin-success" : state.gateway?.connected ? "bg-admin-warning" : "bg-admin-muted"}`} />{state.gateway?.connected ? `Bot tersambung${state.gateway.groupName ? ` · ${state.gateway.groupName}` : " · grup belum ditemukan"}` : "Bot belum tersambung"} · {active ? "Notifikasi aktif" : "Notifikasi belum aktif"}</p>
    {state.gateway?.blocked && <p role="status" className="mt-3 rounded-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2 text-sm text-admin-warning">Pengiriman dijeda. Periksa WhatsApp nomor bot sebelum melanjutkan.</p>}
    {(state.error || state.gateway?.error) && <p role="alert" className="mt-3 rounded-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{state.error || state.gateway?.error}</p>}
    {code && state.gateway && !state.gateway.connected && <div className="mt-4 rounded-md border border-admin-info/25 bg-admin-info/10 p-4">
      <p className="font-mono text-xl font-semibold tracking-widest text-admin-fg">{code}</p>
      <p className="mt-2 text-xs leading-6 text-admin-muted">Di WhatsApp {phone}: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon. Masukkan kode ini, lalu cek koneksi. Kode berlaku singkat; jangan dibagikan.</p>
    </div>}
    <div className="mt-4 flex flex-wrap gap-2">
      {([['pair','Hubungkan nomor bot'],['status','Cek koneksi'],[active ? 'disable' : 'enable',active ? 'Nonaktifkan notifikasi' : 'Aktifkan notifikasi']] as const).map(([action,label]) => <Button type="button" key={action} disabled={busy || (action !== "status" && !state.gateway) || (action === "pair" && Boolean(state.gateway?.connected))} onClick={() => void request(action === "status" ? undefined : action)} variant={action === "enable" ? "default" : "outline"}>{busy ? "Memproses…" : label}</Button>)}
      <Button type="button" variant="ghost" disabled={busy || !state.gateway?.botRevision} onClick={() => { setEditing(!editing); setNewNumber(""); }}>{editing ? "Batal ganti nomor" : "Ganti nomor bot"}</Button>
    </div>
    {editing && <form className="mt-4 grid max-w-xl gap-3 rounded-md border border-admin-border p-4" onSubmit={event => { event.preventDefault(); if (!busy && normalizeBotNumber(newNumber) && normalizeBotNumber(newNumber) !== phone) void request("number"); }}>
      <Label htmlFor="notification-bot-number">Nomor WhatsApp bot baru</Label>
      <Input id="notification-bot-number" type="tel" inputMode="tel" autoComplete="off" required maxLength={24} value={newNumber} onChange={event => setNewNumber(event.target.value)} placeholder="628123456789 atau 08123456789" disabled={busy} aria-describedby="notification-bot-number-help"/>
      <p id="notification-bot-number-help" className="text-xs leading-5 text-admin-muted">Menyimpan nomor baru memutus koneksi bot lama dan menjeda notifikasi. Setelah itu, hubungkan nomor baru, masukkan ke grup AXVARA&apos;S, cek koneksi, lalu aktifkan notifikasi kembali. Nomor WhatsApp admin toko tetap terpisah.</p>
      <Button type="submit" className="w-fit" disabled={busy || !normalizeBotNumber(newNumber) || normalizeBotNumber(newNumber) === phone}>{busy ? "Menyimpan…" : "Simpan nomor bot"}</Button>
    </form>}
  </Card>;
}
