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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WIB TIME (ported from WhatsApp for interactive copy)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

export function formatSoldCount(sold: number): string {
  if (sold >= 1000) {
    const k = sold / 1000;
    return `Terjual ${Number(k.toFixed(1))}rb+`;
  }
  return `Terjual ${sold}+`;
}

export function formatSoldCountLabel(sold: number): string {
  return formatSoldCount(Math.max(0, Math.floor(sold)));
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BREADCRUMB (Langkah X/4 — Produk → Varian → Jumlah → Bayar)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function breadcrumbLine(step: 1 | 2 | 3 | 4): string {
  const steps = ["Produk", "Varian", "Jumlah", "Bayar"];
  return `🧭 ${steps.map((label, i) => (i + 1 === step ? `<b>[${label}]</b>` : label)).join(" → ")} (Langkah ${step}/4)`;
}
