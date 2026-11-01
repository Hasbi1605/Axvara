import type { Metadata } from "next";
import { IosIcon } from "@/components/ui/IosIcon";
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { PEDIA_HELP_GROUPS, PEDIA_ORDER_STEPS } from "@/lib/pedia/help-content";

export const runtime = "edge";

// src/app/pedia/bantuan/page.tsx — Bantuan Pedia (PD-14).
// 2026-11-01 (owner): disamakan dengan "Cara order" Market — label kecil, judul,
// pengantar, kartu glass bernomor, FAQ accordion gaya Lacak, deret tombol.
export const metadata: Metadata = {
  title: "Bantuan & cara order",
  description: "Cara memesan layanan AXVARA Pedia dan jawaban pertanyaan yang sering ditanyakan.",
  alternates: { canonical: "/bantuan" },
};

export default function PediaHelpPage() {
  return <div className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">Bantuan Pedia</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">Bantuan</h1>
    <p className="mt-3 max-w-[62ch] text-sm leading-6 text-white/55">Cara memesan layanan Pedia dan jawaban untuk pertanyaan yang sering ditanyakan. Tanpa login dan tanpa membuat akun.</p>

    <section id="cara-order" aria-labelledby="pedia-cara-order" className="mt-8 scroll-mt-24">
      <h2 id="pedia-cara-order" className="text-lg font-semibold text-white">Cara order</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{PEDIA_ORDER_STEPS.map(([number, title, body]) => <section key={number} className="rounded-[22px] ax-glass-card p-5 sm:p-6"><span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00E5FF]/[0.12] text-sm font-bold text-[#00E5FF]">{number}</span><h3 className="mt-4 text-base font-semibold text-white"><span className="sr-only">Langkah {number}: </span>{title}</h3><p className="mt-2 text-sm leading-6 text-white/55">{body}</p></section>)}</div>
    </section>

    {PEDIA_HELP_GROUPS.map((group) => <section key={group.title} aria-label={group.title} className="mt-8">
      <h2 className="text-lg font-semibold text-white">{group.title}</h2>
      <div className="mt-3 space-y-2">{group.items.map(([question, answer]) => <details key={question} className="ax-glass-card rounded-2xl px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-semibold text-white [&::-webkit-details-marker]:hidden"><span className="flex min-h-6 items-center justify-between gap-3">{question}<span aria-hidden="true" className="shrink-0"><IosIcon name="chevron" size={14} tint="white" /></span></span></summary>
        <p className="mt-3 text-[13px] leading-6 text-white/60">{answer}</p>
      </details>)}</div>
    </section>)}

    <div className="mt-8 flex flex-wrap gap-3">
      <a href="/pedia/layanan" className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">Lihat layanan</a>
      <a href="/pedia/lacak" className="inline-flex h-11 items-center rounded-full bg-[#00E5FF] px-6 text-sm font-bold text-[#080C1E]">Lacak pesanan</a>
      <PediaWhatsAppLink message="saya perlu bantuan pesanan Pedia." className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">Tanya admin</PediaWhatsAppLink>
    </div>
  </div>;
}
