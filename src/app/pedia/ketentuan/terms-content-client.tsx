"use client";

// src/app/pedia/ketentuan/terms-content-client.tsx — isi S&K Pedia (2026-11-07).
// Dipisah dari page.tsx agar metadata tetap statis; bahasa mengikuti cookie axv_locale.
import { PediaWhatsAppLink } from "@/components/pedia/PediaWhatsAppLink";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";
import { pediaCopy } from "@/lib/pedia/copy";

const strong = "font-medium text-white";
const card = "rounded-[22px] ax-glass-card p-5 sm:p-6";
const body = "mt-3 space-y-2.5 text-sm leading-6 text-white/55";

/** Isi ketentuan ID/EN: kunci, urutan, dan kebijakan sama persis. */
const CONTENT = {
  id: {
    aboutTitle: "Tentang layanan",
    about: [
      <>Layanan meningkatkan angka interaksi. AXVARA <span className={strong}>tidak menjamin jangkauan, penjualan, atau FYP</span>.</>,
      <>Penggunaan layanan dapat bertentangan dengan ketentuan platform media sosial; <span className={strong}>risiko akun sepenuhnya pada pembeli</span>.</>,
    ],
    targetTitle: "Syarat target",
    target: [
      <>Akun atau postingan <span className={strong}>wajib publik</span> dan tidak boleh diganti username atau dihapus selama proses. Kendala akibat perubahan target diperiksa admin sesuai fakta pengiriman.</>,
      <>Salah memasukkan link yang tetap valid, misalnya akun orang lain, <span className={strong}>bukan tanggung jawab AXVARA</span>.</>,
    ],
    refillTitle: "Refill & garansi",
    refillBody: <>Penurunan jumlah (drop) dapat terjadi. Layanan dengan Refill (mis. Refill 30 Days) berhak refill selama masa refill lewat <a href="/pedia/refill" className="font-medium text-[#00E5FF] underline underline-offset-4">halaman Refill</a> atau tombol <span className={strong}>Ajukan Refill</span> di halaman pesanan; layanan No Refill tidak. Label No Drop, Less Drop dan High Drop adalah estimasi, bukan jaminan. Masa dan syaratnya mengikuti layanan yang dipilih.</>,
    partialTitle: "Pesanan sebagian atau dibatalkan",
    partialBody: "Pesanan yang selesai sebagian atau dibatalkan sistem ditangani admin secara manual. Hubungi admin dengan kode pesanan. Tidak ada saldo pembeli, kode kredit, atau refund otomatis di website.",
    prepTitle: "Yang perlu disiapkan",
    prep: ["Kode pesanan (AXP-…)", "Link target pesanan", "Screenshot kendala yang terjadi"],
    bannedTitle: "Konten yang dilarang",
    bannedBody: <>Layanan tidak boleh dipakai untuk konten yang melanggar hukum, judi, penipuan, politik praktis atau kampanye, maupun pelecehan. Pesanan semacam itu <span className={strong}>ditolak atau ditangani admin</span> sesuai kondisi transaksi.</>,
    warning: "Pedia hanya membutuhkan link publik. Jangan berikan password akun media sosialmu kepada siapa pun, termasuk yang mengaku admin.",
  },
  en: {
    aboutTitle: "About the service",
    about: [
      <>The service increases engagement numbers. AXVARA <span className={strong}>does not guarantee reach, sales, or FYP</span>.</>,
      <>Using the service may conflict with social media platform terms; <span className={strong}>account risk is entirely the buyer&apos;s</span>.</>,
    ],
    targetTitle: "Target requirements",
    target: [
      <>The account or post <span className={strong}>must be public</span> and the username or post must not be changed or deleted during processing. Issues caused by target changes are checked by admin against the delivery facts.</>,
      <>Entering the wrong but still valid link, for example someone else&apos;s account, <span className={strong}>is not AXVARA&apos;s responsibility</span>.</>,
    ],
    refillTitle: "Refill & warranty",
    refillBody: <>Decreases (drop) can happen. Services with Refill (e.g. Refill 30 Days) qualify for a refill during the refill period via the <a href="/pedia/refill" className="font-medium text-[#00E5FF] underline underline-offset-4">Refill page</a> or the <span className={strong}>Request Refill</span> button on the order page; No Refill services do not. No Drop, Less Drop, and High Drop labels are estimates, not guarantees. The period and conditions follow the selected service.</>,
    partialTitle: "Partially completed or canceled orders",
    partialBody: "Orders that are partially completed or canceled by the system are handled manually by admin. Contact admin with the order code. There is no buyer balance, credit code, or automatic refund on the website.",
    prepTitle: "What to prepare",
    prep: ["Order code (AXP-…)", "Order target link", "Screenshot of the issue"],
    bannedTitle: "Prohibited content",
    bannedBody: <>The service must not be used for illegal content, gambling, fraud, practical politics or campaigns, or harassment. Such orders <span className={strong}>are rejected or handled by admin</span> according to the transaction state.</>,
    warning: "Pedia only needs a public link. Never give your social media account password to anyone, including anyone claiming to be an admin.",
  },
} as const;

export function PediaTermsContent() {
  const locale = useDisplayLocale();
  const t = pediaCopy(locale);
  const c = CONTENT[locale === "en" ? "en" : "id"];
  return <div className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">{t.termsKicker}</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">{t.termsTitle}</h1>
    <p className="mt-3 max-w-[68ch] text-sm leading-6 text-white/55">{t.termsIntro}</p>

    <section className={`mt-8 ${card}`}>
      <h2 className="font-semibold text-white">{c.aboutTitle}</h2>
      <ul className={`${body} list-disc pl-5`}>
        {c.about.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
    </section>

    <section className={`mt-4 ${card}`}>
      <h2 className="font-semibold text-white">{c.targetTitle}</h2>
      <ul className={`${body} list-disc pl-5`}>
        {c.target.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
    </section>

    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">{c.refillTitle}</h2><p className="mt-3 text-sm leading-6 text-white/55">{c.refillBody}</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">{c.partialTitle}</h2><p className="mt-3 text-sm leading-6 text-white/55">{c.partialBody}</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">{c.prepTitle}</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-white/55">{c.prep.map((line) => <li key={line}>{line}</li>)}</ul></section>
    </div>

    <section className={`mt-4 ${card}`}>
      <h2 className="font-semibold text-white">{c.bannedTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-white/55">{c.bannedBody}</p>
    </section>

    <div className="mt-6 rounded-[20px] border border-[#FFB800]/20 bg-[#FFB800]/[0.06] p-4 text-sm leading-6 text-white/60">{c.warning}</div>

    <div className="mt-8 flex flex-wrap gap-3">
      <PediaWhatsAppLink message={t.termsAskMessage} className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">{t.termsCtaAdmin}</PediaWhatsAppLink>
      <a href="/pedia/lacak" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">{t.termsCtaTrack}</a>
      <a href="/pedia/bantuan#cara-order" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">{t.termsCtaHow}</a>
    </div>
  </div>;
}
