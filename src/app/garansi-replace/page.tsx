import Link from "next/link";
import { adminWaLink } from "@/lib/site";

export const metadata = { title: "Ketentuan Layanan & Garansi | AXVARA", description: "AXVARA adalah third-party independen. Pahami ketentuan garansi 1x24 jam–30 hari sebelum membeli." };

export default function GaransiReplacePage() {
  return <main className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">Bantuan • Wajib dibaca sebelum beli</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">Ketentuan layanan & garansi</h1>
    <p className="mt-3 max-w-[68ch] text-sm leading-6 text-white/55">AXVARA adalah penyedia layanan third-party independen. Halaman ini adalah acuan utama garansi dan klaim di AXVARA.</p>

    <section className="mt-8 rounded-[22px] ax-glass-card p-5 sm:p-6">
      <h2 className="font-semibold text-white">AXVARA adalah third-party, bukan official store</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/55">
        <p>AXVARA sama sekali <span className="text-white font-medium">tidak terafiliasi, tidak bekerja sama, dan tidak didukung oleh</span> perusahaan / brand manapun yang produknya tercantum di katalog kami (contoh: Netflix, Spotify, Apple, Google, dan lainnya).</p>
        <p>Semua produk diperoleh melalui jalur third-party, sehingga harganya bisa <span className="text-white font-medium">jauh lebih murah dari harga resmi / official</span>.</p>
        <p>Karena itu kami <span className="text-white font-medium">tidak dapat memberikan garansi 100% permanen</span> seperti pembelian resmi. Sewaktu-waktu dapat terjadi perubahan sistem, kebijakan, atau penertiban dari pihak perusahaan resmi yang menyebabkan produk terdampak (error, logout, limit, metode tidak berfungsi, dan sejenisnya). Hal ini <span className="text-white font-medium">di luar kendali kami</span>.</p>
      </div>
    </section>

    <section className="mt-4 rounded-[22px] ax-glass-card p-5 sm:p-6">
      <h2 className="font-semibold text-white">Garansi tetap ada, tapi bervariasi</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/55">
        <p>Garansi AXVARA bersifat <span className="text-white font-medium">terbatas dan bervariasi, mulai dari 1x24 jam hingga 30 hari tergantung produk</span>. Masa garansi dan jenis garansi sangat mempengaruhi harga — semakin panjang garansi, semakin tinggi harga.</p>
        <p>Silakan <span className="text-white font-medium">pilih produk sesuai budget dan kebutuhan garansimu</span>. Baca deskripsi produk dengan teliti sebelum membeli.</p>
        <p>Dengan membeli di AXVARA, kamu dianggap telah memahami dan menyetujui bahwa:</p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>Kamu membeli produk third-party dengan segala risikonya.</li>
          <li>Selalu <span className="text-white font-medium">DYOR — Do Your Own Research & DWYOR — Do With Your Own Risk</span>.</li>
          <li>Klaim garansi hanya berlaku <span className="text-white font-medium">sesuai ketentuan di deskripsi produk masing-masing</span>, bukan garansi uang kembali otomatis.</li>
        </ol>
        <p>Terima kasih atas pengertianmu.</p>
      </div>
    </section>

    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Yang perlu disiapkan</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-white/55"><li>Kode pesanan AXV</li><li>Nama produk yang bermasalah</li><li>Video / screenshot error yang jelas</li></ul></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Proses pemeriksaan</h2><p className="mt-3 text-sm leading-6 text-white/55">Admin memverifikasi pesanan dan penyebab kendala. Jika memenuhi ketentuan di deskripsi produk, akses akan diperbaiki atau diganti dalam 1x24 jam kerja.</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">Masa garansi</h2><p className="mt-3 text-sm leading-6 text-white/55">Masa dan cakupan garansi mengikuti keterangan di deskripsi masing-masing produk. Terhitung sejak produk dikirim. Lewat masa aktif = hangus.</p></section>
    </div>

    <section className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <h2 className="font-semibold text-white">Syarat klaim garansi</h2>
      <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-sm leading-6 text-white/60">
        <li>Garansi berupa <span className="text-white font-medium">penggantian produk / perbaikan, BUKAN refund dana</span>. Refund hanya jika stok pengganti kosong dan disetujui admin.</li>
        <li>Wajib sertakan <span className="text-white font-medium">bukti video / screenshot error + kode pesanan / invoice</span>. Tanpa bukti = klaim ditolak.</li>
        <li>Klaim hanya selama <span className="text-white font-medium">masa garansi aktif</span> sesuai deskripsi produk, terhitung sejak produk dikirim.</li>
        <li>Garansi <span className="text-white font-medium">HANGUS</span> jika: password / email diganti tanpa izin, login di banyak device / IP bersamaan, melanggar aturan pakai di deskripsi, akun kena suspend karena pelanggaran user, atau order sudah dikonfirmasi selesai.</li>
        <li>Durasi proses penggantian <span className="text-white font-medium">1x24 jam kerja</span>, bukan instan. Harap antre.</li>
        <li>Satu order = satu kali klaim penggantian, kecuali produk bergaransi 30 hari (maksimal 2–3x ganti, lihat deskripsi produk).</li>
      </ol>
    </section>

    <div className="mt-6 rounded-[20px] border border-[#FFB800]/20 bg-[#FFB800]/[0.06] p-4 text-sm leading-6 text-white/60">Jangan kirim password melalui form publik. Sampaikan data sensitif hanya melalui percakapan langsung dengan admin setelah kode pesanan diverifikasi.</div>
    <div className="mt-8 flex flex-wrap gap-3"><a href={adminWaLink("Halo AXVARA, saya ingin mengajukan garansi/replace. Kode pesanan saya: ")} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">Ajukan klaim</a><Link href="/cara-order" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">Lihat cara order</Link></div>
  </main>;
}
