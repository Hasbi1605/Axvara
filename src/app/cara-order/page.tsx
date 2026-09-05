import Link from "next/link";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";

export const metadata = { title: "Cara Order | AXVARA", description: "Panduan memesan produk digital di AXVARA." };

const steps = [
  ["1", "Pilih produk", "Buka katalog, pilih produk yang dibutuhkan, lalu tekan Beli Langsung atau masukkan ke keranjang."],
  ["2", "Isi data pembeli", "Masukkan nama, nomor WhatsApp aktif, dan email bila diperlukan. Pastikan datanya benar sebelum melanjutkan."],
  ["3", "Bayar dan unggah bukti", "Pilih metode pembayaran yang tersedia, lakukan pembayaran sesuai detail di checkout, lalu unggah bukti transfer."],
  ["4", "Tunggu konfirmasi", "Simpan kode pesanan. Admin memeriksa pembayaran dan mengirim detail akses melalui WhatsApp."],
];

export default function CaraOrderPage() {
  return <main className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">Bantuan</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">Cara order</h1>
    <p className="mt-3 max-w-[62ch] text-sm leading-6 text-white/55">Proses pemesanan dibuat singkat. Kamu tidak perlu membuat akun untuk melakukan checkout.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-2">{steps.map(([number, title, body]) => <section key={number} className="rounded-[22px] ax-glass-card p-5 sm:p-6"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00E5FF]/[0.12] text-sm font-bold text-[#00E5FF]">{number}</span><h2 className="mt-4 text-base font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-white/55">{body}</p></section>)}</div>
    <div className="mt-8 flex flex-wrap gap-3"><Link href="/#katalog" className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">Lihat katalog</Link><StoreWhatsAppLink message="saya perlu bantuan cara order." className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">Tanya admin</StoreWhatsAppLink></div>
  </main>;
}
