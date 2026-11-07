"use client";

import Link from "next/link";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

const ID_COPY = {
  eyebrow: "Bantuan",
  title: "Cara order",
  lead: "Proses pemesanan dibuat singkat. Kamu tidak perlu membuat akun untuk melakukan checkout.",
  steps: [
    ["1", "Pilih produk", "Buka katalog, pilih produk yang dibutuhkan, lalu tekan Beli Langsung atau masukkan ke keranjang."],
    ["2", "Isi data pembeli", "Masukkan nama, nomor WhatsApp aktif, dan email bila diperlukan. Pastikan datanya benar sebelum melanjutkan."],
    ["3", "Bayar via QRIS", "Pilih QRIS, scan kode yang muncul di halaman pesanan, dan bayar tepat sesuai nominal. Status lunas terdeteksi otomatis."],
    ["4", "Tunggu & lacak status", "Simpan kode pesanan, lalu pantau statusnya di halaman Lacak Pesanan — cukup kode + nomor WA, tanpa login. Admin memeriksa pembayaran dan mengirim detail akses melalui WhatsApp."],
  ],
  catalog: "Lihat katalog",
  track: "Lacak pesanan",
  ask: "Tanya admin",
  wa: "saya perlu bantuan cara order.",
};
const EN_COPY: typeof ID_COPY = {
  eyebrow: "Help",
  title: "How to order",
  lead: "Checkout is short. You do not need to create an account to place an order.",
  steps: [
    ["1", "Choose a product", "Open the catalog, pick the product you need, then press Buy Now or add it to the cart."],
    ["2", "Enter buyer details", "Fill in your name, an active WhatsApp number, and email when required. Make sure they are correct before continuing."],
    ["3", "Pay with QRIS", "Select QRIS, scan the code shown on the order page, and pay exactly the total. Paid status is detected automatically."],
    ["4", "Wait & track status", "Keep the order code and track it on the Track Order page — just the code + WhatsApp number, no login. The admin verifies payment and sends access details via WhatsApp."],
  ],
  catalog: "View catalog",
  track: "Track order",
  ask: "Ask admin",
  wa: "I need help with how to order.",
};

export default function CaraOrderPage() {
  const locale = useDisplayLocale();
  const t = locale === "en" ? EN_COPY : ID_COPY;
  return <main className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">{t.eyebrow}</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">{t.title}</h1>
    <p className="mt-3 max-w-[62ch] text-sm leading-6 text-white/55">{t.lead}</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2">{t.steps.map(([number, title, body]) => <section key={number} className="rounded-[22px] ax-glass-card p-5 sm:p-6"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00E5FF]/[0.12] text-sm font-bold text-[#00E5FF]">{number}</span><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-white/55">{body}</p></section>)}</div>
    <div className="mt-8 flex flex-wrap gap-3"><Link prefetch={false} href="/#katalog" className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">{t.catalog}</Link><Link prefetch={false} href="/lacak-pesanan" className="inline-flex h-11 items-center rounded-full bg-[#00E5FF] px-6 text-sm font-bold text-[#080C1E]">{t.track}</Link><StoreWhatsAppLink message={t.wa} className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">{t.ask}</StoreWhatsAppLink></div>
  </main>;
}
