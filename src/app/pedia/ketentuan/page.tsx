import type { Metadata } from "next";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";

export const runtime = "edge";

// src/app/pedia/ketentuan/page.tsx — S&K Pedia (PRD §11).
// 2026-11-01 (owner): struktur mengikuti "Ketentuan layanan & garansi" Market —
// label kecil, pengantar, kartu glass per topik, catatan amber, deret tombol.
// Isi ketujuh poin lama dipertahankan, hanya dikelompokkan per topik.
export const metadata: Metadata = {
  title: "Ketentuan layanan",
  description: "Ketentuan layanan AXVARA Pedia: syarat target, refill, pesanan sebagian, dan konten yang dilarang.",
  alternates: { canonical: "/ketentuan" },
};

const strong = "font-medium text-white";
const card = "rounded-[22px] ax-glass-card p-5 sm:p-6";
const body = "mt-3 space-y-2.5 text-sm leading-6 text-white/55";

export default function PediaTermsPage() {
  return <div className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">Bantuan • Wajib dibaca sebelum order</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">Ketentuan Pedia</h1>
    <p className="mt-3 max-w-[68ch] text-sm leading-6 text-white/55">AXVARA Pedia adalah penyedia layanan pihak ketiga yang tidak terafiliasi dengan platform media sosial mana pun. Dengan memesan, kamu dianggap memahami dan menyetujui ketentuan berikut.</p>

    <section className={`mt-8 ${card}`}>
      <h2 className="font-semibold text-white">Tentang layanan</h2>
      <ul className={`${body} list-disc pl-5`}>
        <li>Layanan meningkatkan angka interaksi. AXVARA <span className={strong}>tidak menjamin jangkauan, penjualan, atau FYP</span>.</li>
        <li>Penggunaan layanan dapat bertentangan dengan ketentuan platform media sosial; <span className={strong}>risiko akun sepenuhnya pada pembeli</span>.</li>
      </ul>
    </section>

    <section className={`mt-4 ${card}`}>
      <h2 className="font-semibold text-white">Syarat target</h2>
      <ul className={`${body} list-disc pl-5`}>
        <li>Akun atau postingan <span className={strong}>wajib publik</span> dan tidak boleh diganti username atau dihapus selama proses. Kendala akibat perubahan target diperiksa admin sesuai fakta pengiriman.</li>
        <li>Salah memasukkan link yang tetap valid, misalnya akun orang lain, <span className={strong}>bukan tanggung jawab AXVARA</span>.</li>
      </ul>
    </section>

    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Refill & garansi</h2><p className="mt-3 text-sm leading-6 text-white/55">Penurunan jumlah (drop) dapat terjadi. Layanan bergaransi berhak refill selama masa garansi lewat tombol <span className={strong}>Ajukan Refill</span> di halaman pesanan; layanan tanpa garansi tidak. Masa dan syaratnya mengikuti layanan yang dipilih.</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Pesanan sebagian atau dibatalkan</h2><p className="mt-3 text-sm leading-6 text-white/55">Pesanan yang selesai sebagian atau dibatalkan supplier ditangani admin secara manual. Hubungi admin dengan kode pesanan. Tidak ada saldo pembeli, kode kredit, atau refund otomatis di website.</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Yang perlu disiapkan</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-white/55"><li>Kode pesanan (AXP-…)</li><li>Link target pesanan</li><li>Screenshot kendala yang terjadi</li></ul></section>
    </div>

    <section className={`mt-4 ${card}`}>
      <h2 className="font-semibold text-white">Konten yang dilarang</h2>
      <p className="mt-3 text-sm leading-6 text-white/55">Layanan tidak boleh dipakai untuk konten yang melanggar hukum, judi, penipuan, politik praktis atau kampanye, maupun pelecehan. Pesanan semacam itu <span className={strong}>ditolak atau ditangani admin</span> sesuai kondisi transaksi.</p>
    </section>

    <div className="mt-6 rounded-[20px] border border-[#FFB800]/20 bg-[#FFB800]/[0.06] p-4 text-sm leading-6 text-white/60">Pedia hanya membutuhkan link publik. Jangan berikan password akun media sosialmu kepada siapa pun, termasuk yang mengaku admin.</div>

    <div className="mt-8 flex flex-wrap gap-3">
      <PediaWhatsAppLink message="saya ingin bertanya tentang pesanan Pedia. Kode pesanan saya: " className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">Tanya admin</PediaWhatsAppLink>
      <a href="/pedia/lacak" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">Lacak pesanan</a>
      <a href="/pedia/bantuan#cara-order" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">Lihat cara order</a>
    </div>
  </div>;
}
