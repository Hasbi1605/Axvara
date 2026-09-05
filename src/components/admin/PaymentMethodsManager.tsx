"use client";

import { useCallback, useEffect, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
import { useToast } from "@/components/ui/Toast";

type PaymentMethod = {
  id: string;
  label: string;
  account_number: string;
  account_name: string;
  qris_url: string | null;
  is_active: boolean;
  sort_order: number;
};

const emptyBank = (): PaymentMethod => ({
  id: "",
  label: "",
  account_number: "",
  account_name: "Brotherstore06",
  qris_url: null,
  is_active: true,
  sort_order: 10,
});

export function PaymentMethodsManager() {
  const toast = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newBank, setNewBank] = useState<PaymentMethod>(emptyBank);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/payment-methods?all=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Metode pembayaran gagal dimuat");
      setMethods((body.payment_methods ?? []).map((method: Record<string, unknown>) => ({
        id: String(method.id),
        label: String(method.label ?? ""),
        account_number: String(method.account_number ?? ""),
        account_name: String(method.account_name ?? ""),
        qris_url: method.qris_url ? String(method.qris_url) : null,
        is_active: Boolean(method.is_active),
        sort_order: Number(method.sort_order ?? 0),
      })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Metode pembayaran gagal dimuat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (id: string, patch: Partial<PaymentMethod>) => {
    setMethods((current) => current.map((method) => method.id === id ? { ...method, ...patch } : method));
  };

  const save = async (method: PaymentMethod) => {
    setSaving(method.id);
    setError(null);
    try {
      const response = await fetch(`/api/payment-methods?id=${encodeURIComponent(method.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(method),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Metode pembayaran gagal disimpan");
      toast.success(`${method.label} diperbarui.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Metode pembayaran gagal disimpan");
    } finally {
      setSaving(null);
    }
  };

  const createBank = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/payment-methods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newBank),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Rekening bank gagal ditambahkan");
      toast.success(`${newBank.label} ditambahkan.`);
      setNewBank(emptyBank());
      setAdding(false);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Rekening bank gagal ditambahkan");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="mt-5 rounded-2xl bg-white/[0.05] p-8 text-center text-sm text-white/50">Memuat metode pembayaran…</div>;
  }

  return (
    <section className="mt-5">
      <div className="ax-glass rounded-[20px] overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-white/10 p-4 sm:p-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/5 bg-white/5">
            <IosIcon name="credit-card" size={16} tint="white" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-white">Metode Pembayaran</h2>
            <p className="text-xs text-white/40">Sumber tunggal rekening yang ditampilkan saat checkout.</p>
          </div>
          <button type="button" onClick={() => setAdding((current) => !current)} className="ml-auto h-9 rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/10 px-3 text-xs font-semibold text-[#00E5FF] hover:bg-[#00E5FF]/15">
            {adding ? "Batal" : "+ Tambah bank"}
          </button>
        </div>
        {error && <p className="mx-4 mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 sm:mx-5">{error}</p>}
        {adding && (
          <div className="mx-4 mt-4 rounded-2xl border border-[#00E5FF]/20 bg-[#00E5FF]/[0.05] p-4 sm:mx-5">
            <p className="text-sm font-semibold text-white">Tambah rekening bank</p>
            <p className="mt-1 text-xs text-white/40">ID dipakai sistem, misalnya <span className="font-mono">bca</span> atau <span className="font-mono">mandiri</span>.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-white/50">ID bank</span>
                <input value={newBank.id} onChange={(event) => setNewBank((current) => ({ ...current, id: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") }))} placeholder="bca" className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-white/50">Label</span>
                <input value={newBank.label} onChange={(event) => setNewBank((current) => ({ ...current, label: event.target.value }))} placeholder="BCA" className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-white/50">Nomor tujuan</span>
                <input inputMode="numeric" value={newBank.account_number} onChange={(event) => setNewBank((current) => ({ ...current, account_number: event.target.value.replace(/\D/g, "") }))} placeholder="1234567890" className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-white/50">Nama pemilik</span>
                <input value={newBank.account_name} onChange={(event) => setNewBank((current) => ({ ...current, account_name: event.target.value }))} className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-white/60">
                <input type="checkbox" checked={newBank.is_active} onChange={(event) => setNewBank((current) => ({ ...current, is_active: event.target.checked }))} className="accent-[#00E5FF]" />
                Langsung aktif di checkout
              </label>
              <button type="button" onClick={() => void createBank()} disabled={creating} className="h-10 rounded-xl bg-[#00E5FF] px-5 text-sm font-bold text-[#080C1E] disabled:opacity-50">
                {creating ? "Menambahkan…" : "Tambah rekening"}
              </button>
            </div>
          </div>
        )}
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
          {methods.map((method) => (
            <article key={method.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-white/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-white/50">{method.id}</span>
                <label className="inline-flex items-center gap-2 text-xs text-white/60">
                  <input type="checkbox" checked={method.is_active} onChange={(event) => update(method.id, { is_active: event.target.checked })} className="accent-[#00E5FF]" />
                  Aktif
                </label>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-white/50">Label</span>
                  <input value={method.label} onChange={(event) => update(method.id, { label: event.target.value })} className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-white/50">Nama pemilik</span>
                  <input value={method.account_name} onChange={(event) => update(method.id, { account_name: event.target.value })} className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
                </label>
                {method.id === "qris" ? (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-3">
                    <p className="text-xs font-semibold text-emerald-300">QRIS dinamis otomatis</p>
                    <p className="mt-1 text-[11px] leading-5 text-white/45">Nominal unik dan gambar QR dibuat per pesanan dari DANA Business. Tidak ada gambar QRIS statis yang perlu diunggah.</p>
                  </div>
                ) : (
                  <label className="grid gap-1">
                    <span className="text-[11px] font-medium text-white/50">Nomor tujuan</span>
                    <input inputMode="numeric" value={method.account_number} onChange={(event) => update(method.id, { account_number: event.target.value.replace(/\D/g, "") })} className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 font-mono text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
                  </label>
                )}
                <label className="grid gap-1">
                  <span className="text-[11px] font-medium text-white/50">Urutan</span>
                  <input type="number" min={0} max={999} value={method.sort_order} onChange={(event) => update(method.id, { sort_order: Number(event.target.value) })} className="h-10 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-white focus:border-[#00E5FF]/40 focus:outline-none" />
                </label>
              </div>
              <button type="button" onClick={() => void save(method)} disabled={saving === method.id} className="mt-4 h-10 w-full rounded-xl bg-[#00E5FF] text-sm font-bold text-[#080C1E] disabled:opacity-50">
                {saving === method.id ? "Menyimpan…" : "Simpan"}
              </button>
            </article>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-white/35">Checkout mempertahankan harga/rekening selama 60 menit. Invoice QRIS dinamis berlaku 15 menit dan lunas otomatis melalui QRIS Hook.</p>
    </section>
  );
}
