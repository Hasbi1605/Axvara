import Link from "next/link";
import { adminWaLink } from "@/lib/site";

export const metadata = { title: "Garansi & Replace | AXVARA", description: "Panduan klaim garansi dan penggantian akses produk AXVARA." };

export default function GaransiReplacePage() {
  return <main className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">Bantuan</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">Garansi & replace</h1>
    <p className="mt-3 max-w-[64ch] text-sm leading-6 text-white/55">Jika akses bermasalah selama masa garansi produk, kirim laporan agar admin dapat memeriksa dan menentukan solusi yang sesuai.</p>
    <div className="mt-8 grid gap-4 lg:grid-cols-3">
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Yang perlu disiapkan</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-white/55"><li>Kode pesanan AXV</li><li>Nama produk yang bermasalah</li><li>Screenshot atau keterangan kendala</li></ul></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Proses pemeriksaan</h2><p className="mt-3 text-sm leading-6 text-white/55">Admin memverifikasi pesanan dan penyebab kendala. Jika memenuhi ketentuan produk, akses akan diperbaiki atau diganti.</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Ketentuan umum</h2><p className="mt-3 text-sm leading-6 text-white/55">Masa dan cakupan garansi mengikuti keterangan masing-masing produk. Kendala akibat perubahan data akses atau penggunaan di luar petunjuk perlu ditinjau lebih lanjut.</p></section>
    </div>
    <div className="mt-6 rounded-[20px] border border-[#FFB800]/20 bg-[#FFB800]/[0.06] p-4 text-sm leading-6 text-white/60">Jangan kirim password melalui form publik. Sampaikan data sensitif hanya melalui percakapan langsung dengan admin setelah kode pesanan diverifikasi.</div>
    <div className="mt-8 flex flex-wrap gap-3"><a href={adminWaLink("Halo AXVARA, saya ingin mengajukan garansi/replace. Kode pesanan saya: ")} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">Ajukan klaim</a><Link href="/cara-order" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">Lihat cara order</Link></div>
  </main>;
}
