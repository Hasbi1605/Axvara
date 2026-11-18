import { BuyerEstimate } from "@/components/refund/BuyerEstimate";
import { MARKET_INVOICE } from "@/lib/refund/calculate";
import { marketWarrantyClaim, marketWarrantyClaimEn } from "@/lib/warranty-policy";
import type { Locale } from "@/lib/i18n/locale";
import { orderCopy } from "@/lib/i18n/order-copy";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";

/** Accordion pesanan ringkas; halaman ketentuan publik memuat aturan lengkap. */
export function WarrantyClaimBody({ size = "sm", locale = "id" }: { size?: "sm" | "xs"; locale?: Locale }) {
  const claim = locale === "en" ? marketWarrantyClaimEn : marketWarrantyClaim;
  const t = orderCopy(locale);
  const en = locale === "en";
  if (size === "xs") return <div className="space-y-2 text-xs leading-relaxed text-white/75">
    <p>{en ? "While under warranty, send your invoice and a screenshot of the issue." : "Selama garansi berlaku, kirim invoice dan screenshot kendala."}</p>
    <p>{en ? "If we can’t resolve it within 3 days, refund is based on unused time when your eligible report arrived." : "Jika belum teratasi dalam 3 hari, refund mengikuti nilai sisa masa aktif saat laporan yang memenuhi syarat diterima."}</p>
    <p>{en ? "Example: Rp30,000 / 30 days, 20 left → Rp20,000." : "Contoh: Rp30.000 / 30 hari, sisa 20 hari → Rp20.000."}</p>
  </div>;
  return (
    <div className="space-y-3 text-white/60 text-sm leading-6">
      <p>{claim.eligibility}</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        {claim.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
      </ol>
      <p className="font-semibold text-white/80">{t.warranty.note}</p>
      <ul className="list-disc space-y-2 pl-5">
        {claim.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      <p>{claim.closing}</p>
    </div>
  );
}

export function WarrantyClaimAccordion({ className = "mt-6 text-left", locale = "id", code, contact, adminView }: { className?: string; locale?: Locale; code?: string; contact?: string; adminView?: boolean }) {
  return (
    <div className={className}>
      <MobileCollapsible title={orderCopy(locale).warranty.title}>
        <WarrantyClaimBody size="xs" locale={locale} />
        {code && MARKET_INVOICE.test(code) && <BuyerEstimate key={code} code={code} contact={contact} adminView={adminView} locale={locale} />}
      </MobileCollapsible>
    </div>
  );
}
