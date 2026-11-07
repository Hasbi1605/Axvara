"use client";

import Link from "next/link";
import { StoreWhatsAppLink } from "@/components/storefront/StoreWhatsAppLink";
import { WarrantyClaimBody } from "@/components/storefront/WarrantyClaim";
import { marketWarrantyClaim, marketWarrantyClaimEn } from "@/lib/warranty-policy";
import { useDisplayLocale } from "@/hooks/useDisplayPrices";

const ID_COPY = {
  eyebrow: "Bantuan • Wajib dibaca sebelum beli",
  title: "Ketentuan layanan & garansi",
  lead: "AXVARA adalah penyedia layanan third-party independen. Halaman ini adalah acuan utama garansi dan klaim di AXVARA.",
  thirdTitle: "AXVARA adalah third-party, bukan official store",
  third: [
    <>AXVARA sama sekali <span className="text-white font-medium">tidak terafiliasi, tidak bekerja sama, dan tidak didukung oleh</span> perusahaan / brand manapun yang produknya tercantum di katalog kami (contoh: Netflix, Spotify, Apple, Google, dan lainnya).</>,
    <>Semua produk diperoleh melalui jalur third-party, sehingga harganya bisa <span className="text-white font-medium">jauh lebih murah dari harga resmi / official</span>.</>,
    <>Karena itu kami <span className="text-white font-medium">tidak dapat memberikan garansi 100% permanen</span> seperti pembelian resmi. Sewaktu-waktu dapat terjadi perubahan sistem, kebijakan, atau penertiban dari pihak perusahaan resmi yang menyebabkan produk terdampak (error, logout, limit, metode tidak berfungsi, dan sejenisnya). Hal ini <span className="text-white font-medium">di luar kendali kami</span>.</>,
  ],
  warrantyTitle: "Garansi tetap ada, tapi bervariasi",
  warranty: [
    <>Garansi AXVARA bersifat <span className="text-white font-medium">terbatas dan bervariasi, mulai dari 1x24 jam hingga 30 hari tergantung produk</span>. Masa garansi dan jenis garansi sangat mempengaruhi harga — semakin panjang garansi, semakin tinggi harga.</>,
    <>Silakan <span className="text-white font-medium">pilih produk sesuai budget dan kebutuhan garansimu</span>. Baca deskripsi serta Syarat &amp; Ketentuan produk dengan teliti sebelum membeli.</>,
  ],
  agree: "Dengan membeli di AXVARA, kamu dianggap telah memahami dan menyetujui bahwa:",
  agreeList: ["Kamu membeli produk third-party dengan segala risikonya.", <>Selalu <span className="text-white font-medium">DYOR — Do Your Own Research &amp; DWYOR — Do With Your Own Risk</span>.</>, <>Klaim garansi hanya berlaku <span className="text-white font-medium">sesuai Syarat &amp; Ketentuan di halaman produk masing-masing</span>, bukan garansi uang kembali otomatis.</>],
  thanks: "Terima kasih atas pengertianmu.",
  prepareTitle: "Yang perlu disiapkan",
  prepare: ["Invoice atau bukti pemesanan (kode pesanan AXV)", "Nama produk yang bermasalah", "Screenshot kendala yang terjadi"],
  checkTitle: "Proses pemeriksaan",
  check: (note: string) => <>Admin memverifikasi pesanan dan penyebab kendala. Jika memenuhi Syarat &amp; Ketentuan produk, akses akan diperbaiki atau diganti. {note}</>,
  periodTitle: "Masa garansi",
  period: ["Masa dan cakupan garansi mengikuti Syarat &amp; Ketentuan masing-masing produk. Terhitung sejak produk dikirim. Lewat masa aktif = hangus.", <>Untuk produk <span className="text-white font-medium">Made By Order</span> (ditandai di halaman produk), masa garansi mulai berjalan saat detail akun diserahkan ke kamu — <span className="text-white font-medium">bukan</span> saat pembayaran. Waktu tunggu antrean tidak memotong masa garansi.</>],
  claimTitle: "Syarat klaim garansi",
  extraTitle: "Ketentuan tambahan",
  extra: [
    "Garansi berupa penggantian produk / perbaikan, dengan solusi refund bila gangguan masih terjadi setelah maksimal 3 hari sesuai catatan di atas.",
    <>Klaim hanya selama <span className="text-white font-medium">masa garansi aktif</span> sesuai Syarat &amp; Ketentuan produk, terhitung sejak produk dikirim.</>,
    <>Garansi <span className="text-white font-medium">HANGUS</span> jika: password / email diganti tanpa izin, login di banyak device / IP bersamaan, melanggar aturan pakai di Syarat &amp; Ketentuan produk, akun kena suspend karena pelanggaran user, atau order sudah dikonfirmasi selesai.</>,
    "Satu order = satu kali klaim penggantian, kecuali produk bergaransi 30 hari (maksimal 2–3x ganti, lihat Syarat &amp; Ketentuan produk).",
  ],
  warning: "Jangan kirim password melalui form publik. Sampaikan data sensitif hanya melalui percakapan langsung dengan admin setelah kode pesanan diverifikasi.",
  claim: "Ajukan klaim",
  how: "Lihat cara order",
  wa: "saya ingin mengajukan garansi/replace. Kode pesanan saya: ",
};
const EN_COPY: typeof ID_COPY = {
  eyebrow: "Help • Read before buying",
  title: "Service terms & warranty",
  lead: "AXVARA is an independent third-party service. This page is the main reference for warranty and claims at AXVARA.",
  thirdTitle: "AXVARA is third-party, not an official store",
  third: [
    <>AXVARA is <span className="text-white font-medium">not affiliated with, partnered with, or endorsed by</span> any company or brand listed in our catalog (e.g. Netflix, Spotify, Apple, Google, and others).</>,
    <>All products are obtained through third-party channels, so prices can be <span className="text-white font-medium">much lower than official pricing</span>.</>,
    <>Therefore we <span className="text-white font-medium">cannot provide a permanent 100% warranty</span> like an official purchase. The official provider may change its systems, policies, or enforcement at any time, affecting the product (errors, logout, limits, methods not working, etc.). This is <span className="text-white font-medium">outside our control</span>.</>,
  ],
  warrantyTitle: "Warranty still exists, but varies",
  warranty: [
    <>AXVARA warranty is <span className="text-white font-medium">limited and varies from 1x24 hours to 30 days depending on the product</span>. Warranty length and type strongly affect the price — longer warranty means a higher price.</>,
    <>Please <span className="text-white font-medium">choose products that fit your budget and warranty needs</span>. Read the product description and Terms &amp; Conditions carefully before buying.</>,
  ],
  agree: "By buying at AXVARA, you are deemed to understand and agree that:",
  agreeList: ["You are buying a third-party product with all its risks.", <>Always <span className="text-white font-medium">DYOR — Do Your Own Research &amp; DWYOR — Do With Your Own Risk</span>.</>, <>Warranty claims only apply <span className="text-white font-medium">under the Terms &amp; Conditions on each product page</span>, not as an automatic money-back guarantee.</>],
  thanks: "Thank you for your understanding.",
  prepareTitle: "What to prepare",
  prepare: ["Invoice or order proof (AXV order code)", "The name of the affected product", "A screenshot of the issue"],
  checkTitle: "Review process",
  check: (note: string) => <>The admin verifies the order and the cause of the issue. If it meets the product Terms &amp; Conditions, access will be repaired or replaced. {note}</>,
  periodTitle: "Warranty period",
  period: ["The warranty period and coverage follow each product's Terms &amp; Conditions. It starts when the product is delivered. Past the active period = expired.", <>For <span className="text-white font-medium">Made By Order</span> products (marked on the product page), the warranty starts when the account details are handed to you — <span className="text-white font-medium">not</span> when payment is made. Queue waiting time does not reduce the warranty.</>],
  claimTitle: "Warranty claim terms",
  extraTitle: "Additional terms",
  extra: [
    "Warranty is a product replacement / repair, with a refund solution if the issue still persists after a maximum of 3 days according to the notes above.",
    <>Claims are only valid during the <span className="text-white font-medium">active warranty period</span> under the product Terms &amp; Conditions, counted from delivery.</>,
    <>Warranty is <span className="text-white font-medium">VOID</span> if: the password/email is changed without permission, the account is logged in on many devices/IPs at once, the usage rules in the product description are violated, the account is suspended due to user violation, or the order is already confirmed complete.</>,
    "One order = one replacement claim, except 30-day warranty products (maximum 2–3 replacements, see the product Terms &amp; Conditions).",
  ],
  warning: "Do not send passwords through public forms. Share sensitive data only in a direct conversation with the admin after the order code is verified.",
  claim: "Submit a claim",
  how: "How to order",
  wa: "I would like to submit a warranty/replace claim. My order code: ",
};

export default function GaransiReplacePage() {
  const locale = useDisplayLocale();
  const t = locale === "en" ? EN_COPY : ID_COPY;
  const claim = locale === "en" ? marketWarrantyClaimEn : marketWarrantyClaim;
  return <main className="mx-auto max-w-[920px] px-4 py-10 sm:px-6 sm:py-14">
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#00E5FF]/75">{t.eyebrow}</p>
    <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">{t.title}</h1>
    <p className="mt-3 max-w-[68ch] text-sm leading-6 text-white/55">{t.lead}</p>

    <section className="mt-8 rounded-[22px] ax-glass-card p-5 sm:p-6">
      <h2 className="font-semibold text-white">{t.thirdTitle}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/55">
        {t.third.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
    </section>

    <section className="mt-4 rounded-[22px] ax-glass-card p-5 sm:p-6">
      <h2 className="font-semibold text-white">{t.warrantyTitle}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-white/55">
        {t.warranty.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <p>{t.agree}</p>
        <ol className="list-decimal pl-5 space-y-1.5">
          {t.agreeList.map((item, index) => <li key={index}>{item}</li>)}
        </ol>
        <p>{t.thanks}</p>
      </div>
    </section>

    <div className="mt-4 grid gap-4 lg:grid-cols-3">
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">{t.prepareTitle}</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-white/55">{t.prepare.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">{t.checkTitle}</h2><p className="mt-3 text-sm leading-6 text-white/55">{t.check(claim.notes[0])}</p></section>
      <section className="rounded-[22px] ax-glass-card p-5"><h2 className="font-semibold text-white">{t.periodTitle}</h2>{t.period.map((paragraph, index) => <p key={index} className="mt-3 text-sm leading-6 text-white/55">{paragraph}</p>)}</section>
    </div>

    <section className="mt-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <h2 className="font-semibold text-white">{t.claimTitle}</h2>
      <div className="mt-3"><WarrantyClaimBody locale={locale} /></div>
      <h3 className="mt-5 text-sm font-semibold text-white">{t.extraTitle}</h3>
      <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-sm leading-6 text-white/60">
        {t.extra.map((item, index) => <li key={index}>{item}</li>)}
      </ol>
    </section>

    <div className="mt-6 rounded-[20px] border border-[#FFB800]/20 bg-[#FFB800]/[0.06] p-4 text-sm leading-6 text-white/60">{t.warning}</div>
    <div className="mt-8 flex flex-wrap gap-3"><StoreWhatsAppLink message={t.wa} className="inline-flex h-11 items-center rounded-full bg-white px-6 text-sm font-bold text-[#080C1E]">{t.claim}</StoreWhatsAppLink><Link prefetch={false} href="/cara-order" className="inline-flex h-11 items-center rounded-full border border-white/10 bg-white/[0.06] px-6 text-sm font-semibold text-white">{t.how}</Link></div>
  </main>;
}
