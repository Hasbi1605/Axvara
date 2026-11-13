"use client";
import { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label, Switch, Tabs, TabsList, TabsTrigger, Skeleton, PageHeader } from "@/components/admin/ui";
import { Save } from "lucide-react";

import { useCallback, useEffect, useState } from "react";
import { useAdminDraft, pushAdminHistory } from "@/components/admin/AdminWorkspace";
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

export function PaymentMethodsManager({ onChanged }: { onChanged?: () => void }) {
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

  const qris = methods.find((method) => method.id === "qris");
  const legacy = methods.filter((method) => method.id !== "qris");
  const savedQris = (JSON.parse(savedMethods) as PaymentMethod[]).find((method) => method.id === "qris");
  const qrisDirty = Boolean(qris && JSON.stringify(qris) !== JSON.stringify(savedQris));

  if (loading) {
    return <div role="status" className="space-y-4"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /><span className="sr-only">Memuat metode pembayaran…</span></div>;
  }

  return (
    <Tabs value={paymentTab} onValueChange={value => changeTab(value as typeof paymentTab)} className="mt-4 space-y-6">
      <PageHeader title="Pembayaran" description="Kelola metode pembayaran dan periksa event rekonsiliasi." />
      <TabsList aria-label="Bagian pembayaran" className="h-auto justify-start">
        <TabsTrigger value="methods">Metode Pembayaran</TabsTrigger>
        <TabsTrigger value="qris">QRIS &amp; Rekonsiliasi</TabsTrigger>
      </TabsList>
      {paymentTab === "methods" ? <>
      {error && <p role="alert" className="rounded-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-2 text-sm text-admin-danger">{error}</p>}
      {qris ? (
        <Card className="max-w-2xl">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div className="min-w-0 space-y-1.5">
              <CardTitle>QRIS Dinamis</CardTitle>
              <CardDescription>Nominal unik dan gambar QR dibuat per pesanan dari merchant QRIS yang aktif. Provider, webhook, dan event pembayaran ada di tab QRIS &amp; Rekonsiliasi.</CardDescription>
            </div>
            <Label className="flex shrink-0 items-center gap-2">
              <Switch checked={qris.is_active} disabled={saving !== null} onCheckedChange={(checked) => update(qris.id, { is_active: checked })} aria-label="QRIS aktif di checkout" />
              {qris.is_active ? "Aktif" : "Nonaktif"}
            </Label>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Label htmlFor="qris-label">Nama yang tampil di checkout</Label>
            <Input id="qris-label" value={qris.label} disabled={saving !== null} onChange={(event) => update(qris.id, { label: event.target.value })} />
          </CardContent>
          <CardFooter className="justify-between gap-3 border-t border-admin-border pt-4">
            <p className="text-xs text-admin-muted">Invoice QRIS berlaku 15 menit dan lunas otomatis setelah event pembayaran merchant cocok.</p>
            <Button type="button" onClick={() => void save(qris)} disabled={saving !== null || !qrisDirty}>
              {saving === qris.id ? "Menyimpan…" : <><Save aria-hidden="true" /> Simpan</>}
            </Button>
          </CardFooter>
        </Card>
      ) : <p className="text-sm text-admin-muted">Metode QRIS belum tersedia di database.</p>}
      {legacy.length > 0 && (
        <details className="group max-w-2xl rounded-md border border-admin-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-admin-fg">
            <span>Rekening transfer lama <Badge variant="secondary" className="ml-2">{legacy.length}</Badge></span>
            <span className="text-xs font-normal text-admin-muted">Baca-saja · tidak ditawarkan di checkout</span>
          </summary>
          <dl className="divide-y divide-admin-border border-t border-admin-border">
            {legacy.map((method) => (
              <div key={method.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[8rem_1fr]">
                <dt className="font-mono text-xs text-admin-muted">{method.id}</dt>
                <dd className="text-admin-fg">{method.label}{method.account_number ? <span className="text-admin-muted"> · {method.account_number}</span> : null}{method.account_name ? <span className="text-admin-muted"> · a.n. {method.account_name}</span> : null}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      </> : <PaymentReconciliation onChanged={onChanged} />}
    </Tabs>
  );
}
