"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Checkbox, Input, Label, NativeSelect, PageHeader, Skeleton } from "./ui";
import { SupplierBadge } from "./supplier-style";
import { Dialog } from "@/components/ui/Dialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { useToast } from "@/components/ui/Toast";
import { formatRupiah } from "@/lib/utils";
import { suggestVariantSlots } from "@/lib/product-group-slots";
import type { Prod } from "./product-types";

type Member = {
  product_id: number; name: string; slug: string; image: string;
  supplier: Prod["supplier"]; is_active: boolean; archived: boolean; live: boolean;
  stock: number; modal_per_30d: number | null; position: number;
};
type GroupSlot = {
  id: number; name: string; winner_variant_id: number | null;
  reason: string | null; decided_at: string | null; sort_order: number; variant_ids: number[];
};
type GroupVariant = {
  variant_id: number; product_id: number; supplier: NonNullable<Prod["supplier"]>;
  label: string; price: number; stock: number; min_qty: number; modal_per_30d: number | null;
  is_active: boolean; parent_active: boolean; parent_archived: boolean;
  duration_value: number | null; duration_unit: string | null; duration_label: string | null;
  warranty_type: string; warranty_value: number | null; warranty_unit: string | null;
  slot_id: number | null;
};
type ProductGroupMode = "winner" | "merge_variants";
type ProductGroup = {
  id: number; name: string; mode?: ProductGroupMode; prefer_product_id: number | null; prefer_margin: number;
  winner_product_id: number | null; reason: string | null; decided_at: string | null; members: Member[];
  slots?: GroupSlot[]; variants?: GroupVariant[];
};
type DraftSlot = { key: string; name: string; variant_ids: number[] };

const endpoint = "/api/admin/product-groups";

async function request<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: "no-store", ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error === "already_grouped"
    ? `Produk sudah di grup lain${body.group_id ? ` (#${body.group_id})` : ""}. Pilih produk lain.`
    : body.message || body.error || `Permintaan gagal (${res.status}).`);
  return body;
}

function decisionTime(value: string | null) {
  if (!value) return "Belum dihitung";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Waktu belum tersedia" : date.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";
}

function serializeSlots(slots: { name: string; variant_ids: number[] }[]): string {
  return JSON.stringify(slots.map((s) => ({ name: s.name.trim(), variant_ids: [...s.variant_ids].sort((a, b) => a - b) })));
}

function defaultSlotNameFor(label: string, existing: DraftSlot[]): string {
  const base = label.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Slot";
  const lower = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  let i = 2;
  while (lower.has(`${base} #${i}`.toLowerCase())) i++;
  return `${base.slice(0, 72)} #${i}`;
}

export function ProductGroupsManager() {
  const toast = useToast();
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<ProductGroup | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ group: ProductGroup; member?: Member } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await request<{ groups: ProductGroup[] }>(endpoint);
      setGroups(body.groups);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal memuat grup."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mutate = async (url: string, method: string, data?: unknown, message = "Grup diperbarui.") => {
    setBusy(true);
    try {
      const result = await request<{ group?: ProductGroup; deleted?: boolean; decided?: number; changed?: number }>(url, method, data);
      toast.success(url.endsWith("/decide") ? `Pemenang dihitung: ${result.decided ?? 0} grup, ${result.changed ?? 0} berubah.` : result.deleted ? "Anggota dikeluarkan. Grup dihapus karena tersisa kurang dari 2 anggota." : message);
      setConfirm(null);
      if (result.group) setEditor(current => current && current !== "new" && current.id === result.group!.id ? result.group! : current);
      if (result.deleted || method === "DELETE" && !url.includes("/members")) setEditor(null);
      if (url === endpoint && method === "POST") setEditor(null);
      await load();
      return true;
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan grup."); return false; }
    finally { setBusy(false); }
  };

  const saveGroupSettings = async (groupId: number, patch: Record<string, unknown> | null, slotsPayload: { name: string; variant_ids: number[] }[] | null) => {
    setBusy(true);
    try {
      let latest: ProductGroup | undefined;
      if (patch) {
        const res = await request<{ group?: ProductGroup }>(`${endpoint}/${groupId}`, "PATCH", patch);
        if (res.group) latest = res.group;
      }
      if (slotsPayload) {
        const res = await request<{ group?: ProductGroup }>(`${endpoint}/${groupId}/slots`, "PUT", { slots: slotsPayload });
        if (res.group) latest = res.group;
      }
      toast.success("Grup disimpan.");
      if (latest) setEditor(current => current && current !== "new" && current.id === latest!.id ? latest! : current);
      await load();
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan grup.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const filtered = groups.filter(group => `${group.name} ${group.members.map(member => `${member.name} ${member.slug}`).join(" ")}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="min-w-0 space-y-6">
    <PageHeader title="Grup produk" description="Kelompokkan 2–10 produk sejenis lintas supplier dalam satu kartu toko."
      actions={<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || loading} onClick={() => void mutate(`${endpoint}/decide`, "POST")}>Hitung ulang</Button><Button disabled={busy || loading || !!error} onClick={() => setEditor("new")}>Grup baru</Button></div>} />
    <Card className="p-4 text-sm text-admin-muted">
      <p className="font-medium text-admin-fg">Urutan pemilihan otomatis</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5"><li>Produk Manual yang live selalu menang.</li><li>Utamakan produk yang punya stok.</li><li>Pilih modal per 30 hari termurah.</li><li>Ikuti preferensi admin bila selisih modal ≤ margin Rupiah.</li></ol>
      <p className="mt-2">Produk nonaktif atau arsip selalu dikeluarkan. Semua habis? Satu anggota aktif tetap menjadi wakil kartu habis.</p>
    </Card>
    <Input aria-label="Cari grup produk" placeholder="Cari grup, produk, atau slug…" value={query} onChange={event => setQuery(event.target.value)} className="sm:max-w-sm" />
    {error && <div role="alert" className="rounded-xl border border-admin-danger/30 bg-admin-danger/10 p-4 text-sm text-admin-danger">{error}<Button className="ml-2" variant="outline" onClick={() => void load()} disabled={busy || loading}>Coba lagi</Button></div>}
    {loading ? <Skeleton className="h-40 w-full" /> : !groups.length && !error ? <Card className="p-10 text-center text-admin-muted">Belum ada grup</Card> : !filtered.length && !error ? <p className="text-sm text-admin-muted">Tidak ada grup yang cocok.</p> : filtered.map(group => {
      const merged = group.mode === "merge_variants";
      const slots = group.slots ?? [];
      const variantMap = new Map((group.variants ?? []).map((v) => [v.variant_id, v]));
      return <Card key={group.id} className="min-w-0 overflow-hidden" aria-label={`Grup ${group.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-admin-border p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold text-admin-fg">{group.name}</h3>{merged && <Badge variant="outline" className="border-admin-success/40 bg-admin-success/10 text-admin-success">Gabung varian</Badge>}</div><p className="text-xs text-admin-muted">{group.members.length} anggota{merged && slots.length > 0 ? ` · ${slots.length} slot` : ""}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => setEditor(group)} aria-label={`Kelola grup ${group.name}`}>Kelola grup</Button></div>
      <ul className="divide-y divide-admin-border">{group.members.map(member => {
        const isWinner = member.product_id === group.winner_product_id;
        const isMergedActive = merged && !isWinner && member.is_active && !member.archived && group.winner_product_id != null;
        return <li key={member.product_id} className="flex min-w-0 flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><p className="break-words text-sm font-medium text-admin-fg">{member.name}</p><div className="mt-1 flex flex-wrap gap-1.5"><SupplierBadge supplier={member.supplier} /><Badge variant="secondary">{member.archived ? "Arsip" : member.is_active ? "Aktif" : "Nonaktif"}</Badge>{isWinner ? <Badge variant="success">{merged ? "Kartu utama" : "Tampil di toko"}</Badge> : isMergedActive ? <Badge variant="outline" className="border-admin-success/35 bg-admin-success/5 text-admin-success">Varian digabung</Badge> : <Badge variant="secondary">Disembunyikan</Badge>}</div></div>
        <div className="shrink-0 text-xs text-admin-muted"><p>Stok {member.stock === -1 ? "∞" : member.stock}</p><p>Modal/30 hari {member.modal_per_30d == null ? "—" : formatRupiah(member.modal_per_30d)}</p></div>
      </li>;
      })}</ul>
      {merged && slots.length > 0 && (
        <div className="border-t border-admin-border bg-admin-subtle/40 px-4 py-3">
          <ul className="space-y-1.5">
            {slots.map((slot) => {
              const winner = slot.winner_variant_id != null ? variantMap.get(slot.winner_variant_id) : undefined;
              return (
                <li key={slot.id} className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="font-medium text-admin-fg">{slot.name}</span>
                    {winner && <SupplierBadge supplier={winner.supplier} />}
                    <span className="truncate text-admin-muted">{winner ? winner.label : "Belum ada pemenang"} ({slot.variant_ids.length} varian)</span>
                  </div>
                  {slot.reason && <span className="shrink-0 text-admin-muted">{slot.reason}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="border-t border-admin-border p-4 text-xs text-admin-muted"><p className="break-words">{group.reason || "Belum ada keputusan"}</p><p className="mt-1">{decisionTime(group.decided_at)}</p></div>
    </Card>;
    })}
    {editor && <GroupEditor key={editor === "new" ? "new" : editor.id} group={editor === "new" ? null : editor} groups={groups} busy={busy} onClose={() => setEditor(null)}
      onCreate={(data) => mutate(endpoint, "POST", data, "Grup disimpan.")}
      onSaveEdit={(patch, slotsPayload) => editor !== "new" ? saveGroupSettings(editor.id, patch, slotsPayload) : Promise.resolve(false)}
      onAdd={productId => editor !== "new" ? mutate(`${endpoint}/${editor.id}/members`, "POST", { product_id: productId }, "Anggota ditambahkan.") : Promise.resolve(false)}
      onRemove={member => editor !== "new" && setConfirm({ group: editor, member })} onDelete={() => editor !== "new" && setConfirm({ group: editor })} />}
    <ConfirmDialog open={!!confirm} title={confirm?.member ? "Keluarkan anggota?" : "Hapus grup?"} description={confirm?.member ? `Keluarkan ${confirm.member.name}? Jika tersisa kurang dari 2 anggota, grup dihapus otomatis dan anggota akan tampil sendiri-sendiri lagi.` : "Grup dihapus; anggota akan tampil sendiri-sendiri lagi."} confirmLabel={confirm?.member ? "Keluarkan anggota" : "Hapus grup"} loading={busy} onClose={() => setConfirm(null)} onConfirm={() => { if (confirm) void mutate(`${endpoint}/${confirm.group.id}${confirm.member ? `/members?product_id=${confirm.member.product_id}` : ""}`, "DELETE", undefined, confirm.member ? "Anggota dikeluarkan." : "Grup dihapus."); }} />
  </div>;
}

function GroupEditor({ group, groups, busy, onClose, onCreate, onSaveEdit, onAdd, onRemove, onDelete }: {
  group: ProductGroup | null; groups: ProductGroup[]; busy: boolean; onClose: () => void;
  onCreate: (data: unknown) => Promise<boolean>;
  onSaveEdit: (patch: Record<string, unknown> | null, slotsPayload: { name: string; variant_ids: number[] }[] | null) => Promise<boolean>;
  onAdd: (id: number) => Promise<boolean>;
  onRemove: (member: Member) => void; onDelete: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [mode, setMode] = useState<ProductGroupMode>(group?.mode ?? "winner");
  const [prefer, setPrefer] = useState(String(group?.prefer_product_id ?? ""));
  const [margin, setMargin] = useState(group?.prefer_margin ?? 0);
  const [draftSlots, setDraftSlots] = useState<DraftSlot[]>(() =>
    (group?.slots ?? []).map((s) => ({ key: `s-${s.id}`, name: s.name, variant_ids: [...s.variant_ids] })),
  );
  const [autoNotice, setAutoNotice] = useState("");
  useEffect(() => { setName(group?.name ?? ""); }, [group?.name]);
  useEffect(() => { setMode(group?.mode ?? "winner"); }, [group?.mode]);
  useEffect(() => { setPrefer(String(group?.prefer_product_id ?? "")); }, [group?.prefer_product_id]);
  useEffect(() => { setMargin(group?.prefer_margin ?? 0); }, [group?.prefer_margin]);
  useEffect(() => {
    setDraftSlots((group?.slots ?? []).map((s) => ({ key: `s-${s.id}`, name: s.name, variant_ids: [...s.variant_ids] })));
    setAutoNotice("");
  }, [group?.slots]);

  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Prod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadProducts = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = await request<{ products: Prod[] }>("/api/products"); setProducts(data.products); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Gagal memuat produk."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadProducts(); }, [loadProducts]);

  const activeGroupVariants = useMemo(
    () => (group?.variants ?? []).filter((v) => v.is_active && v.parent_active && !v.parent_archived),
    [group?.variants],
  );
  const persistedWinnerIds = useMemo(
    () => new Set((group?.slots ?? []).map((s) => s.winner_variant_id).filter((id): id is number => id != null)),
    [group?.slots],
  );

  const validName = name.trim().length > 0 && name.trim().length <= 120;
  const validMargin = Number.isSafeInteger(margin) && margin >= 0 && margin <= 1_000_000;
  const initialMode: ProductGroupMode = group?.mode ?? "winner";
  const settingsDirty = name !== group?.name || mode !== initialMode || prefer !== String(group?.prefer_product_id ?? "") || margin !== (group?.prefer_margin ?? 0);
  const slotsDirty = group != null && mode === "merge_variants"
    && serializeSlots(draftSlots) !== serializeSlots(group.slots ?? []);
  const underfilledSlot = mode === "merge_variants"
    ? draftSlots.find((s) => s.variant_ids.length < 2)
    : undefined;
  const unnamedSlot = mode === "merge_variants"
    ? draftSlots.find((s) => s.name.trim().length === 0 || s.name.trim().length > 80)
    : undefined;
  const duplicateSlotName = mode === "merge_variants" && (() => {
    const seen = new Set<string>();
    for (const s of draftSlots) {
      const k = s.name.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) return s.name.trim();
      seen.add(k);
    }
    return null;
  })();
  const slotsValid = !underfilledSlot && !unnamedSlot && !duplicateSlotName;
  const dirty = settingsDirty || slotsDirty;

  const slotKeyOfVariant = (variantId: number): string =>
    draftSlots.find((s) => s.variant_ids.includes(variantId))?.key ?? "";

  const assignVariantToSlot = (variant: GroupVariant, targetKey: string) => {
    setAutoNotice("");
    setDraftSlots((current) => {
      const stripped = current.map((s) => ({
        ...s,
        variant_ids: s.variant_ids.filter((id) => id !== variant.variant_id),
      })).filter((s) => s.variant_ids.length > 0);
      if (!targetKey) return stripped;
      if (targetKey === "__new__") {
        const nextName = defaultSlotNameFor(variant.label, stripped);
        return [...stripped, { key: `new-${Date.now()}-${variant.variant_id}`, name: nextName, variant_ids: [variant.variant_id] }];
      }
      return stripped.map((s) => s.key === targetKey ? { ...s, variant_ids: [...s.variant_ids, variant.variant_id] } : s);
    });
  };

  const removeSlot = (key: string) => {
    setAutoNotice("");
    setDraftSlots((current) => current.filter((s) => s.key !== key));
  };

  const renameSlot = (key: string, nextName: string) => {
    setDraftSlots((current) => current.map((s) => s.key === key ? { ...s, name: nextName } : s));
  };

  const runAutoSuggest = () => {
    const suggested = suggestVariantSlots(activeGroupVariants);
    if (!suggested.length) {
      setAutoNotice("Tidak ada varian kembar lintas supplier yang terdeteksi.");
      return;
    }
    setAutoNotice("");
    setDraftSlots(suggested.map((s, idx) => ({
      key: `auto-${idx}-${Date.now()}`,
      name: s.name,
      variant_ids: s.variant_ids,
    })));
  };

  const handleSaveEdit = () => {
    if (!group) return;
    const patch = settingsDirty
      ? {
          name: name.trim(),
          prefer_product_id: prefer ? Number(prefer) : null,
          prefer_margin: margin,
          ...(mode !== initialMode ? { mode } : {}),
        }
      : null;
    const slotsPayload = slotsDirty
      ? draftSlots.map((s) => ({ name: s.name.trim(), variant_ids: s.variant_ids }))
      : null;
    void onSaveEdit(patch, slotsPayload);
  };

  const candidates = products.filter(product => !product.archivedAt && !group?.members.some(member => member.product_id === Number(product.id)) && `${product.name} ${product.slug}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <Dialog title={group ? "Kelola grup produk" : "Grup produk baru"} onClose={onClose} busy={busy} className="w-[640px]">
    <h3 className="text-lg font-semibold text-admin-fg">{group ? "Kelola grup produk" : "Grup produk baru"}</h3>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <Label className="block space-y-1.5">Nama grup<Input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></Label>
      <Label className="block space-y-1.5">Mode tampilan<NativeSelect value={mode} onChange={event => setMode(event.target.value === "merge_variants" ? "merge_variants" : "winner")}><option value="winner">Pilih 1 termurah (otomatis)</option><option value="merge_variants">Gabung semua varian di 1 kartu</option></NativeSelect></Label>
      {group && <>
        <ul className="divide-y divide-admin-border">{group.members.map(member => <li key={member.product_id} className="flex items-center justify-between gap-2 py-2"><div className="min-w-0"><p className="break-words text-sm text-admin-fg">{member.name}</p><SupplierBadge supplier={member.supplier} /></div><Button className="shrink-0" size="sm" variant="outline" onClick={() => onRemove(member)} aria-label={`Keluarkan ${member.name}`}>Keluarkan</Button></li>)}</ul>
        {mode === "merge_variants" && (
          <div className="space-y-3 border-t border-admin-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-admin-fg">Slot varian</p>
              <Button type="button" size="sm" variant="outline" disabled={activeGroupVariants.length < 2} onClick={runAutoSuggest}>Samakan otomatis</Button>
            </div>
            {autoNotice && <p className="text-xs text-admin-muted">{autoNotice}</p>}
            {draftSlots.length > 0 && (
              <div className="space-y-1.5">
                {draftSlots.map((slot) => (
                  <div key={slot.key} className="flex items-center gap-2">
                    <Input
                      aria-label={`Nama slot ${slot.name || "baru"}`}
                      value={slot.name}
                      maxLength={80}
                      onChange={(e) => renameSlot(slot.key, e.target.value)}
                      className="h-8 text-xs"
                    />
                    <span className="shrink-0 text-xs tabular-nums text-admin-muted">{slot.variant_ids.length} varian</span>
                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 px-2.5 text-xs" onClick={() => removeSlot(slot.key)} aria-label={`Hapus slot ${slot.name}`}>Hapus</Button>
                  </div>
                ))}
              </div>
            )}
            {activeGroupVariants.length === 0 ? (
              <p className="text-xs text-admin-muted">Belum ada varian aktif dari anggota grup.</p>
            ) : (
              <ul className="max-h-60 divide-y divide-admin-border overflow-y-auto rounded-md border border-admin-border">
                {activeGroupVariants.map((variant) => {
                  const assignedKey = slotKeyOfVariant(variant.variant_id);
                  const isSlotWinner = assignedKey !== "" && !slotsDirty && persistedWinnerIds.has(variant.variant_id);
                  return (
                    <li key={variant.variant_id} className="flex min-w-0 flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="break-words text-sm font-medium text-admin-fg">{variant.label}</span>
                          {isSlotWinner && <Badge variant="success">Menang</Badge>}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs tabular-nums text-admin-muted">
                          <SupplierBadge supplier={variant.supplier} />
                          <span>{formatRupiah(variant.price)}</span>
                          <span>· Stok {variant.stock === -1 ? "∞" : variant.stock}</span>
                        </div>
                      </div>
                      <NativeSelect
                        aria-label={`Slot untuk ${variant.label} (${variant.supplier})`}
                        value={assignedKey}
                        onChange={(e) => assignVariantToSlot(variant, e.target.value)}
                        className="h-8 text-xs sm:w-48 sm:shrink-0"
                      >
                        <option value="">Tampil terpisah</option>
                        {draftSlots.map((slot) => (
                          <option key={slot.key} value={slot.key}>Slot: {slot.name || "(tanpa nama)"}</option>
                        ))}
                        <option value="__new__">+ Buat slot baru…</option>
                      </NativeSelect>
                    </li>
                  );
                })}
              </ul>
            )}
            {underfilledSlot && <p role="alert" className="text-xs text-admin-danger">Slot &ldquo;{underfilledSlot.name || "baru"}&rdquo; butuh minimal 2 varian.</p>}
            {unnamedSlot && <p role="alert" className="text-xs text-admin-danger">Nama slot wajib 1–80 karakter.</p>}
            {duplicateSlotName && <p role="alert" className="text-xs text-admin-danger">Nama slot &ldquo;{duplicateSlotName}&rdquo; duplikat.</p>}
          </div>
        )}
        <Label className="block space-y-1.5">Preferensi anggota<NativeSelect value={prefer} onChange={event => setPrefer(event.target.value)}><option value="">Otomatis (tanpa preferensi)</option>{group.members.map(member => <option key={member.product_id} value={member.product_id}>{member.name} · {member.supplier}</option>)}</NativeSelect></Label>
        <Label className="block space-y-1.5">Margin preferensi (Rupiah)<MoneyInput value={margin} onChange={value => setMargin(value ?? 0)} className="w-full rounded-md border border-admin-input bg-admin-card px-3 py-2 text-sm text-admin-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-ring" /></Label>
        {!validMargin && <p role="alert" className="text-xs text-admin-danger">Margin harus bilangan bulat Rp0–1.000.000.</p>}
        <Button variant="outline" disabled={!validName || !validMargin || !slotsValid || !dirty} onClick={handleSaveEdit}>Simpan pengaturan</Button>
      </>}
      <div className="space-y-2 border-t border-admin-border pt-4">
        <p className="text-sm font-medium text-admin-fg">{group ? "Tambah anggota" : `Pilih anggota (${selected.length}/10) — minimal 2`}</p>
        <Input aria-label="Cari produk anggota" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau slug produk…" />
        {error && <div role="alert" className="text-sm text-admin-danger">{error}<Button variant="outline" size="sm" onClick={() => void loadProducts()}>Muat ulang produk</Button></div>}
        {loading ? <Skeleton className="h-20 w-full" /> : <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-admin-border p-2">
          {candidates.map(product => {
            const id = Number(product.id);
            const owner = groups.find(item => item.members.some(member => member.product_id === id));
            const disabled = !!owner || (group ? group.members.length >= 10 : selected.length >= 10 && !selected.includes(id));
            return <li key={id} className="flex min-w-0 items-center gap-3 rounded-md p-2">
              {!group && <Checkbox aria-label={`Pilih ${product.name}`} checked={selected.includes(id)} disabled={disabled} onCheckedChange={checked => setSelected(current => checked === true ? [...current, id] : current.filter(value => value !== id))} />}
              <div className="min-w-0 flex-1"><p className="break-words text-sm text-admin-fg">{product.name}</p><p className="break-all text-xs text-admin-muted">/{product.slug}</p><div className="mt-1 flex flex-wrap items-center gap-1.5"><SupplierBadge supplier={product.supplier} /><span className="text-xs text-admin-muted">Stok {product.stock === -1 ? "∞" : product.stock}{!product.isActive && " · Nonaktif"}</span></div>{owner && <p className="break-words text-xs text-admin-muted">Sudah di grup {owner.name}</p>}</div>
              {group && <Button variant="outline" size="sm" disabled={disabled} onClick={() => void onAdd(id)} aria-label={`Tambahkan ${product.name}`}>Tambah</Button>}
            </li>;
          })}
          {!candidates.length && <li className="p-2 text-sm text-admin-muted">Tidak ada produk yang cocok.</li>}
        </ul>}
        {group && group.members.length >= 10 && <p className="text-xs text-admin-warning">Maksimal 10 anggota. Keluarkan satu anggota sebelum menambah.</p>}
      </div>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2 border-t border-admin-border pt-4">
      {group && <Button variant="outline" className="mr-auto text-admin-danger" disabled={busy} onClick={onDelete}>Hapus grup</Button>}
      <Button variant="outline" disabled={busy} onClick={onClose}>Tutup</Button>
      {!group && <Button disabled={busy || loading || !validName || selected.length < 2 || selected.length > 10} onClick={() => void onCreate({ name: name.trim(), product_ids: selected, ...(mode !== "winner" ? { mode } : {}) })}>{busy ? "Menyimpan…" : "Buat grup"}</Button>}
    </div>
  </Dialog>;
}
