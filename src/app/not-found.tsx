import Link from "next/link";
import { requestLocale } from "@/lib/i18n/server-locale";

export default async function NotFound() {
  const en = (await requestLocale()) === "en";
  return <div className="mx-auto max-w-xl px-4 py-20 text-center text-white">
    <p className="text-sm font-semibold tracking-widest text-[#00E5FF]">AXVARA · 404</p>
    <h1 className="mt-3 font-display text-3xl font-bold">{en ? "Page not found" : "Halaman tidak ditemukan"}</h1>
    <Link href="/" prefetch={false} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-[#00E5FF] px-5 font-semibold text-[#080C1E]">
      {en ? "Back to home" : "Kembali ke beranda"}
    </Link>
  </div>;
}
