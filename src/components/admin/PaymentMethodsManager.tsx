"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminDraft, pushAdminHistory } from "@/components/admin/AdminWorkspace";
import { IosIcon } from "@/components/admin/AdminIcon";
import { useToast } from "@/components/ui/Toast";
import { PaymentReconciliation } from "@/components/admin/PaymentReconciliation";

type PaymentMethod = {
  id: string;
  label: string;
  account_number: string;
  account_name: string;
  qris_url: string | null;
  is_active: boolean;
  sort_order: number;
};

export function PaymentMethodsManager() {
  const toast = useToast();
  const initialTab = typeof window === "undefined" ? "methods" : new URLSearchParams(window.location.search).get("payment_tab") === "qris" ? "qris" : "methods";
  const [paymentTab, setPaymentTab] = useState<"methods" | "qris">(initialTab);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedMethods, setSavedMethods] = useState("[]");
  useAdminDraft(JSON.stringify(methods) !== savedMethods || saving !== null, saving !== null);
  useEffect(() => { const sync = () => setPaymentTab(new URLSearchParams(location.search).get("payment_tab") === "qris" ? "qris" : "methods"); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  const changeTab = (tab: "methods" | "qris") => { const url = new URL(location.href); url.searchParams.set("payment_tab", tab); pushAdminHistory(url); setPaymentTab(tab); };
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/payment-methods?all=1", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Metode pembayaran gagal dimuat");
      const loaded = (body.payment_methods ?? []).map((method: Record<string, unknown>) => ({
        id: String(method.id),
        label: String(method.label ?? ""),
        account_number: String(method.account_number ?? ""),
        account_name: String(method.account_name ?? ""),
        qris_url: method.qris_url ? String(method.qris_url) : null,
        is_active: Boolean(method.is_active),
        sort_order: Number(method.sort_order ?? 0),
      }));
      setMethods(loaded); setSavedMethods(JSON.stringify(loaded));
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

  if (loading) {
    return <div className="mt-5 rounded-xl bg-admin-subtle p-8 text-center text-sm text-admin-muted">Memuat metode pembayaran…</div>;
  }

  return (
    <section className="mt-4 space-y-4">
      <div className="inline-flex rounded-xl border border-admin-border bg-admin-subtle p-1" role="tablist" aria-label="Bagian pembayaran">
        <button role="tab" aria-selected={paymentTab === "methods"} onClick={() => changeTab("methods")} className={`h-9 rounded-lg px-4 text-xs font-semibold transition ${paymentTab === "methods" ? "bg-admin-primary text-admin-inverse" : "text-admin-muted hover:text-admin-fg"}`}>Metode Pembayaran</button>
        <button role="tab" aria-selected={paymentTab === "qris"} onClick={() => changeTab("qris")} className={`h-9 rounded-lg px-4 text-xs font-semibold transition ${paymentTab === "qris" ? "bg-admin-primary text-admin-inverse" : "text-admin-muted hover:text-admin-fg"}`}>QRIS &amp; Rekonsiliasi</button>
      </div>
      {paymentTab === "methods" ? <>
      <div className="admin-surface rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-admin-border p-4 sm:p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-admin-fg">Metode Pembayaran</h2>
            <p className="text-xs text-admin-muted">QRIS dikelola di sini. VA/e-wallet dan crypto mengikuti katalog provider. Rekening transfer lama hanya untuk histori, tidak ditawarkan di checkout.</p>
          </div>
        </div>
        {error && <p className="mx-4 mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-admin-danger sm:mx-5">{error}</p>}
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
          {methods.map((method) => (
            <fieldset disabled={method.id !== "qris" || saving !== null} key={method.id} className="rounded-xl border border-admin-border bg-admin-subtle p-4 transition hover:border-admin-border">
              <div className="flex items-center justify-between gap-3">
                {method.id !== "qris" && <span className="text-xs text-admin-muted">Legacy · baca-saja</span>}
                <span className="rounded-md bg-admin-subtle px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-admin-muted">{method.id}</span>
                <label className="inline-flex shrink-0 items-center gap-2 text-xs text-admin-muted">
                  <input type="checkbox" checked={method.is_active} onChange={(event) => update(method.id, { is_active: event.target.checked })} className="accent-admin-accent" />
                  Aktif (QRIS saja)
                </label>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-admin-muted">Label</span>
                  <input value={method.label} onChange={(event) => update(method.id, { label: event.target.value })} className="h-10 rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg focus:border-admin-accent/40 focus:outline-none" />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-admin-muted">Nama pemilik</span>
                  <input value={method.account_name} onChange={(event) => update(method.id, { account_name: event.target.value })} className="h-10 rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg focus:border-admin-accent/40 focus:outline-none" />
                </label>
                {method.id === "qris" ? (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-3">
                    <div><p className="text-xs font-semibold text-admin-success">QRIS dinamis otomatis</p>
                    <p className="mt-1 text-xs leading-5 text-admin-muted">Nominal unik dan gambar QR dibuat per pesanan dari merchant QRIS yang aktif. Lihat provider dan konfigurasi di tab QRIS &amp; Rekonsiliasi. Tidak ada gambar QRIS statis yang perlu diunggah.</p></div>
                  </div>
                ) : (
                  <label className="grid gap-1">
                    <span className="text-xs font-medium text-admin-muted">Nomor tujuan</span>
                    <input inputMode="numeric" value={method.account_number} onChange={(event) => update(method.id, { account_number: event.target.value.replace(/\D/g, "") })} className="h-10 rounded-xl border border-admin-border bg-admin-subtle px-3 font-mono text-sm text-admin-fg focus:border-admin-accent/40 focus:outline-none" />
                  </label>
                )}
                <label className="grid gap-1">
                  <span className="text-xs font-medium text-admin-muted">Urutan</span>
                  <input type="number" min={0} max={999} value={method.sort_order} onChange={(event) => update(method.id, { sort_order: Number(event.target.value) })} className="h-10 rounded-xl border border-admin-border bg-admin-subtle px-3 text-sm text-admin-fg focus:border-admin-accent/40 focus:outline-none" />
                </label>
              </div>
              <button type="button" onClick={() => void save(method)} disabled={saving === method.id} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-admin-primary text-sm font-bold text-admin-inverse transition hover:bg-admin-primary disabled:opacity-50">
                {saving === method.id ? "Menyimpan…" : <><IosIcon name="checked" size={14} tint="black" /> Simpan</>}
              </button>
            </fieldset>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-admin-muted">Checkout mempertahankan harga/rekening selama 60 menit. Invoice QRIS dinamis berlaku 15 menit dan lunas setelah event pembayaran merchant cocok dengan invoice.</p>
      </> : <PaymentReconciliation />}
    </section>
  );
}
