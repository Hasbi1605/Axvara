"use client";
import { useCallback, useEffect, useState } from "react";
import { useAdminDraft } from "./AdminWorkspace";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { CHANNELS, CHANNEL_LABELS, UUID, type BroadcastChannel, type BroadcastContent, type BroadcastTemplate as Template, type BroadcastSnapshot } from "@/lib/broadcasts/model";
import { formatWibDateTime } from "@/lib/utils";
import { Plus, RefreshCw, Send } from "lucide-react";
import { Badge, Button, Card, Checkbox, Input, Label, Textarea, PageHeader, Skeleton, Tabs, TabsList, TabsTrigger, Table, TableHeader, TableHead, TableBody, TableRow, TableCell, Dialog as EditorDialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui";

type Progress = { channel: BroadcastChannel; status: string; n: number; last_error?: string };
type BroadcastTemplate = Template & { updated_at?: string };
type Campaign = { id: string; content: BroadcastContent; channels: BroadcastChannel[]; status: string; created_at: string; progress: Progress[] };
type Launch = { action: "send"; id: string; templateId: string; revision: number; channels: BroadcastChannel[]; waIdentity?: { botNumber: string; botRevision: string; groupId: string } };
type Review = { snapshot: BroadcastSnapshot; counts: Partial<Record<BroadcastChannel, number>> };
const EMPTY: BroadcastContent = { name: "", title: "", body: "", cta_label: "", cta_url: "" };
const PENDING = "axvara-broadcast-pending";
const STATUS: Record<string, string> = { pending: "Menunggu", sending: "Diproses", sent: "Terkirim", failed: "Gagal", unknown: "Perlu diperiksa", skipped: "Dilewati", canceled: "Dihentikan" };
function contentOf(t: BroadcastTemplate): BroadcastContent { return { name: t.name, title: t.title, body: t.body, cta_label: t.cta_label, cta_url: t.cta_url }; }

export function BroadcastManager() {
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([]), [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [tab, setTab] = useState("templates"), [editor, setEditor] = useState(false), [sendDialog, setSendDialog] = useState(false);
  const [selected, setSelected] = useState<BroadcastTemplate | null>(null), [draft, setDraft] = useState<BroadcastContent>({ ...EMPTY });
  const [channels, setChannels] = useState<BroadcastChannel[]>([]), [review, setReview] = useState<Review | null>(null);
  const [pending, setPending] = useState<Launch | null>(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null), [discard, setDiscard] = useState(false);
  const dirty = editor && JSON.stringify(draft) !== JSON.stringify(selected ? contentOf(selected) : EMPTY);
  useAdminDraft(dirty || busy, busy);
  const clearPending = useCallback(() => { sessionStorage.removeItem(PENDING); setPending(null); }, []);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/broadcasts", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Siaran gagal dimuat.");
    setTemplates(data.templates || []); setCampaigns(data.campaigns || []);
    const stored = sessionStorage.getItem(PENDING);
    if (stored) { try { const p = JSON.parse(stored); if ((data.campaigns || []).some((c: Campaign) => c.id === p.id)) clearPending(); } catch { clearPending(); } }
    return data as { templates: BroadcastTemplate[]; campaigns: Campaign[] };
  }, [clearPending]);
  useEffect(() => {
    try { const p = JSON.parse(sessionStorage.getItem(PENDING) || "null"); if (p && UUID.test(p.id)) setPending(p); } catch { sessionStorage.removeItem(PENDING); }
    void load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);
  async function post(body: unknown) {
    const response = await fetch("/api/admin/broadcasts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) { if ((body as { action?: string }).action === "send" && [400, 409].includes(response.status)) clearPending(); throw new Error(data.error || "Permintaan belum berhasil."); }
    return data;
  }
  async function run(action: () => Promise<void>) { setBusy(true); setError(""); setNotice(""); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Permintaan belum berhasil."); } finally { setBusy(false); } }
  function choose(t: BroadcastTemplate | null) { setSelected(t); setDraft(t ? contentOf(t) : { ...EMPTY }); setReview(null); setChannels([]); setError(""); }
  function update(key: keyof BroadcastContent, value: string) { setDraft(v => ({ ...v, [key]: value })); setReview(null); }
  async function save() {
    if (selected?.archived || pending) return;
    await post({ action: "save", id: selected?.id, revision: selected?.revision, content: draft }); await load(); setEditor(false); setNotice("Template disimpan dan bisa dipakai berulang.");
  }
  async function send(payload: Launch) {
    sessionStorage.setItem(PENDING, JSON.stringify(payload)); setPending(payload);
    await post(payload); clearPending(); setReview(null); setSendDialog(false); setTab("history"); setNotice("Siaran masuk antrean. Perbarui riwayat untuk melihat perkembangannya."); await load();
  }
  const errorBox = error && <div role="alert" className="rounded-md border border-admin-danger/25 bg-admin-danger/10 p-3 text-sm text-admin-danger">{error}{!editor && !sendDialog && <Button variant="ghost" size="sm" onClick={() => void run(async () => { await load(); })}>Coba lagi</Button>}</div>;

  return <section className="mt-4 space-y-6" aria-label="Siaran admin">
    <PageHeader title="Siaran" description="Simpan template, tinjau tujuan, dan kirim pesan saat dibutuhkan." actions={<Button variant="outline" disabled={busy} onClick={() => void run(async () => { await load(); })}><RefreshCw /> Perbarui riwayat</Button>} />
    {!editor && !sendDialog && errorBox}
    {notice && <p role="status" className="rounded-md border border-admin-info/25 bg-admin-info/10 p-3 text-sm text-admin-info">{notice}</p>}
    {pending && <div className="rounded-md border border-admin-warning/25 bg-admin-warning/10 p-4"><p className="text-sm leading-6 text-admin-warning">Pengiriman sebelumnya belum terkonfirmasi. Perbarui riwayat atau coba lagi; percobaan ini akan memeriksa pengiriman yang sama.</p><Button variant="outline" size="sm" className="mt-3" disabled={busy} onClick={() => void run(() => send(pending))}>Coba lagi pengiriman</Button></div>}
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><TabsList aria-label="Bagian siaran"><TabsTrigger value="templates">Template</TabsTrigger><TabsTrigger value="history">Riwayat</TabsTrigger></TabsList>{tab === "templates" && <Button disabled={busy || !!pending} onClick={() => { choose(null); setEditor(true); }}><Plus /> Template baru</Button>}</div>
      {loading ? <Skeleton className="h-56 w-full" /> : tab === "templates" ? <Card className="overflow-hidden"><Table className="block md:table" aria-label="Template siaran"><TableHeader className="hidden md:table-header-group"><TableRow><TableHead>Nama</TableHead><TableHead>Judul</TableHead><TableHead>Status</TableHead><TableHead>Diperbarui</TableHead><TableHead className="text-right">Aksi</TableHead></TableRow></TableHeader><TableBody className="block md:table-row-group">{templates.map(t => <TableRow key={t.id} className="block md:table-row"><TableCell className="block break-words font-medium md:table-cell">{t.name}</TableCell><TableCell className="block break-words md:table-cell">{t.title}</TableCell><TableCell className="block md:table-cell"><Badge variant="secondary">{t.archived ? "Diarsipkan" : "Siap dipakai"}</Badge></TableCell><TableCell className="block text-xs text-admin-muted md:table-cell">{formatWibDateTime(t.updated_at) || "—"}</TableCell><TableCell className="block md:table-cell"><div className="flex gap-2 md:justify-end"><Button variant="outline" size="sm" disabled={busy || !!pending} onClick={() => { choose(t); setEditor(true); }}>Edit<span className="sr-only"> {t.name}</span></Button><Button variant="outline" size="sm" disabled={busy || !!pending || !!t.archived} onClick={() => { choose(t); setSendDialog(true); }}>Kirim<span className="sr-only"> {t.name}</span></Button></div></TableCell></TableRow>)}</TableBody></Table>{!templates.length && <p className="p-6 text-sm text-admin-muted">Belum ada template. Buat pesan pertama dengan Template baru.</p>}</Card> :
      <Card className="p-4 sm:p-6" role="region" aria-label="Riwayat siaran"><p className="text-sm text-admin-muted">Terkirim berarti diterima layanan pengirim, bukan bukti dibaca. Hasil yang belum pasti tidak dikirim ulang otomatis.</p><div className="mt-4 space-y-3">{campaigns.map(c => <article key={c.id} className="rounded-md border border-admin-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-sm font-semibold">{c.content.title}</p><p className="mt-1 text-xs text-admin-muted">{formatWibDateTime(c.created_at)} WIB · {c.status === "queued" ? "Dalam antrean" : c.status === "completed" ? "Selesai" : "Dihentikan"}</p></div>{c.status === "queued" && <Button variant="outline" size="sm" disabled={busy} onClick={() => setCancelId(c.id)}>Hentikan</Button>}</div><div className="mt-3 space-y-2">{c.channels.map(channel => <div key={channel} className="text-xs leading-6 text-admin-muted">{CHANNEL_LABELS[channel]} · {c.progress.filter(p => p.channel === channel).map(p => `${STATUS[p.status] || "Perlu diperiksa"}: ${p.n}`).join(" · ") || "Tidak ada penerima"}{c.progress.some(p => p.channel === channel && p.last_error === "bot_changed_review_required") && <p className="text-admin-warning">Nomor bot berubah. Hentikan siaran ini dan tinjau pengiriman baru.</p>}{c.progress.some(p => p.channel === channel && p.last_error === "telegram_channel_not_admin") && <p className="text-admin-warning">Bot belum menjadi Administrator channel atau izin kirim pesan belum aktif.</p>}</div>)}</div></article>)}{!campaigns.length && <p className="py-5 text-sm text-admin-muted">Belum ada siaran yang dikirim.</p>}</div></Card>}
    </Tabs>
    <EditorDialog open={editor} onOpenChange={open => { if (!busy) { if (!open && dirty) setDiscard(true); else setEditor(open); } }}><DialogContent className="max-w-xl p-5 sm:p-6" onEscapeKeyDown={event => { if (busy || dirty) { event.preventDefault(); if (!busy) setDiscard(true); } }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{selected ? "Edit template" : "Template baru"}</DialogTitle><DialogDescription>Perubahan hanya disimpan sebagai template; tidak mengirim siaran.</DialogDescription></DialogHeader>
      <div className="mt-4 space-y-4">{errorBox}{selected && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || dirty || !!pending} onClick={() => { setSelected(null); setDraft({ ...contentOf(selected), name: `${selected.name} (salinan)` }); setReview(null); }}>Salin template</Button><Button variant="outline" size="sm" disabled={busy || dirty || !!pending} onClick={() => void run(async () => { await post({ action: "archive", id: selected.id, revision: selected.revision, archived: !selected.archived }); await load(); setEditor(false); })}>{selected.archived ? "Pulihkan template" : "Arsipkan"}</Button></div>}
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); void run(save); }}><fieldset disabled={busy || !!pending || !!selected?.archived} className="space-y-4 disabled:opacity-60">
          <Label className="grid gap-2">Nama template<Input value={draft.name} maxLength={80} required onChange={e => update("name", e.target.value)} /></Label>
          <Label className="grid gap-2">Judul / subjek email<Input value={draft.title} maxLength={120} required onChange={e => update("title", e.target.value)} /></Label>
          <Label className="grid gap-2">Isi siaran<Textarea className="min-h-40 resize-y leading-6" value={draft.body} maxLength={3000} required onChange={e => update("body", e.target.value)} /></Label><p className="text-right text-xs text-admin-muted">{draft.body.length}/3000 karakter</p>
          <div className="grid gap-4 sm:grid-cols-2"><Label className="grid gap-2">Label tombol (opsional)<Input value={draft.cta_label} maxLength={24} onChange={e => update("cta_label", e.target.value)} /></Label><Label className="grid min-w-0 gap-2">Tautan tombol<Input value={draft.cta_url} maxLength={500} onChange={e => update("cta_url", e.target.value)} placeholder="https://… atau /produk" /></Label></div>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!dirty || !draft.name.trim() || !draft.title.trim() || !draft.body.trim()}>Simpan template</Button>{dirty && <Button variant="outline" type="button" onClick={() => choose(selected)}>Batal perubahan</Button>}</div>
        </fieldset></form>
        <MessagePreview content={draft} />
      </div>
    </DialogContent></EditorDialog>
    {sendDialog && selected && <Dialog title="Kirim siaran" busy={busy} onClose={() => !busy && setSendDialog(false)} className="max-w-xl p-5">
      <h2 className="text-lg font-semibold">Kirim siaran</h2><ol className="mt-2 flex gap-3 text-sm text-admin-muted" aria-label="Langkah pengiriman"><li aria-current={!review ? "step" : undefined}>1. Tujuan</li><li aria-current={review ? "step" : undefined}>2. Tinjau</li><li>3. Kirim</li></ol>
      <div className="mt-4 space-y-4">{errorBox}<MessagePreview content={contentOf(selected)} />
        {pending && <Button variant="outline" disabled={busy} onClick={() => void run(() => send(pending))}>Coba lagi pengiriman</Button>}
        <fieldset disabled={busy || !!pending || !!selected.archived} className="space-y-3"><legend className="mb-2 text-sm font-medium">Tujuan siaran</legend><div className="flex flex-wrap gap-3">{CHANNELS.map(channel => <Label key={channel} className="flex min-h-10 items-center gap-2"><Checkbox checked={channels.includes(channel)} onCheckedChange={checked => { setChannels(v => checked === true ? [...v, channel] : v.filter(c => c !== channel)); setReview(null); }} />{CHANNEL_LABELS[channel]}</Label>)}</div>
          {!review && <Button disabled={!channels.length} onClick={() => void run(async () => { setReview(await post({ action: "review", templateId: selected.id, revision: selected.revision, channels })); })}>Tinjau siaran</Button>}
        </fieldset>
        {review && <div><h3 className="font-semibold">Tinjau sebelum mengirim</h3><ul className="mt-3 space-y-2 text-sm">{channels.map(c => <li key={c}>{CHANNEL_LABELS[c]}: {review.counts[c] || 0} {c === "whatsapp" ? "grup" : c === "telegram_channel" ? "channel" : "penerima"}</li>)}</ul>{review.snapshot.tgChannel && <p className="mt-2 text-xs text-admin-muted">Channel {review.snapshot.tgChannel.title} ({review.snapshot.tgChannel.destination})</p>}{review.snapshot.wa && <p className="mt-2 text-xs text-admin-muted">Bot {review.snapshot.wa.botNumber} · Grup AXVARA&apos;S</p>}<p className="mt-3 text-xs text-admin-muted">Jumlah akhir mengikuti penerima aktif saat siaran mulai. Pengiriman berlangsung bertahap.</p><Button className="mt-4" disabled={busy || !!pending || !!selected.archived} onClick={() => void run(() => send({ action: "send", id: crypto.randomUUID(), templateId: selected.id, revision: selected.revision, channels, ...(review.snapshot.wa ? { waIdentity: { botNumber: review.snapshot.wa.botNumber, botRevision: review.snapshot.wa.botRevision, groupId: review.snapshot.wa.destination } } : {}) }))}><Send /> Kirim siaran sekarang</Button></div>}
        <Button variant="outline" disabled={busy} onClick={() => setSendDialog(false)}>Tutup</Button>
      </div>
    </Dialog>}
    <ConfirmDialog open={discard} title="Buang perubahan template?" description="Perubahan yang belum disimpan akan hilang." confirmLabel="Buang perubahan" onClose={() => setDiscard(false)} onConfirm={() => { setDiscard(false); setEditor(false); choose(selected); }} />
    <ConfirmDialog open={!!cancelId} title="Hentikan siaran?" description="Penerima yang belum diproses akan dihentikan. Pesan yang sudah terkirim atau sedang diproses mungkin tetap diterima." confirmLabel="Hentikan siaran" loading={busy} onClose={() => !busy && setCancelId(null)} onConfirm={() => void run(async () => { await post({ action: "cancel", id: cancelId }); setCancelId(null); await load(); })} />
  </section>;
}

function MessagePreview({ content }: { content: BroadcastContent }) {
  return <div className="rounded-md border border-admin-border bg-admin-subtle p-4" role="region" aria-label="Pratinjau pesan"><h3 className="text-sm font-medium text-admin-muted">Pratinjau pesan</h3><p className="mt-3 break-words font-semibold">{content.title || "Judul siaran"}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-admin-muted">{content.body || "Pesan Anda akan tampil di sini."}</p>{content.cta_label && <Badge variant="outline" className="mt-4 max-w-full break-words">{content.cta_label}</Badge>}<p className="mt-4 text-xs text-admin-muted">Email dan Telegram menyertakan cara berhenti menerima siaran. Format mengikuti kanal tujuan.</p></div>;
}
