"use client";

// src/components/pedia/Glossary.tsx — Panduan istilah SMM bahasa manusia.
// Singkatan supplier (HQ, refill, drop, dst.) diterjemahkan sekali di sini
// dan ditampilkan sebagai panel terlipat di halaman order.

import { useState } from "react";

const TERMS: { term: string; meaning: string }[] = [
  { term: "HQ (High Quality)", meaning: "Akun berkualitas lebih baik — biasanya berfoto profil dan punya aktivitas. Umumnya lebih stabil, tetapi bukan jaminan tidak akan turun." },
  { term: "Akun Real", meaning: "Akun yang menyerupai pengguna asli menurut supplier. Tetap klaim layanan, bukan garansi mutlak." },
  { term: "Refill", meaning: "Pengisian ulang bila jumlah turun selama masa garansi (mis. 30 hari sejak pesanan selesai), sesuai ketentuan layanan." },
  { term: "Tanpa Refill", meaning: "Setelah pesanan selesai, jumlah yang turun tidak diisi ulang. Harganya biasanya lebih murah." },
  { term: "Drop", meaning: "Penurunan jumlah followers/likes/views setelah pengiriman selesai. Semua layanan berpotensi drop; yang membedakan seberapa besar risikonya." },
  { term: "Risiko Drop", meaning: "Perkiraan AXVARA: rendah = diklaim stabil/non-drop, sedang = umum, tinggi = murah tetapi rawan turun. Bukan angka pasti." },
  { term: "Mulai / Start", meaning: "Waktu tunggu sebelum pengiriman mulai berjalan setelah pembayaran terkonfirmasi (mis. ±5 menit, ±1 jam)." },
  { term: "Kecepatan", meaning: "Perkiraan jumlah yang dikirim per hari. Pengiriman bertahap biasanya terlihat lebih alami." },
  { term: "Harga per 1.000", meaning: "Harga untuk setiap 1.000 unit. Total = harga per 1.000 × jumlah ÷ 1.000, lalu dibulatkan — dikonfirmasi server sebelum bayar." },
  { term: "Min. / Maks.", meaning: "Jumlah terkecil dan terbesar yang bisa dipesan dalam satu pesanan untuk layanan itu." },
];

export function PediaGlossary() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left"
      >
        <span className="text-sm font-semibold text-white">Panduan istilah</span>
        <span aria-hidden className={`text-white/50 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <dl className="space-y-3 border-t border-white/10 px-4 py-4">
          {TERMS.map((t) => (
            <div key={t.term}>
              <dt className="text-[13px] font-semibold text-white">{t.term}</dt>
              <dd className="mt-0.5 text-[13px] leading-5 text-white/60">{t.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
