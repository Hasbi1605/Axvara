"use client";
// Kartu "Biaya transaksi (MDR)" di Pembayaran → Metode (16 November 2026).
// Persen MDR per penyedia QRIS dipakai Ringkasan untuk "Biaya pembayaran".
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Input, Label, Skeleton } from "../ui";
import { useToast } from "@/components/ui/Toast";
import { MDR_MAX_BPS, MDR_PROVIDERS, MDR_PROVIDER_LABEL, type MdrProvider, type PaymentFeeSettings } from "@/lib/finance/types";
import { financeRequest } from "./api";

const toPercentText = (bps: number) => (bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });
/** "0,7" / "0.7" → 70 bps; kosong → 0; tak valid → null. */
function parsePercent(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!clean) return 0;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(clean)) return null;
  const bps = Math.round(Number(clean) * 100);
  return bps >= 0 && bps <= MDR_MAX_BPS ? bps : null;
}

export function PaymentFeesCard({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState<PaymentFeeSettings | null>(null);
  const [draft, setDraft] = useState<Record<MdrProvider, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    financeRequest<PaymentFeeSettings>("/api/admin/payment-fees").then((value) => {
      if (!active) return;
      setSaved(value);
      setDraft(Object.fromEntries(MDR_PROVIDERS.map((p) => [p, toPercentText(value.mdr_bps[p] ?? 0)])) as Record<MdrProvider, string>);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Biaya transaksi gagal dimuat."); });
    return () => { active = false; };
  }, []);

  const parsed = draft ? Object.fromEntries(MDR_PROVIDERS.map((p) => [p, parsePercent(draft[p])])) as Record<MdrProvider, number | null> : null;
  const invalid = parsed ? MDR_PROVIDERS.filter((p) => parsed[p] === null) : [];
  const dirty = Boolean(parsed && saved && MDR_PROVIDERS.some((p) => parsed[p] !== null && parsed[p] !== (saved.mdr_bps[p] ?? 0)));

  const save = async () => {
    if (!parsed || invalid.length) return;
    setBusy(true);
    try {
      const value = await financeRequest<PaymentFeeSettings>("/api/admin/payment-fees", "PUT", { mdr_bps: parsed });
      setSaved(value);
      toast.success("MDR disimpan.");
      onChanged?.();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Gagal menyimpan."); }
    finally { setBusy(false); }
  };

  return <Card className="max-w-2xl">
    <CardHeader className="space-y-1.5">
      <CardTitle>Biaya transaksi (MDR)</CardTitle>
      <CardDescription>Potongan QRIS yang mengurangi untung bersih.</CardDescription>
    </CardHeader>
    <CardContent>
      {error ? <p role="alert" className="text-sm text-admin-danger">{error}</p> : !draft ? <Skeleton className="h-24 w-full" /> :
        <div className="grid gap-3 sm:grid-cols-3">
          {MDR_PROVIDERS.map((provider) => <div key={provider} className="space-y-1.5">
            <Label htmlFor={`mdr-${provider}`}>{MDR_PROVIDER_LABEL[provider]}</Label>
            <div className="relative">
              <Input id={`mdr-${provider}`} inputMode="decimal" value={draft[provider]} disabled={busy} aria-invalid={parsed?.[provider] === null}
                aria-describedby={parsed?.[provider] === null ? `mdr-${provider}-error` : undefined}
                onChange={(e) => setDraft((d) => d && { ...d, [provider]: e.target.value })} className="h-10 pr-8 tabular-nums" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-admin-muted">%</span>
            </div>
            {parsed?.[provider] === null && <p id={`mdr-${provider}-error`} className="text-xs text-admin-danger">0–{MDR_MAX_BPS / 100}%, maks 2 desimal</p>}
          </div>)}
        </div>}
    </CardContent>
    <CardFooter className="justify-between gap-3 border-t border-admin-border pt-4">
      <p className="text-xs text-admin-muted">0 = tanpa potongan.</p>
      <Button type="button" onClick={() => void save()} disabled={busy || !dirty || invalid.length > 0}>
        {busy ? "Menyimpan…" : <><Save aria-hidden="true" /> Simpan</>}
      </Button>
    </CardFooter>
  </Card>;
}
