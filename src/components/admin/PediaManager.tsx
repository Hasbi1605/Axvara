// src/components/admin/PediaManager.tsx — Tab admin Pedia (PEDIA-PRD §10).
//
// Grup sidebar Katalog, menu Pedia, deep-link `?section=pedia&tab=…`.
// Sub-tab: Produk · Layanan Supplier · Pesanan · Kredit · Pengaturan.
// Gaya Admin UI existing (bukan glass berat). Semua aksi tulis memakai
// ConfirmDialog di page (disediakan via props onConfirm).

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { pediaMargin } from "@/lib/pedia/pricing";
import { formatRupiah } from "@/lib/telegram/messages/format";

type SubTab = "products" | "services" | "orders" | "credits" | "settings";

type Tier = {
  id: number; product_id: number; tier: string; label_note: string | null;
  supplier_service_id: number; backup_service_id: number | null;
  price_group: string; markup_pct: number; min_profit_rp: number;
  refill_days: number; eta_start: string | null; eta_finish: string | null;
  package_prices_json: string; rate_snapshot: number | null;
  is_active: number; auto_disabled_reason: string | null;
  live_rate?: number | null; live_min?: number | null; live_max?: number | null;
  live_present?: number | null;
};

type Product = {
  id: number; slug: string; platform: string; metric: string; target_kind: string;
  name: string; tagline: string | null; packages_json: string;
  step: number; sort_order: number; is_active: number; is_featured: number;
};

const SUB_TABS: [SubTab, string][] = [
  ["products", "Produk"],
  ["services", "Layanan Supplier"],
  ["orders", "Pesanan"],
  ["credits", "Kredit"],
  ["settings", "Pengaturan"],
];

function parsePackages(raw: unknown): number[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  } catch { return []; }
}

function parsePrices(raw: unknown): Record<string, number> {
  try {
    const v = JSON.parse(String(raw ?? "{}"));
    return v && typeof v === "object" ? v as Record<string, number> : {};
  } catch { return {}; }
}

export function PediaManager({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<SubTab>(
    initialTab === "services" || initialTab === "orders" || initialTab === "credits" || initialTab === "settings"
      ? initialTab : "products",
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pedia/products", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal memuat Pedia");
      setProducts(data.products ?? []);
      setTiers(data.tiers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tiersByProduct = useMemo(() => {
    const m = new Map<number, Tier[]>();
    for (const t of tiers) {
      const list = m.get(t.product_id) ?? [];
      list.push(t);
      m.set(t.product_id, list);
    }
    return m;
  }, [tiers]);

  const seed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/pedia/products", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "seed" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Seed gagal");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed gagal");
    } finally {
      setSeeding(false);
    }
  };

  const toggleProduct = async (p: Product) => {
    await fetch("/api/admin/pedia/products", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: p.id, is_active: p.is_active ? 0 : 1 }),
    }).catch(() => null);
    await load();
  };

  const toggleTier = async (t: Tier) => {
    await fetch("/api/admin/pedia/products", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "tier", id: t.id, is_active: t.is_active ? 0 : 1 }),
    }).catch(() => null);
    await load();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Sub-tab Pedia">
        {SUB_TABS.map(([id, label]) => (
          <button
            key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`h-9 rounded-full px-4 text-sm font-semibold transition ${tab === id ? "bg-[#00E5FF] text-[#070a1e]" : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white"}`}
          >{label}</button>
        ))}
      </div>

      {tab === "products" && (
        <div className="mt-4 space-y-4">
          {error && <p className="text-sm text-red-300">{error} <button onClick={load} className="underline">Coba lagi</button></p>}
          {loading && <p className="text-sm text-white/50">Memuat produk kurasi…</p>}
          {!loading && products.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/70">
              <p className="font-semibold text-white">Belum ada produk kurasi.</p>
              <p className="mt-1">Muat 14 produk + 24 tingkat dari kurasi awal PRD §7.3 (semua nonaktif).</p>
              <button onClick={seed} disabled={seeding} className="mt-3 h-10 rounded-xl bg-[#00E5FF] px-4 font-bold text-[#070a1e] disabled:opacity-50">
                {seeding ? "Memuat…" : "Muat kurasi awal (§7.3)"}
              </button>
            </div>
          )}
          {products.map((p) => {
            const pt = tiersByProduct.get(p.id) ?? [];
            const packages = parsePackages(p.packages_json);
            return (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{p.name} <span className="text-xs font-normal text-white/40">/{p.slug}</span></p>
                    <p className="text-xs text-white/50">{p.platform} · {p.metric} · paket [{packages.join(", ")}]</p>
                  </div>
                  <button onClick={() => toggleProduct(p)} className={`h-8 shrink-0 rounded-full px-3 text-xs font-bold ${p.is_active ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/50"}`}>
                    {p.is_active ? "Aktif" : "Nonaktif"}
                  </button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {pt.map((t) => {
                    const prices = parsePrices(t.package_prices_json);
                    return (
                      <div key={t.id} className="rounded-xl border border-white/10 p-3 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold capitalize text-white">{t.tier}</span>
                          <button onClick={() => toggleTier(t)} className={`rounded-full px-2 py-0.5 font-bold ${t.is_active ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-white/50"}`}>
                            {t.is_active ? "Aktif" : "Mati"}
                          </button>
                        </div>
                        <p className="mt-1 text-white/60">#{t.supplier_service_id} · {t.price_group} · Garansi {t.refill_days} hari</p>
                        {t.auto_disabled_reason && (
                          <p className="mt-1 font-semibold text-red-300">Nonaktif otomatis: {t.auto_disabled_reason === "margin" ? "margin" : "layanan hilang"}</p>
                        )}
                        <div className="mt-2 space-y-0.5">
                          {packages.map((qty) => {
                            const price = Number(prices[String(qty)] ?? 0);
                            const margin = t.live_rate ? pediaMargin({ supplierRatePer1k: Number(t.live_rate), quantity: qty, sellPrice: price }) : null;
                            const below = margin !== null && margin < Number(t.min_profit_rp);
                            return (
                              <p key={qty} className={below ? "font-semibold text-red-300" : "text-white/70"}>
                                {qty}: {price ? formatRupiah(price) : "—"}
                                {margin !== null && <span> · margin {formatRupiah(Math.round(margin))}</span>}
                              </p>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "services" && <PediaServicesPanel />}
      {tab === "orders" && <PediaOrdersPanel />}
      {tab === "credits" && <PediaCreditsPanel />}
      {tab === "settings" && <PediaSettingsPanel />}
    </div>
  );
}

function PediaServicesPanel() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [diff, setDiff] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/pedia/services?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { setRows(data.rows ?? []); setTotal(data.total ?? 0); setDiff(data.diff ?? {}); }
    } catch { /* best-effort */ } finally { setLoading(false); }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const resync = async () => {
    setResyncing(true);
    try {
      await fetch("/api/admin/pedia/services", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resync" }),
      });
      await load();
    } finally { setResyncing(false); }
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / ID layanan…" className="h-10 min-w-52 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white" />
        <button onClick={resync} disabled={resyncing} className="h-10 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#070a1e] disabled:opacity-50">
          {resyncing ? "Menarik…" : "Tarik ulang semua"}
        </button>
      </div>
      <p className="mt-2 text-xs text-white/40">
        {total} layanan · diff terakhir: {diff.pedia_diff_last_at ?? "—"} · perubahan: {diff.pedia_diff_last_change_at ?? "—"}
      </p>
      {loading ? <p className="mt-3 text-sm text-white/50">Memuat…</p> : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead><tr className="text-white/40">
              <th className="px-3 py-2">ID</th><th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Rate/1K</th><th className="px-3 py-2">Min–Max</th><th className="px-3 py-2">Dipakai di</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.service_id)} className="border-t border-white/5 text-white/70">
                  <td className="px-3 py-2 font-mono">{String(r.service_id)}</td>
                  <td className="px-3 py-2">{String(r.name ?? "").slice(0, 80)}</td>
                  <td className="px-3 py-2 font-mono">{Number(r.rate_idr_per_1k).toLocaleString("id-ID")}</td>
                  <td className="px-3 py-2 font-mono">{String(r.min_qty)}–{String(r.max_qty)}</td>
                  <td className="px-3 py-2">{String(r.used_in ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PediaOrdersPanel() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/pedia/orders${status ? `?status=${status}` : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRows(data.rows ?? []);
    } catch { /* best-effort */ } finally { setLoading(false); }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const act = async (code: string, action: string, extra: Record<string, unknown> = {}) => {
    const sid = action === "mark_submitted" ? window.prompt("ID order supplier:") : null;
    if (action === "mark_submitted" && !sid) return;
    if (action === "resubmit" && !window.confirm("Kirim ulang order ini ke supplier? Pastikan belum terkirim (cek dashboard supplier dulu).")) return;
    if (action === "cancel_credit" && !window.confirm("Batalkan order + terbitkan kredit penuh?")) return;
    await fetch(`/api/admin/pedia/orders/${code}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, supplier_order_id: sid, confirm: true, ...extra }),
    }).catch(() => null);
    await load();
  };

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        {(["", "needs_check", "queued", "submitted", "in_progress", "completed", "partial", "canceled"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`h-8 rounded-full px-3 text-xs font-bold ${status === s ? "bg-[#00E5FF] text-[#070a1e]" : "bg-white/5 text-white/60"}`}>
            {s === "" ? "Semua" : s}
          </button>
        ))}
      </div>
      {loading ? <p className="mt-3 text-sm text-white/50">Memuat…</p> : rows.length === 0 ? (
        <p className="mt-3 text-sm text-white/50">Belum ada pesanan Pedia.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={String(r.order_code)} className={`rounded-2xl border p-3 text-xs ${r.status === "needs_check" ? "border-amber-400/40 bg-amber-400/5" : "border-white/10 bg-white/[0.03]"}`}>
              <p className="font-bold text-white">{String(r.order_code)} · {String(r.status)}</p>
              <p className="mt-0.5 text-white/60">{String(r.product_name)} · {String(r.target_normalized).slice(0, 60)} · {String(r.quantity)} · {formatRupiah(Number(r.total))}</p>
              {r.status === "needs_check" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => act(String(r.order_code), "mark_submitted")} className="h-8 rounded-lg bg-white/10 px-3 font-bold text-white">Sudah dibuat (isi ID)</button>
                  <button onClick={() => act(String(r.order_code), "resubmit")} className="h-8 rounded-lg bg-[#00E5FF] px-3 font-bold text-[#070a1e]">Kirim ulang</button>
                  <button onClick={() => act(String(r.order_code), "cancel_credit")} className="h-8 rounded-lg bg-red-500/15 px-3 font-bold text-red-300">Batalkan + kredit</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PediaCreditsPanel() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => {
    fetch("/api/admin/pedia/credits", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setRows(d.rows ?? [])).catch(() => null);
  }, []);
  return (
    <div className="mt-4 space-y-2">
      {rows.length === 0 && <p className="text-sm text-white/50">Belum ada kode kredit.</p>}
      {rows.map((r) => (
        <div key={Number(r.id)} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/70">
          <p className="font-mono font-bold text-white">••••-{String(r.code_hint)}</p>
          <p className="mt-0.5">{String(r.email)} · sisa {formatRupiah(Number(r.remaining))} / {formatRupiah(Number(r.amount))} · {String(r.source_kind)} · s.d. {String(r.expires_at).slice(0, 10)}</p>
        </div>
      ))}
    </div>
  );
}

function PediaSettingsPanel() {
  const [s, setS] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    fetch("/api/admin/pedia/settings", { cache: "no-store" })
      .then((r) => r.json()).then((d) => setS(d.settings ?? {})).catch(() => null);
  }, []);
  const save = async () => {
    setSaving(true);
    await fetch("/api/admin/pedia/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s),
    }).catch(() => null);
    setSaving(false);
  };
  const num = (key: string, label: string) => (
    <label className="block text-xs text-white/60">{label}
      <input type="number" value={s[key] ?? ""} onChange={(e) => setS({ ...s, [key]: Number(e.target.value) })}
        className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white" />
    </label>
  );
  return (
    <div className="mt-4 max-w-lg space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {num("pedia_markup_g1", "Markup G1 %")}
        {num("pedia_markup_g2", "Markup G2 %")}
        {num("pedia_markup_g3", "Markup G3 %")}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {num("pedia_min_profit_g1", "Min profit G1")}
        {num("pedia_min_profit_g2", "Min profit G2")}
        {num("pedia_min_profit_g3", "Min profit G3")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {num("pedia_min_order_rp", "Min order Rp")}
        {num("pedia_balance_alert_rp", "Ambang saldo Rp")}
      </div>
      <p className="text-xs text-white/40">Default baru dipakai untuk tingkat yang diubah admin; harga paket dihitung ulang saat diff masuk.</p>
      <button onClick={save} disabled={saving} className="h-10 rounded-xl bg-[#00E5FF] px-4 text-sm font-bold text-[#070a1e] disabled:opacity-50">
        {saving ? "Menyimpan…" : "Simpan pengaturan"}
      </button>
    </div>
  );
}
