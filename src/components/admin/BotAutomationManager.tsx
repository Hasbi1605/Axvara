"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IosIcon } from "@/components/ui/IosIcon";
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

  if (loading) return <div className="mt-5 flex min-h-52 items-center justify-center gap-3 rounded-[20px] bg-white/[0.04] text-sm text-white/45"><Spinner size={20} /> Memuat kanal dan otomasi…</div>;

  return <div className="mt-5 space-y-5">
    <section className="ax-glass overflow-hidden rounded-[20px]">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4 sm:p-5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5"><IosIcon name="bot" size={17} tint="white" /></span><div className="min-w-0"><h2 className="text-sm font-semibold text-white">Kanal penjualan</h2><p className="mt-0.5 text-[11px] text-white/40">Kesehatan Telegram dan gateway WhatsApp Baileys.</p></div><button onClick={() => void fetchHealth()} className="ml-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/10 px-3 text-xs font-semibold text-white/55 transition hover:bg-white/5 hover:text-white"><IosIcon name="refresh" size={13} tint="white" /> Muat ulang</button></header>
      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
        <ChannelCard title="Telegram" icon="telegram-app" iconTint="#229ED9" ready={Boolean(health?.bot_configured && health.bot_enabled)} rows={[["Token", health?.bot_configured], ["Bot aktif", health?.bot_enabled], ["Webhook", Boolean(health?.webhook?.url && !health.webhook.error)]]}>
          <p className="mt-3 break-all font-mono text-[11px] text-white/35">{health?.webhook?.url || "Webhook belum tersedia"}</p>
          {health?.webhook?.last_error && <p className="mt-1 text-xs text-red-300">{health.webhook.last_error}</p>}
          <button onClick={() => void setTelegramWebhook()} disabled={webhookLoading || !health?.bot_configured} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl bg-[#00E5FF] px-3.5 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8] disabled:opacity-40">{webhookLoading ? <Spinner size={13} /> : <IosIcon name="send" size={13} tint="black" />} Pasang/perbarui webhook</button>
        </ChannelCard>
        <ChannelCard title="WhatsApp Baileys" icon="whatsapp" iconTint="#25D366" ready={Boolean(health?.whatsapp_configured && health.whatsapp_enabled)} rows={[["Gateway", health?.whatsapp_configured], ["Bot aktif", health?.whatsapp_enabled], ["Pencarian", health?.whatsapp_discovery], ["Pembayaran", health?.whatsapp_payment], ["Bukti manual", health?.whatsapp_proof_intake]]}>
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-white/35"><IosIcon name="info" size={13} tint="white" /> <span>Status ini memeriksa konfigurasi server. Koneksi sesi Baileys tetap perlu dilaporkan oleh health endpoint gateway Heroku.</span></p>
        </ChannelCard>
      </div>
    </section>

    <section className="ax-glass overflow-hidden rounded-[20px]">
      <header className="border-b border-white/10 p-4 sm:p-5"><h2 className="flex items-center gap-2 text-sm font-semibold text-white"><IosIcon name="clock" size={15} tint="white" /> Antrean otomasi</h2><p className="mt-0.5 text-[11px] text-white/40">Pantau pengiriman fulfillment dan pesan keluar WhatsApp.</p></header>
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5"><QueueCard title="Fulfillment jobs" rows={health?.fulfillment_jobs || []} labelKey="status" /><QueueCard title="WhatsApp outbox" rows={health?.whatsapp_outbox || []} labelKey="status" /></div>
      <div className="mx-4 mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#00E5FF]/15 bg-[#00E5FF]/[0.045] p-4 sm:mx-5 sm:mb-5"><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-white">Konfigurasi produk dipusatkan di Varian</p><p className="mt-1 text-xs leading-5 text-white/40">Mode manual/shared/unique, pesan bersama, dan stok unik sekarang dikelola bersama SKU agar tidak ada pengaturan ganda.</p></div><Link href="/admin?section=products" className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl bg-[#00E5FF] px-4 text-xs font-bold text-[#07101f] transition hover:bg-[#00D0E8]"><IosIcon name="box" size={13} tint="black" /> Buka Produk</Link></div>
    </section>
  </div>;
}

function ChannelCard({ title, icon, iconTint, ready, rows, children }: { title: string; icon: "telegram-app" | "whatsapp"; iconTint: string; ready: boolean; rows: [string, boolean | undefined][]; children: React.ReactNode }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><div className="flex items-center justify-between gap-3"><h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white"><IosIcon name={icon} size={16} tint={iconTint} /> {title}</h3><span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${ready ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}><IosIcon name={ready ? "checked" : "info"} size={10} tint={ready ? "#22C55E" : "#F87171"} />{ready ? "Siap" : "Perlu konfigurasi"}</span></div><div className="mt-4 grid grid-cols-2 gap-2">{rows.map(([label, ok]) => <div key={label} className={`rounded-lg px-2.5 py-2 text-xs font-medium ${ok ? "bg-emerald-500/[0.07] text-emerald-300" : "bg-red-500/[0.07] text-red-300"}`}><span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />{label}</div>)}</div>{children}</article>;
}

function QueueCard({ title, rows, labelKey }: { title: string; rows: Record<string, unknown>[]; labelKey: string }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-white"><IosIcon name="clock" size={14} tint="white" /> {title}</h3><div className="mt-3 flex flex-wrap gap-2">{rows.length ? rows.map((row) => <span key={String(row[labelKey])} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${["failed", "dead", "manual_required"].includes(String(row[labelKey])) ? "bg-red-500/10 text-red-300" : "bg-white/[0.06] text-white/55"}`}><IosIcon name={["failed", "dead", "manual_required"].includes(String(row[labelKey])) ? "close" : "checked"} size={10} tint={["failed", "dead", "manual_required"].includes(String(row[labelKey])) ? "#F87171" : "#22C55E"} />{String(row[labelKey])}: {Number(row.count || 0)}</span>) : <span className="text-xs text-white/35">Belum ada antrean.</span>}</div></article>;
}
