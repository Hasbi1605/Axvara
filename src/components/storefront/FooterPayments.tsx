import type { Locale } from "@/lib/i18n/locale";

/**
 * Baris "Metode pembayaran" di footer bersama Market/Pedia/Games (14 Nov 2026,
 * permintaan owner). Logo lokal yang sama dengan picker checkout
 * (`public/payments`, `public/brand/qris.svg`), dikelompokkan per rail yang
 * dibuka publik: QRIS, e-wallet & Virtual Account (Sekalipay gateway), crypto
 * (NOWPayments). Dekoratif — ketersediaan kanal per order tetap ditentukan
 * server saat checkout.
 */
const GROUPS: ReadonlyArray<{ id: string; label: { id: string; en: string }; logos: ReadonlyArray<{ name: string; src: string; darken?: boolean }> }> = [
  { id: "qris", label: { id: "QRIS", en: "QRIS" }, logos: [{ name: "QRIS", src: "/brand/qris.svg", darken: true }] },
  { id: "ewallet", label: { id: "E-wallet", en: "E-wallet" }, logos: [
    { name: "GoPay", src: "/payments/gopay.svg" }, { name: "DANA", src: "/payments/dana.svg" }, { name: "OVO", src: "/payments/ovo.svg" },
    { name: "ShopeePay", src: "/payments/shopeepay.svg" }, { name: "LinkAja", src: "/payments/linkaja.svg" },
  ] },
  { id: "va", label: { id: "Virtual Account", en: "Virtual Account" }, logos: [
    { name: "BCA", src: "/payments/bca.svg" }, { name: "BNI", src: "/payments/bni.svg" }, { name: "BRI", src: "/payments/bri.svg" },
    { name: "Mandiri", src: "/payments/mandiri.svg" }, { name: "Permata", src: "/payments/permata.svg" },
  ] },
  { id: "crypto", label: { id: "Crypto", en: "Crypto" }, logos: [
    { name: "USDT", src: "/payments/usdt.png" }, { name: "Bitcoin", src: "/payments/coins/btc.svg" }, { name: "Ethereum", src: "/payments/coins/eth.svg" },
  ] },
];

export function FooterPayments({ locale }: { locale: Locale }) {
  const en = locale === "en";
  return <section data-footer-payments aria-label={en ? "Payment methods" : "Metode pembayaran"} className="mt-10 border-t border-white/10 pt-6">
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">{en ? "Payment methods" : "Metode pembayaran"}</p>
    <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
      {GROUPS.map((group) => <li key={group.id} className="flex items-center gap-2">
        <span className="sr-only">{en ? group.label.en : group.label.id}: </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {group.logos.map((logo) => <span key={logo.name} title={logo.name} className="flex h-7 w-[52px] items-center justify-center rounded-md bg-white px-1 opacity-90 shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-opacity hover:opacity-100 sm:h-8 sm:w-[58px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.src} alt={logo.name} loading="lazy" decoding="async" className={`max-h-[18px] max-w-full object-contain sm:max-h-5 ${logo.darken ? "brightness-0" : ""}`} />
          </span>)}
        </span>
      </li>)}
    </ul>
  </section>;
}
