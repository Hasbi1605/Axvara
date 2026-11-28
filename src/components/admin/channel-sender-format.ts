// Format teks blok "Pengirim channel" (admin Kanal & Fulfillment). Murni, tanpa
// dependensi server, agar bisa diuji langsung.
import type { ChannelLastDelivery, ChannelSenderStatus } from "@/lib/telegram/channel-sender-status";

export type SenderBadge = { label: string; variant: "success" | "warning" | "destructive" };

export function senderStatusBadge(sender: Pick<ChannelSenderStatus, "mode" | "userbot">): SenderBadge | null {
  if (sender.mode !== "userbot" || !sender.userbot) return null;
  if (!sender.userbot.reachable) return { label: "Tidak terjangkau", variant: "destructive" };
  return sender.userbot.ready ? { label: "Siap", variant: "success" } : { label: "Terkendala", variant: "warning" };
}

/** "28 Nov 17.00" dalam WIB. */
export function formatDeliveryTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("hour")}.${get("minute")}`;
}

export function describeLastDelivery(last: ChannelLastDelivery | null | undefined): string {
  if (!last) return "Belum ada promo channel terkirim.";
  const slot = last.slot === "morning" ? "Pagi" : last.slot === "evening" ? "Sore" : last.slot;
  const when = formatDeliveryTime(last.at);
  const via = last.via === "userbot"
    ? "via userbot"
    : last.via === "bot_fallback"
      ? `via bot (cadangan${last.reason ? `: ${last.reason}` : ""})`
      : "via bot";
  const segments = [`Terakhir: ${slot}${when ? ` ${when}` : ""}`, via];
  if (last.state === "unknown") segments.push(`hasil tidak pasti${last.reason ? ` (${last.reason})` : ""}`);
  else if (last.state === "failed") segments.push(`gagal${last.reason ? ` (${last.reason})` : ""}`);
  if (last.buttons === "attached") segments.push("tombol terpasang");
  else if (last.buttons === "failed") segments.push("tombol gagal");
  return segments.join(" · ");
}
