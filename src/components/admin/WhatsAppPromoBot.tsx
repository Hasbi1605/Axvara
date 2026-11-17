"use client";
import { useEffect, useState } from "react";
import { WA_GROUP_HREF } from "@/lib/site";
import { normalizeBotNumber } from "@/lib/whatsapp/bot-number";
import type { PromoBotConfig, PromoBotGroup, PromoBotStatus } from "@/lib/whatsapp/promo-bot";
import { Badge, Button, Card, Checkbox, Input, Label, Switch } from "./ui";

type State = { config?: PromoBotConfig | null; gateway?: PromoBotStatus | null; error?: string };
export function WhatsAppPromoBot() {
  const [state, setState] = useState<State>({});
  const [groups, setGroups] = useState<PromoBotGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [link, setLink] = useState(WA_GROUP_HREF);
  const [busy, setBusy] = useState(false);
  const identity = { botNumber: state.gateway?.botNumber ?? null, botRevision: state.gateway?.botRevision ?? null };
  const active = Boolean(state.config?.enabled && !state.gateway?.blocked && state.config.botNumber === identity.botNumber && state.config.botRevision === identity.botRevision);
  async function refresh() {
    const response = await fetch("/api/admin/whatsapp-promo-bot", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Gagal memeriksa koneksi.");
    setState(body); setSelected(body.config?.groups.map((g: { id: string }) => g.id) || []);
    setNumber(body.gateway?.botNumber || ""); setCode(""); setGroups([]);
  }
  async function request(action: string) {
    setBusy(true); setState(s => ({ ...s, error: undefined }));
    if (action === "number" || action === "pair") setCode("");
    try {
      const response = await fetch(`/api/admin/whatsapp-promo-bot${action === "groups" ? "?groups=1" : ""}`, action === "groups" ? { cache: "no-store" } : {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...identity, ...(action === "number" ? { newBotNumber: number } : {}), ...(action === "save_groups" ? { groupIds: selected } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Permintaan gagal.");
      if (action === "groups") { setGroups(body.groups || []); setState(body); }
      else if (action === "pair") { setState(s => ({ ...s, gateway: { ...s.gateway, ...body.gateway } })); setCode(body.gateway?.pairingCode || ""); }
      else await refresh();
    } catch (error) {
      if (action === "number") { try { await refresh(); } catch { /* retain last known identity */ } }
      setState(s => ({ ...s, error: error instanceof Error ? error.message : "Gateway belum siap." }));
    } finally { setBusy(false); }
  }
  useEffect(() => {
    setBusy(true);
    void refresh().catch(error => setState({ error: error.message })).finally(() => setBusy(false));
    void fetch("/api/store-settings", { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(body => setLink(body.settings?.whatsappGroupUrl || WA_GROUP_HREF)).catch(() => {});
  }, []);
  return <Card className="mt-6 space-y-4 p-6" role="region" aria-label="Bot Promo WhatsApp">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold text-admin-fg">Bot Promo WhatsApp</h2><Badge variant="secondary">{state.gateway?.blocked ? "Dijeda" : state.gateway?.connected ? "Terhubung" : "Belum terhubung"}</Badge></div>
    {(state.error || state.gateway?.error) && <p role="alert" className="text-sm text-admin-danger">{state.error || state.gateway?.error}</p>}
    <div className="grid max-w-xl gap-2"><Label htmlFor="promo-bot-number">Nomor Bot Promo</Label><Input id="promo-bot-number" type="tel" inputMode="tel" autoComplete="off" maxLength={24} value={number} disabled={busy} onChange={e => setNumber(e.target.value)} placeholder="628123456789 atau 08123456789" /></div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !normalizeBotNumber(number) || !state.gateway} onClick={() => void request("number")}>Simpan nomor</Button>
      <Button variant="outline" disabled={busy || !identity.botNumber || Boolean(state.gateway?.connected)} onClick={() => void request("pair")}>Buat kode pairing</Button>
      <Button variant="outline" disabled={busy} onClick={() => { setBusy(true); void refresh().catch(error => setState(s => ({ ...s, error: error.message }))).finally(() => setBusy(false)); }}>Cek koneksi</Button>
      <Button variant="outline" disabled={busy || !state.gateway?.connected} onClick={() => void request("groups")}>Muat grup</Button>
    </div>
    {code && !state.gateway?.connected && <div role="status" className="space-y-2"><p className="font-mono text-xl tracking-widest text-admin-fg">{code}</p><p className="text-sm text-admin-muted">WhatsApp nomor Bot Promo: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon. Masukkan kode, lalu cek koneksi.</p></div>}
    <p className="text-sm text-admin-muted">{selected.length}/20 dipilih</p>
    <div className="space-y-3">{groups.map((group, i) => <div key={group.id} className="flex items-start gap-3"><Checkbox id={`promo-group-${i}`} checked={selected.includes(group.id)} disabled={busy || !group.canSend || (selected.length >= 20 && !selected.includes(group.id))} onCheckedChange={checked => setSelected(ids => checked === true ? [...ids, group.id] : ids.filter(id => id !== group.id))} /><div className="min-w-0"><Label className="break-words" htmlFor={`promo-group-${i}`}>{group.subject}</Label><p className="break-all text-xs text-admin-muted">{group.id}{!group.canSend ? " — Bot tidak bisa mengirim di grup ini" : ""}</p></div></div>)}</div>
    {!groups.length && <p className="text-sm text-admin-muted">{state.config?.groups.length ? `Grup tersimpan: ${state.config.groups.map(g => g.subject).join(", ")}. Muat grup untuk mengubah pilihan.` : "Belum ada grup. Hubungkan bot, lalu muat grup untuk memilih tujuan."}</p>}
    <Button variant="outline" disabled={busy || !groups.length} onClick={() => void request("save_groups")}>Simpan grup</Button>
    <div className="flex items-center gap-3"><Switch id="promo-bot-enabled" checked={active} disabled={busy || (!active && (!state.gateway?.connected || state.gateway.blocked || !state.config?.groups.length))} onCheckedChange={checked => void request(checked ? "enable" : "disable")} /><Label htmlFor="promo-bot-enabled">Aktifkan Bot Promo</Label></div>
    <p className="break-all text-sm text-admin-muted">Join Grup WA: {link}</p>
    <p className="text-sm leading-6 text-admin-muted">Dikirim 09.00 dan 17.00 WIB, jeda sekitar 1 menit antar grup. Gunakan nomor yang memang biasa promosi di grup tersebut.</p>
  </Card>;
}
