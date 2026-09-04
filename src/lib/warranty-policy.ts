// src/lib/warranty-policy.ts — Canonical warranty policy for all channels
// Single source of truth. Telegram and WhatsApp formatters produce
// channel-appropriate markup from the same content.

export const warrantyTerms = {
  intro: "AXVARA adalah third-party store, BUKAN official store dan tidak terafiliasi dengan brand manapun.",
  priceNote: "Harga di sini jauh lebih murah, tapi tidak ada garansi 100% permanen. Jika pihak official mengubah sistem/kebijakan, produk bisa terdampak kapan saja.",
  warrantyNote: "Garansi AXVARA tetap ada, tapi bervariasi: 1×24 Jam s/d 30 Hari tergantung produk yang kamu pilih. Beda garansi = beda harga.",
  advice: "Pilih produk sesuai kemampuan & kebutuhan garansimu. DYOR, DWYOR.",
  consent: "Lanjut membeli = kamu PAHAM & SETUJU ketentuan ini. Terima kasih 🙏",
};

export const warrantyClaimRules = [
  {
    title: "Garansi berupa penggantian / perbaikan, BUKAN refund dana.",
    detail: "Refund hanya jika stok pengganti kosong dan disetujui admin.",
  },
  {
    title: "Wajib sertakan video/screenshot error + kode pesanan/invoice.",
    detail: "Tanpa bukti = klaim ditolak.",
  },
  {
    title: "Klaim hanya selama masa garansi aktif sesuai deskripsi produk,",
    detail: "terhitung sejak produk dikirim.",
  },
  {
    title: "Garansi HANGUS jika:",
    detail: "password/email diganti tanpa izin, login banyak device/IP bersamaan, melanggar aturan pakai di deskripsi, akun suspend karena pelanggaran user, atau order sudah confirm selesai.",
  },
  {
    title: "Proses penggantian 1×24 jam kerja,",
    detail: "bukan instan. Harap antre.",
  },
  {
    title: "Satu order = satu kali klaim,",
    detail: "kecuali produk 30 hari (maks 2–3× ganti, lihat deskripsi).",
  },
];

// ---- Telegram HTML formatter ----

export function formatWarrantyTelegram(): string {
  return [formatWarrantyTermsTelegram(), "", formatWarrantyClaimsTelegram()].join("\n");
}

export function formatWarrantyTermsTelegram(): string {
  return [
    "📜 <b>KETENTUAN AXVARA — WAJIB BACA SEBELUM BELI</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    `AXVARA adalah <b>third-party store, BUKAN official store</b> dan tidak terafiliasi dengan brand manapun.`,
    "",
    `Harga di sini jauh lebih murah, tapi <b>tidak ada garansi 100% permanen.</b> Jika pihak official mengubah sistem/kebijakan, produk bisa terdampak kapan saja.`,
    "",
    `Garansi AXVARA <b>tetap ada, tapi bervariasi: 1×24 Jam s/d 30 Hari</b> tergantung produk yang kamu pilih. Beda garansi = beda harga.`,
    "",
    `Pilih produk sesuai kemampuan &amp; kebutuhan garansimu. <b>DYOR, DWYOR.</b>`,
    "",
    `Lanjut membeli = kamu <b>PAHAM &amp; SETUJU</b> ketentuan ini. Terima kasih 🙏`,
  ].join("\n");
}

export function formatWarrantyClaimsTelegram(): string {
  const lines = [
    "🛡 <b>SYARAT KLAIM GARANSI</b>",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];
  warrantyClaimRules.forEach((rule, i) => {
    lines.push(`${emojis[i]} ${rule.title.includes("BUKAN") || rule.title.includes("HANGUS") ? `<b>${rule.title}</b>` : rule.title} ${rule.detail}`);
    if (i < warrantyClaimRules.length - 1) lines.push("");
  });
  return lines.join("\n");
}

// ---- WhatsApp plain text formatter ----

export function formatWarrantyWhatsApp(): string {
  return [formatWarrantyTermsWhatsApp(), "", formatWarrantyClaimsWhatsApp()].join("\n");
}

export function formatWarrantyTermsWhatsApp(): string {
  return [
    "*KETENTUAN AXVARA — WAJIB BACA SEBELUM BELI*",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
    "AXVARA adalah *third-party store, BUKAN official store* dan tidak terafiliasi dengan brand manapun.",
    "",
    "Harga di sini jauh lebih murah, tapi *tidak ada garansi 100% permanen.* Jika pihak official mengubah sistem/kebijakan, produk bisa terdampak kapan saja.",
    "",
    "Garansi AXVARA *tetap ada, tapi bervariasi: 1×24 Jam s/d 30 Hari* tergantung produk yang kamu pilih. Beda garansi = beda harga.",
    "",
    "Pilih produk sesuai kemampuan & kebutuhan garansimu. *DYOR, DWYOR.*",
    "",
    "Lanjut membeli = kamu *PAHAM & SETUJU* ketentuan ini. Terima kasih 🙏",
  ].join("\n");
}

export function formatWarrantyClaimsWhatsApp(): string {
  const lines = [
    "*SYARAT KLAIM GARANSI*",
    "━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  warrantyClaimRules.forEach((rule, i) => {
    const num = `${i + 1}.`;
    const title = rule.title.includes("BUKAN") || rule.title.includes("HANGUS") ? `*${rule.title}*` : rule.title;
    lines.push(`${num} ${title} ${rule.detail}`);
    if (i < warrantyClaimRules.length - 1) lines.push("");
  });
  return lines.join("\n");
}
