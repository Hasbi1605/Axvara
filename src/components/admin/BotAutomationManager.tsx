"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IosIcon } from "@/components/admin/AdminIcon";
import { Spinner } from "@/components/ui/Loading";
import { useToast } from "@/components/ui/Toast";

interface HealthData {
  bot_configured: boolean;
  bot_enabled: boolean;
  fulfillment_enabled: boolean;
  encryption_key_set: boolean;
  whatsapp_configured: boolean;
  whatsapp_enabled: boolean;
  whatsapp_discovery: boolean;
  whatsapp_payment: boolean;
  whatsapp_proof_intake: boolean;
  webhook?: { url?: string; pending_updates?: number; last_error?: string | null; error?: string };
  telegram_orders?: { status: string; count: number }[];
  whatsapp_orders?: { payment_status: string; count: number }[];
  fulfillment_jobs?: { status: string; count: number }[];
  whatsapp_outbox?: { status: string; count: number }[];
}

export default function BotAutomationManager() {
  const toast = useToast();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [webhookLoading, setWebhookLoading] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/bot/health", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as HealthData & { error?: string };
      if (!response.ok) throw new Error(data.error || "Status otomasi gagal dimuat");
      setHealth(data);
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Status otomasi gagal dimuat"); }
    finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void fetchHealth(); }, [fetchHealth]);

  const setTelegramWebhook = async () => {
    setWebhookLoading(true);
    try {
      const response = await fetch("/api/admin/telegram/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set" }) });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; webhook_url?: string; description?: string; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.description || data.error || "Webhook gagal dipasang");
      toast.success("Webhook Telegram berhasil diperbarui.");
      await fetchHealth();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Webhook gagal dipasang"); }
    finally { setWebhookLoading(false); }
  };

  if (loading) return <div className="mt-4 flex min-h-52 items-center justify-center gap-3 rounded-xl bg-admin-subtle text-sm text-admin-muted"><Spinner size={20} /> Memuat kanal dan otomasi…</div>;

  return <div className="mt-4 space-y-4">
    <section className="admin-surface overflow-hidden rounded-xl">
      <header className="flex flex-wrap items-center gap-3 border-b border-admin-border p-4 sm:p-5"><div className="min-w-0"><h2 className="text-sm font-semibold text-admin-fg">Kanal penjualan</h2><p className="mt-0.5 text-xs text-admin-muted">Kesehatan Telegram dan gateway WhatsApp Baileys.</p></div><button onClick={() => void fetchHealth()} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-admin-border px-3 text-xs font-semibold text-admin-muted transition hover:bg-admin-subtle hover:text-admin-fg"><IosIcon name="refresh" size={13} tint="white" /> Muat ulang</button></header>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
        <ChannelCard title="Telegram" ready={Boolean(health?.bot_configured && health.bot_enabled)} rows={[["Token", health?.bot_configured], ["Bot aktif", health?.bot_enabled], ["Webhook", Boolean(health?.webhook?.url && !health.webhook.error)]]}>
          <p className="mt-3 break-all font-mono text-xs text-admin-muted">{health?.webhook?.url || "Webhook belum tersedia"}</p>
          {health?.webhook?.last_error && <p className="mt-1 text-xs text-admin-danger">{health.webhook.last_error}</p>}
          <button onClick={() => void setTelegramWebhook()} disabled={webhookLoading || !health?.bot_configured} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-admin-primary px-3.5 text-xs font-bold text-admin-inverse transition hover:bg-admin-primary disabled:opacity-40">{webhookLoading ? <Spinner size={13} /> : <IosIcon name="send" size={13} tint="black" />} Pasang/perbarui webhook</button>
        </ChannelCard>
        <ChannelCard title="WhatsApp Baileys" ready={Boolean(health?.whatsapp_configured && health.whatsapp_enabled)} rows={[["Gateway", health?.whatsapp_configured], ["Bot aktif", health?.whatsapp_enabled], ["Pencarian", health?.whatsapp_discovery], ["Pembayaran", health?.whatsapp_payment], ["Bukti manual", health?.whatsapp_proof_intake]]}>
          <p className="mt-3 text-xs leading-5 text-admin-muted">Status ini memeriksa konfigurasi server. Koneksi sesi Baileys tetap perlu dilaporkan oleh health endpoint gateway Heroku.</p>
        </ChannelCard>
      </div>
    </section>

    <section className="admin-surface overflow-hidden rounded-xl">
      <header className="border-b border-admin-border p-4 sm:p-5"><h2 className="text-sm font-semibold text-admin-fg">Antrean otomasi</h2><p className="mt-0.5 text-xs text-admin-muted">Pantau pengiriman fulfillment dan pesan keluar WhatsApp.</p></header>
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5"><QueueCard title="Fulfillment jobs" rows={health?.fulfillment_jobs || []} labelKey="status" /><QueueCard title="WhatsApp outbox" rows={health?.whatsapp_outbox || []} labelKey="status" /></div>
      <div className="mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-admin-accent/15 bg-admin-primary/[0.045] p-4 sm:mx-5 sm:mb-5"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-admin-fg">Konfigurasi produk dipusatkan di Varian</p><p className="mt-1 text-xs leading-5 text-admin-muted">Mode manual/shared/unique, pesan bersama, dan stok unik sekarang dikelola bersama SKU agar tidak ada pengaturan ganda.</p></div><Link href="/admin?section=products" className="inline-flex h-9 shrink-0 items-center rounded-xl bg-admin-primary px-4 text-xs font-bold text-admin-inverse transition hover:bg-admin-primary">Buka Produk</Link></div>
    </section>
  </div>;
}

function ChannelCard({ title, ready, rows, children }: { title: string; ready: boolean; rows: [string, boolean | undefined][]; children: React.ReactNode }) {
  return <article className="rounded-xl border border-admin-border bg-admin-subtle p-4"><div className="flex items-center justify-between gap-3"><h3 className="min-w-0 text-sm font-semibold text-admin-fg">{title}</h3><span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-bold ${ready ? "bg-emerald-500/10 text-admin-success" : "bg-red-500/10 text-admin-danger"}`}>{ready ? "Siap" : "Perlu konfigurasi"}</span></div><div className="mt-4 grid grid-cols-2 gap-2">{rows.map(([label, ok]) => <div key={label} className={`rounded-lg px-2.5 py-2 text-xs font-medium ${ok ? "bg-emerald-500/[0.07] text-admin-success" : "bg-red-500/[0.07] text-admin-danger"}`}><span className={`mr-2 inline-block h-1.5 w-1.5 rounded-md ${ok ? "bg-emerald-400" : "bg-red-400"}`} />{label}</div>)}</div>{children}</article>;
}

function QueueCard({ title, rows, labelKey }: { title: string; rows: Record<string, unknown>[]; labelKey: string }) {
  return <article className="rounded-xl border border-admin-border bg-admin-subtle p-4"><h3 className="text-sm font-semibold text-admin-fg">{title}</h3><div className="mt-3 flex flex-wrap gap-2">{rows.length ? rows.map((row) => <span key={String(row[labelKey])} className={`rounded-md px-2.5 py-1 text-xs ${["failed", "dead", "manual_required"].includes(String(row[labelKey])) ? "bg-red-500/10 text-admin-danger" : "bg-admin-subtle text-admin-muted"}`}>{String(row[labelKey])}: {Number(row.count || 0)}</span>) : <span className="text-xs text-admin-muted">Belum ada antrean.</span>}</div></article>;
}
