import Link from "next/link";

// Statis (tanpa cookies/headers): halaman 404 dinamis membuat next-on-pages
// menuntut runtime edge di rute statis lain (/cara-order, /checkout, ...).
// Teks ID + EN sekaligus agar tetap dwibahasa tanpa membaca locale.
export default function NotFound() {
  return <div className="mx-auto max-w-xl px-4 py-20 text-center text-white">
    <p className="text-sm font-semibold tracking-widest text-[#00E5FF]">AXVARA · 404</p>
    <h1 className="mt-3 font-display text-3xl font-bold">Halaman tidak ditemukan</h1>
    <p className="mt-2 text-white/70" lang="en">Page not found</p>
    <Link href="/" prefetch={false} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[#00E5FF] px-5 font-semibold text-[#080C1E]">
      Kembali ke beranda <span className="sr-only" lang="en">(Back to home)</span>
    </Link>
  </div>;
}
