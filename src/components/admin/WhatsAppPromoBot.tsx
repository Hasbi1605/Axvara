"use client";
import { useEffect, useState } from "react";
import { WA_GROUP_HREF } from "@/lib/site";
import { normalizeBotNumber } from "@/lib/whatsapp/bot-number";
import type { PromoBotConfig, PromoBotGroup, PromoBotStatus } from "@/lib/whatsapp/promo-bot";
import { Badge, Button, Card, Checkbox, Input, Label } from "./ui";

type State = { config?: PromoBotConfig | null; gateway?: PromoBotStatus | null; error?: string };
const MAX_GROUPS = 20;

export function WhatsAppPromoBot() {
  const [state, setState] = useState<State>({});
  const [groups, setGroups] = useState<PromoBotGroup[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editingNumber, setEditingNumber] = useState(false);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [link, setLink] = useState(WA_GROUP_HREF);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const gateway = state.gateway;
  const phone = gateway?.botNumber ?? null;
  const identity = { botNumber: phone, botRevision: gateway?.botRevision ?? null };
  const sameIdentity = Boolean(phone && state.config?.botNumber === phone && state.config?.botRevision === identity.botRevision);
  const saved = sameIdentity ? state.config?.groups ?? [] : [];
  const active = Boolean(sameIdentity && state.config?.enabled && !gateway?.blocked);
  const connected = Boolean(gateway?.connected);
  const showNumberForm = editingNumber || (Boolean(gateway) && !phone);
  const newNumber = normalizeBotNumber(number);
  const dot = gateway?.blocked ? "bg-admin-danger" : active ? "bg-admin-success" : connected ? "bg-admin-warning" : "bg-admin-muted";
  const statusText = gateway?.blocked ? "Bot dijeda" : connected ? "Bot tersambung" : phone ? "Bot belum tersambung" : "Nomor bot belum diatur";

  async function load() {
    const response = await fetch("/api/admin/whatsapp-promo-bot", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Gagal memeriksa koneksi.");
    setState(body);
    if (body.gateway?.connected) setCode("");
    return body as State;
  }
  async function post(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/admin/whatsapp-promo-bot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...identity, ...extra }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Permintaan gagal.");
    return body;
  }
  async function run(task: () => Promise<void>, onError?: () => Promise<void>) {
    setBusy(true); setNotice(""); setState(s => ({ ...s, error: undefined }));
    try { await task(); }
    catch (error) {
      if (onError) { try { await onError(); } catch { /* keep last known state */ } }
      setState(s => ({ ...s, error: error instanceof Error ? error.message : "Gateway belum siap." }));
    } finally { setBusy(false); }
  }
  const check = () => run(async () => { await load(); });
  const pair = () => run(async () => {
    setCode("");
    const body = await post("pair");
    setState(s => ({ ...s, gateway: { ...s.gateway!, ...body.gateway } }));
    setCode(body.gateway?.pairingCode || "");
  });
  const toggle = () => run(async () => { await post(active ? "disable" : "enable"); await load(); });
  const saveNumber = () => run(async () => {
    setCode("");
    await post("number", { newBotNumber: number });
    await load();
    setEditingNumber(false); setNumber(""); setGroups(null);
  }, async () => { await load(); });
  const openGroups = () => run(async () => {
    const response = await fetch("/api/admin/whatsapp-promo-bot?groups=1", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Gagal memuat grup.");
    setState(body); setGroups(body.groups || []);
    setSelected((body.config?.groups ?? []).map((g: { id: string }) => g.id));
  });
  const saveGroups = () => run(async () => {
    const wasActive = active;
    await post("save_groups", { groupIds: selected });
    // Saving pauses the bot server-side; restore the previous on/off state.
    // A mid-slot re-enable starts from the next slot (enabledAt).
    if (wasActive && selected.length) await post("enable");
    await load();
    setGroups(null);
    setNotice(wasActive && selected.length ? "Grup disimpan. Promo aktif lagi mulai jadwal berikutnya." : "Grup disimpan.");
  });

  useEffect(() => {
    void check();
    void fetch("/api/store-settings", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(body => setLink(body.settings?.whatsappGroupUrl || WA_GROUP_HREF)).catch(() => {});
  }, []);

  return <Card className="mt-6 p-6" role="region" aria-label="Bot Promo WhatsApp">
    <h2 className="text-base font-semibold text-admin-fg">Bot Promo ke grup WhatsApp</h2>
    <p className="mt-1 text-sm text-admin-muted">Bot {phone || "belum diatur"} · {saved.length} grup tujuan. Katalog ready yang sama dengan AXVARA&apos;S pukul 09.00 dan 17.00 WIB.</p>
    <p className="mt-3 flex items-center gap-2 text-sm font-medium text-admin-fg"><span aria-hidden="true" className={`inline-block size-2 shrink-0 rounded-full ${dot}`} />{statusText} · {active ? "Promo aktif" : "Promo belum aktif"}</p>
    {gateway?.blocked && <p role="status" className="mt-3 rounded-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-2 text-sm text-admin-warning">Pengiriman dijeda. Periksa WhatsApp nomor bot sebelum melanjutkan.</p>}
    {(state.error || gateway?.error) && <p role="alert" className="mt-3 rounded-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{state.error || gateway?.error}</p>}
    {notice && <p role="status" className="mt-3 text-sm text-admin-success">{notice}</p>}
    {code && !connected && <div className="mt-4 rounded-md border border-admin-info/25 bg-admin-info/10 p-4">
      <p className="font-mono text-xl font-semibold tracking-widest text-admin-fg">{code}</p>
      <p className="mt-2 text-xs leading-6 text-admin-muted">Di WhatsApp {phone}: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon. Masukkan kode ini, lalu cek koneksi.</p>
    </div>}

    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={busy || !phone || connected} onClick={() => void pair()}>Hubungkan nomor bot</Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void check()}>Cek koneksi</Button>
      <Button type="button" variant={active ? "outline" : "default"} disabled={busy || (!active && (!connected || Boolean(gateway?.blocked) || !saved.length))} onClick={() => void toggle()}>{active ? "Nonaktifkan promo" : "Aktifkan promo"}</Button>
      <Button type="button" variant="outline" disabled={busy || !connected || groups !== null} onClick={() => void openGroups()}>Edit grup</Button>
      {phone && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditingNumber(!editingNumber); setNumber(""); }}>{editingNumber ? "Batal ganti nomor" : "Ganti nomor bot"}</Button>}
    </div>

    {showNumberForm && <form className="mt-4 grid max-w-xl gap-3 rounded-md border border-admin-border p-4" onSubmit={event => { event.preventDefault(); if (!busy && newNumber && newNumber !== phone) void saveNumber(); }}>
      <Label htmlFor="promo-bot-number">{phone ? "Nomor WhatsApp bot baru" : "Nomor WhatsApp bot promo"}</Label>
      <Input id="promo-bot-number" type="tel" inputMode="tel" autoComplete="off" required maxLength={24} value={number} disabled={busy} onChange={e => setNumber(e.target.value)} placeholder="628123456789 atau 08123456789" />
      {phone && <p className="text-xs leading-5 text-admin-muted">Nomor baru memutus sesi lama dan menjeda promo sampai dihubungkan lagi.</p>}
      <Button type="submit" className="w-fit" disabled={busy || !newNumber || newNumber === phone}>{busy ? "Menyimpan…" : "Simpan nomor"}</Button>
    </form>}

    {groups === null ? <div className="mt-4">
      <p className="text-sm font-medium text-admin-fg">Grup tujuan</p>
      {saved.length ? <div className="mt-2 flex flex-wrap gap-2">{saved.map(g => <Badge key={g.id} variant="secondary" className="max-w-full truncate">{g.subject}</Badge>)}</div>
        : <p className="mt-1 text-sm text-admin-muted">Belum ada grup. Hubungkan bot, lalu klik Edit grup.</p>}
    </div> : <div className="mt-4 rounded-md border border-admin-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-admin-fg">Pilih grup tujuan</p><p className="text-sm text-admin-muted">{selected.length}/{MAX_GROUPS} dipilih</p></div>
      {!groups.length && <p className="mt-2 text-sm text-admin-muted">Nomor bot belum bergabung di grup mana pun.</p>}
      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">{groups.map((group, i) => <div key={group.id} className="flex items-start gap-3">
        <Checkbox id={`promo-group-${i}`} checked={selected.includes(group.id)} disabled={busy || !group.canSend || (selected.length >= MAX_GROUPS && !selected.includes(group.id))} onCheckedChange={checked => setSelected(ids => checked === true ? [...ids, group.id] : ids.filter(id => id !== group.id))} />
        <div className="min-w-0"><Label className="break-words" htmlFor={`promo-group-${i}`}>{group.subject}</Label>{!group.canSend && <p className="text-xs text-admin-muted">Hanya admin yang bisa kirim pesan</p>}</div>
      </div>)}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !groups.length} onClick={() => void saveGroups()}>{busy ? "Menyimpan…" : "Simpan grup"}</Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => setGroups(null)}>Batal</Button>
      </div>
    </div>}

    <p className="mt-4 break-all text-xs text-admin-muted">Baris terakhir pesan: 👥 Join Grup WA: {link}</p>
  </Card>;
}
