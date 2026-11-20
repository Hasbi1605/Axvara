// src/lib/telegram/messages/format.ts — Helper format bersama semua modul pesan.
//
// MENGAPA dipisah: escape HTML, format Rupiah, truncate, waktu WIB, label
// "Terjual", dan breadcrumb dipakai oleh HAMPIR SEMUA fungsi pesan (katalog,
// pembelian, status, admin). Menaruhnya di satu tempat mencegah duplikasi dan
// menjamin escaping XSS konsisten — bila helper ini benar, seluruh pesan aman.
// Ini murni pemindahan; teks/logika identik dengan messages.ts lama.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

// ponytail: callers supply at most 20 item rows; paginate before raising that cap.
export function escapeItemSummary(text: string, maxLength: number): string {
  const rawLines = text.split("\n");
  const lines = rawLines.map(escapeHtml);
  if (lines.join("\n").length <= maxLength) return lines.join("\n");
  let remaining = maxLength - lines.length + 1;
  return lines.map((line, index) => {
    const limit = Math.floor(remaining / (lines.length - index));
    let result = line;
    if (line.length > limit) {
      const quantity = rawLines[index].match(/\s+[x×]\d+$/)?.[0] ?? "";
      result = "";
      for (const char of rawLines[index]) {
        const escaped = escapeHtml(char);
        if (result.length + escaped.length > limit - 3 - quantity.length) break;
        result += escaped;
      }
      result += `...${quantity}`;
    }
    remaining -= result.length;
    return result;
  }).join("\n");
}

export const paymentLabels: Record<string, string> = {
  unpaid: "Menunggu pembayaran",
  pending: "Menunggu pembayaran",
  paid: "Lunas",
  expired: "Kedaluwarsa",
  failed: "Gagal",
  cancelled: "Dibatalkan",
};

export const fulfillmentLabels: Record<string, string> = {
  not_required: "Belum diproses",
  reserved: "Disiapkan",
  queued: "Dalam antrean",
  sending: "Sedang dikirim",
  delivered: "Terkirim",
  manual_required: "Diproses admin",
  retry: "Menunggu pengiriman ulang",
  failed: "Gagal dikirim",
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WIB TIME (ported from WhatsApp for interactive copy)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function invoiceDeadline(expiresMs: number | null, en: boolean, now = Date.now()) {
  if (expiresMs === null) return { clock: "—", remaining: "—" };
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(expiresMs) + " WIB";
  const minutes = Math.max(0, Math.ceil((expiresMs - now) / 60_000));
  return { clock, remaining: `${minutes} ${en ? (minutes === 1 ? "minute" : "minutes") : "menit"}` };
}

export function invoiceItemName(product: string, variant: string, qty: number): string {
  const norm = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  return `${product}${variant && norm(product) !== norm(variant) ? ` — ${variant}` : ""} ×${qty}`;
}

export function invoiceItems(raw: unknown): { name?: unknown; qty?: unknown; product_id?: unknown }[] {
  try {
    const items = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(items) ? items.filter(item => item && typeof item === "object") : [];
  } catch { return []; }
}

export function invoiceItemSummary(raw: unknown, en = false): string {
  const fallback = en ? "Order" : "Pesanan";
  return invoiceItems(raw).slice(0, 20).map(item => {
    const qty = Math.max(1, Number(item.qty) || 1);
    const name = String(item.name || fallback).replace(/\s+/g, " ").trim();
    // Historical snapshots store product and variant as a single label.
    const [product, ...rest] = name.split(" — ");
    return invoiceItemName(product, rest.join(" — "), qty);
  }).join("\n") || fallback;
}

export function formatWIBTime(): { greeting: string; tanggal: string; jam: string } {
  const d = new Date();
  const wibOffset = 7 * 60; // WIB is UTC+7
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const wibDate = new Date(utc + wibOffset * 60000);

  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const day = wibDate.getDate();
  const month = months[wibDate.getMonth()];
  const year = wibDate.getFullYear();

  const hours = String(wibDate.getHours()).padStart(2, "0");
  const minutes = String(wibDate.getMinutes()).padStart(2, "0");

  const hourNum = wibDate.getHours();
  let greeting = "Selamat Malam 🌙";
  if (hourNum >= 4 && hourNum < 11) greeting = "Selamat Pagi ☀️";
  else if (hourNum >= 11 && hourNum < 15) greeting = "Selamat Siang 🌤️";
  else if (hourNum >= 15 && hourNum < 18) greeting = "Selamat Sore ⛅";

  return {
    greeting,
    tanggal: `${day} ${month} ${year}`,
    jam: `${hours}:${minutes} WIB`,
  };
}

export function formatSoldCount(sold: number, locale: "id" | "en" = "id"): string {
  if (locale === "en") {
    if (sold >= 1000) {
      const k = sold / 1000;
      return `Sold ${Number(k.toFixed(1))}k+`;
    }
    return `Sold ${sold}+`;
  }
  if (sold >= 1000) {
    const k = sold / 1000;
    return `Terjual ${Number(k.toFixed(1))}rb+`;
  }
  return `Terjual ${sold}+`;
}

export function formatSoldCountLabel(sold: number, locale: "id" | "en" = "id"): string {
  return formatSoldCount(Math.max(0, Math.floor(sold)), locale);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BREADCRUMB (Langkah X/4 — Produk → Varian → Jumlah → Bayar)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function breadcrumbLine(step: 1 | 2 | 3 | 4): string {
  const steps = ["Produk", "Varian", "Jumlah", "Bayar"];
  return `🧭 ${steps.map((label, i) => (i + 1 === step ? `<b>[${label}]</b>` : label)).join(" → ")} (Langkah ${step}/4)`;
}
