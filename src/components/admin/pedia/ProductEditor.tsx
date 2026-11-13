"use client";

import { useEffect, useState, type FormEvent } from "react";
import { formatRupiah } from "@/lib/utils";
import { pediaBounds } from "@/lib/pedia/bounds";
import { pediaMargin } from "@/lib/pedia/pricing";
import type { PediaCatalogProduct } from "@/app/api/pedia/catalog/route";
import { ProductCard, catalogCard } from "@/components/pedia/PlatformGrid";
import { OrderClient } from "@/app/pedia/o/[slug]/order-client";
import { AdminStatusSwitch } from "../AdminStatusSwitch";
import { BUTTON, PRIMARY, INPUT, Field, DataTable, HealthLine, parse, packagesOf, usablePackages, TIER_ORDER, type Product, type Tier, type Row, productStatus } from "./shared";

export function ProductEditor({ product: p, tiers, busy, onSave, onCreateTier, onError, onBrowse }: {
  product: Product; tiers: Tier[]; busy: boolean;
  onSave: (body: Row, message: string) => Promise<Row | null>; onCreateTier: (body: Row) => Promise<Row | null>;
  onError: (message: string) => void; onBrowse: () => void;
}) {
  const [checklist, setChecklist] = useState<Row[]>(() => parse<Row[]>(p.checklist_json, []));
  const [editing, setEditing] = useState<number | null>(null);
  useEffect(() => { setChecklist(parse<Row[]>(p.checklist_json, [])); }, [p.checklist_json]);
  function saveProduct(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const packages = String(f.get("packages")).split(/[,\s]+/).filter(Boolean).map(Number), step = Number(f.get("step"));
    const checks = checklist.map((item, i) => ({ ...item, id: item.id, label: String(f.get(`check_label_${i}`) ?? ""), help: String(f.get(`check_help_${i}`) ?? "") }));
    if (!Number.isSafeInteger(step) || step < 1 || !packages.length || packages.some(q => !Number.isSafeInteger(q) || q < 1 || q % step !== 0)) return onError("Isi paket dengan bilangan positif yang merupakan kelipatan jumlah.");
    if (checks.some(c => !c.label.trim() || typeof c.id !== "string")) return onError("Setiap poin checklist harus memiliki teks dan ID yang valid.");
    const body: Row = { id: p.id, packages_json: JSON.stringify([...new Set(packages)]), checklist_json: JSON.stringify(checks), is_active: f.has("is_active") ? 1 : 0, is_featured: f.has("is_featured") ? 1 : 0 };
    for (const key of ["name", "slug", "platform", "metric", "target_kind", "tagline", "description_md"]) body[key] = String(f.get(key) ?? "");
    body.step = step; body.sort_order = Number(f.get("sort_order")); void onSave(body, "Produk tersimpan.");
  }
  const text = (key: keyof Product, label: string, max: number, required = false) => <Field label={label}><input name={key} defaultValue={String(p[key] ?? "")} maxLength={max} required={required} className={INPUT} /></Field>;
  const previewTiers = tiers.map(t => {
    const prices = parse<Record<string, number>>(t.package_prices_json, {}), bounds = pediaBounds({ min_qty: t.live_min, max_qty: t.live_max }, t, p.step);
    return { id: t.id, tier: t.tier, public_name: t.public_name, label_note: t.label_note, description: t.description_md, terms: t.terms_md, instructions: t.instructions_md, recommendation_note: t.recommendation_note, region: t.region, quality: t.quality, speed_note: t.speed_note, drop_risk: t.drop_risk, refill_days: t.refill_days, eta_start: t.eta_start, eta_finish: t.eta_finish, recommended: !!t.is_recommended, min_qty: bounds?.min, max_qty: bounds?.max, quantity_step: bounds?.step, prices: Object.fromEntries(usablePackages(p, t).map(qty => [qty, Number(prices[qty])])) };
  }).filter(t => Object.keys(t.prices).length > 0);
  const previewProduct: PediaCatalogProduct = { slug: p.slug, platform: p.platform, metric: p.metric, target_kind: p.target_kind, name: p.name, tagline: p.tagline, description_md: p.description_md, step: p.step, is_featured: p.is_featured, checklist: parse(p.checklist_json, []), tiers: previewTiers, packages: packagesOf(p).filter(qty => previewTiers.some(t => t.prices[qty] > 0)), min_price: previewTiers.length ? Math.min(...previewTiers.flatMap(t => Object.values(t.prices))) : null, image: null };
  return <div className="space-y-5">
    <form key={JSON.stringify(p)} onSubmit={saveProduct} aria-label="Edit produk" className="space-y-4 rounded-2xl border border-white/10 p-4 sm:p-5">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold text-white">Informasi produk</legend>
        {text("name", "Nama produk", 120, true)}{text("slug", "Slug", 80, true)}
        {text("platform", "Platform produk", 30, true)}{text("metric", "Jenis layanan (metric)", 30, true)}{text("target_kind", "Jenis target", 30, true)}{text("tagline", "Tagline produk publik", 200)}
        <Field label="Paket jumlah (pisahkan dengan koma)"><input name="packages" required defaultValue={packagesOf(p).join(", ")} className={INPUT} /></Field>
        <Field label="Kelipatan jumlah"><input name="step" type="number" required min={1} max={100000} defaultValue={p.step} className={INPUT} /></Field>
        <Field label="Urutan produk"><input name="sort_order" type="number" required min={0} max={100000} defaultValue={p.sort_order} className={INPUT} /></Field>
        <div className="flex flex-wrap items-center gap-4 text-sm text-white/80"><label className="flex min-h-11 items-center gap-2"><input name="is_active" type="checkbox" disabled={!p.id} defaultChecked={!!p.is_active} />Terbit</label><label className="flex min-h-11 items-center gap-2"><input name="is_featured" type="checkbox" disabled={!p.id} defaultChecked={!!p.is_featured} />Produk unggulan</label></div>
        <div className="sm:col-span-2"><Field label="Deskripsi produk publik"><textarea name="description_md" defaultValue={p.description_md ?? ""} maxLength={5000} rows={4} className={INPUT} /></Field></div>
        <div className="space-y-3 sm:col-span-2"><h4 className="text-sm font-semibold text-white">Checklist sebelum bayar</h4>{checklist.map((item, i) => <div key={String(item.id)} className="grid items-end gap-3 border-t border-white/10 pt-3 sm:grid-cols-[1fr_1fr_auto]"><Field label={`Poin checklist ${i + 1}`}><input name={`check_label_${i}`} required maxLength={500} defaultValue={String(item.label ?? "")} className={INPUT} /></Field><Field label={`Bantuan checklist ${i + 1}`}><textarea name={`check_help_${i}`} maxLength={2000} rows={2} defaultValue={String(item.help ?? "")} className={INPUT} /></Field><button type="button" className={BUTTON} onClick={() => setChecklist(checklist.filter((_, index) => index !== i))} aria-label={`Hapus poin checklist ${i + 1}`}>Hapus</button></div>)}<button type="button" className={BUTTON} onClick={() => setChecklist([...checklist, { id: `check_${Date.now()}`, label: "" }])}>Tambah poin checklist</button></div>
      </fieldset>
      <button className={PRIMARY} disabled={busy}>{busy ? "Menyimpan..." : "Simpan produk"}</button>
    </form>
    <section aria-label="Varian" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold text-white">Varian</h4><button type="button" disabled={busy} className={BUTTON} onClick={onBrowse}>Cari layanan IndoSMM</button></div>
      {!tiers.length && <p className="text-sm text-white/65">Belum ada varian. Buat varian setelah produk tersimpan.</p>}
      {!!p.id && tiers.length < 3 && <details className="rounded-xl border border-white/10 p-4"><summary className="min-h-11 cursor-pointer py-3 text-sm text-white">Buat varian</summary><form aria-label="Buat varian" className="space-y-3" onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void onCreateTier({ kind: "tier", product_id: p.id, tier: String(f.get("tier")), supplier: "indosmm", supplier_service_id: Number(f.get("supplier_service_id")), price_group: String(f.get("price_group")), markup_pct: Number(f.get("markup_pct")), min_profit_rp: Number(f.get("min_profit_rp")), refill_days: Number(f.get("refill_days")), is_active: 0 });
      }}><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2"><Field label="Varian baru"><select name="tier" className={INPUT}>{TIER_ORDER.filter(name => !tiers.some(t => t.tier === name)).map(name => <option key={name}>{name}</option>)}</select></Field><Field label="ID layanan varian baru"><input name="supplier_service_id" type="number" required min={1} className={INPUT} /></Field><Field label="Kelompok harga baru"><select name="price_group" className={INPUT}>{["G1", "G2", "G3"].map(group => <option key={group}>{group}</option>)}</select></Field><Field label="Markup baru (%)"><input name="markup_pct" type="number" required min={0} max={1000} step="any" defaultValue={20} className={INPUT} /></Field><Field label="Minimum untung baru (Rp)"><input name="min_profit_rp" type="number" required min={0} max={10000000} defaultValue={1000} className={INPUT} /></Field><Field label="Masa refill baru (hari)"><input name="refill_days" type="number" required min={0} max={365} defaultValue={0} className={INPUT} /></Field></fieldset><p className="text-xs text-white/65">Varian dibuat nonaktif. Periksa harga dan ketentuan sebelum aktivasi.</p><button className={PRIMARY} disabled={busy}>Buat varian nonaktif</button></form></details>}
      {tiers.map(t => {
        const prices = usablePackages(p, t).map(qty => Number(parse<Record<string, number>>(t.package_prices_json, {})[qty]));
        return <article key={t.id} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 flex-1"><h5 className="break-words text-sm font-semibold text-white">{t.public_name || t.label_note || t.tier}</h5><p className="mt-1 text-xs text-white/55">IndoSMM #{t.supplier_service_id} · {prices.length ? `dari ${formatRupiah(Math.min(...prices))}` : "Belum ada harga"} · {t.refill_days ? `Refill ${t.refill_days} hari` : "No Refill"}</p></div><div className="flex items-center gap-3"><AdminStatusSwitch checked={!!t.is_active} label={`${t.is_active ? "Nonaktifkan" : "Aktifkan"} varian ${t.tier}`} disabled={busy} onChange={() => void onSave({ kind: "tier", id: t.id, is_active: t.is_active ? 0 : 1 }, "Status varian tersimpan.")} /><button className={BUTTON} aria-expanded={editing === t.id} aria-controls={`variant-${t.id}`} onClick={() => setEditing(editing === t.id ? null : t.id)}>Edit varian {t.tier}</button></div></div>
          {editing === t.id && <div id={`variant-${t.id}`} className="mt-4 space-y-3 border-t border-white/10 pt-4"><HealthLine row={t} /><p className="text-xs text-white/60">{t.live_name ?? "Layanan belum tersedia"} · Batas {t.live_min ?? "-"}–{t.live_max ?? "-"}</p><p className="text-xs text-white/60">Jalur refill: {t.refill_days <= 0 ? "No Refill" : t.live_api_refill === 1 ? "API IndoSMM" : "manual — pembeli mengajukan, admin meneruskan ke CS IndoSMM"}.</p>{t.auto_disabled_reason && <p className="text-xs text-amber-300">Periksa layanan, batas jumlah, dan harga sebelum aktivasi.</p>}
            <VariantForm key={JSON.stringify(t)} product={p} tier={t} busy={busy} onSave={onSave} />
          </div>}
        </article>;
      })}
    </section>
    {!!p.id && <section aria-label="Pratinjau produk" className="space-y-2 border-t border-white/10 pt-4 text-sm text-white/80"><details><summary className="min-h-11 cursor-pointer py-3 font-semibold text-white">Pratinjau tersimpan</summary><p>{p.name} / {p.is_active ? "Terbit" : "Draf"} / {p.is_featured ? "Pilihan AXVARA" : "Katalog penuh"} / {productStatus(p, tiers).label}</p><p className="my-2 text-xs text-white/65">Preview hanya memakai data tersimpan, bukan input yang belum disimpan. Draf tetap privat; navigasi dan pemesanan dinonaktifkan.</p><div className="max-w-sm" onClickCapture={e => e.preventDefault()}><ProductCard p={catalogCard(previewProduct)} /></div>{!previewTiers.length && <p className="text-xs text-amber-300">Belum ada paket layak untuk ditampilkan. Periksa layanan, batas jumlah, harga, dan margin.</p>}<details><summary className="min-h-11 cursor-pointer py-3 font-semibold text-white">Pratinjau detail &amp; pesanan tersimpan</summary><OrderClient key={JSON.stringify(previewProduct)} product={previewProduct} initialTarget="" ordersEnabled={false} embedded /></details></details></section>}
  </div>;
}

function VariantForm({ product: p, tier: t, busy, onSave }: { product: Product; tier: Tier; busy: boolean; onSave: (body: Row, message: string) => Promise<Row | null> }) {
  const input = (key: keyof Tier, label: string, max: number) => <Field label={label}><input name={key} maxLength={max} defaultValue={String(t[key] ?? "")} className={INPUT} /></Field>;
  const area = (key: keyof Tier, label: string, max = 3000) => <Field label={label}><textarea name={key} maxLength={max} defaultValue={String(t[key] ?? "")} className={INPUT} rows={3} /></Field>;
  const number = (key: keyof Tier, label: string, min: number, max?: number, required = false) => <Field label={label}><input name={key} type="number" min={min} max={max} required={required} step={key === "markup_pct" ? "any" : 1} defaultValue={t[key] == null ? key === "quantity_step" ? 1 : "" : Number(t[key])} className={INPUT} /></Field>;
  const select = (key: keyof Tier, label: string, fallback: string, options: [string, string][]) => <Field label={label}><select name={key} defaultValue={String(t[key] ?? fallback)} className={INPUT}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></Field>;
  return <form aria-label={`Edit varian ${t.tier}`} className="space-y-4" onSubmit={e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const body: Row = { kind: "tier", id: t.id, is_active: f.has("is_active") ? 1 : 0, supplier: "indosmm" };
    for (const k of ["label_note", "price_group", "eta_start", "eta_finish", "public_name", "description_md", "terms_md", "instructions_md", "recommendation_note", "speed_per_day", "drop_label", "region", "quality", "input_kind"]) body[k] = String(f.get(k) ?? "");
    for (const k of ["supplier_service_id", "refill_days"]) body[k] = Number(f.get(k));
    for (const k of ["min_qty_override", "max_qty_override"]) body[k] = f.get(k) ? Number(f.get(k)) : null;
    body.target_format = String(f.get("target_format")); body.refill_anchor = String(f.get("refill_anchor")); body.backup_service_id = f.get("backup_service_id") ? Number(f.get("backup_service_id")) : null;
    body.markup_pct = Number(f.get("markup_pct")); body.min_profit_rp = Number(f.get("min_profit_rp")); body.quantity_step = Number(f.get("quantity_step")) || 1;
    void onSave(body, `Varian ${t.tier} tersimpan. Periksa status dan harga hasil pembaruan.`);
  }}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {input("public_name", "Nama layanan publik", 200)}{number("supplier_service_id", "ID layanan IndoSMM", 1, undefined, true)}
      {select("price_group", "Kelompok harga", "G3", ["G1", "G2", "G3"].map(g => [g, g]))}{number("markup_pct", "Markup (%)", 0, 1000, true)}{number("min_profit_rp", "Minimum untung (Rp)", 0, 10000000, true)}{number("refill_days", "Masa refill (hari)", 0, 365, true)}
      <label className="flex min-h-11 items-center gap-2 text-sm text-white sm:col-span-2 lg:col-span-3"><input name="is_active" type="checkbox" defaultChecked={!!t.is_active} />Tampilkan di toko (layanan aktif)</label>
      <details className="rounded-xl border border-white/10 p-3 sm:col-span-2 lg:col-span-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-white">Pengaturan lanjutan</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {area("description_md", "Deskripsi layanan")}{area("terms_md", "Syarat & ketentuan layanan")}{area("instructions_md", "Cara membeli")}
        {input("recommendation_note", "Alasan rekomendasi", 200)}{input("label_note", "Catatan kualitas", 120)}
        {number("min_qty_override", "Minimum dari ketentuan layanan", 1, 100000000)}{number("max_qty_override", "Maksimum dari ketentuan layanan", 1, 100000000)}
        {input("eta_start", "Estimasi mulai", 40)}{input("eta_finish", "Estimasi selesai", 40)}{input("speed_per_day", "Speed (mis. 10K/hari)", 40)}
        {select("drop_label", "Label drop (supplier)", "unknown", [["unknown", "Belum diketahui"], ["no_drop", "No Drop"], ["less_drop", "Less Drop"], ["high_drop", "High Drop"]])}
        {select("input_kind", "Input pembeli", "", [["", "Link saja"], ["comments", "Link + komentar custom (1 per baris)"]])}
        {select("region", "Wilayah", "global", [["global", "Global"], ["indonesia", "Indonesia"], ["mixed", "Campuran"]])}
        {select("quality", "Kualitas", "standar", [["standar", "Standar"], ["ekonomis", "Ekonomis"], ["hq", "HQ"], ["real", "Real"]])}
        {number("backup_service_id", "ID layanan cadangan", 1)}{number("quantity_step", "Kelipatan layanan", 1, 100000)}
        {select("target_format", "Format target untuk supplier", "url", [["url", "Link lengkap"], ["username", "Username dari link profil"]])}
        {select("refill_anchor", "Awal masa refill", "created", [["created", "Pesanan dibuat"], ["completed", "Pesanan selesai"]])}
      </div></details>
    </fieldset>
    <details><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-white/70">Harga dan margin tersimpan</summary><DataTable title={`Harga varian ${t.tier}`} columns={["Jumlah", "Modal", "Harga", "Margin", "Status paket"]}>{packagesOf(p).map(qty => {
      const price = Number(parse<Record<string, number>>(t.package_prices_json, {})[qty]), margin = t.live_rate == null || !Number.isFinite(price) ? null : pediaMargin({ supplierRatePer1k: Number(t.live_rate), quantity: qty, sellPrice: price });
      return <tr key={qty}><td>{qty}</td><td>{t.live_rate == null ? "-" : formatRupiah(Number(t.live_rate) * qty / 1000)}</td><td>{price > 0 ? formatRupiah(price) : "Belum dihitung"}</td><td>{margin == null ? "-" : formatRupiah(Math.round(margin))}</td><td>{usablePackages(p, t).includes(qty) ? "Dalam batas" : "Tidak tersedia"}</td></tr>;
    })}</DataTable></details>
    <button disabled={busy} className={PRIMARY}>Simpan varian {t.tier}</button>
  </form>;
}
