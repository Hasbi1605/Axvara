import { marketWarrantyClaim, marketWarrantyClaimEn } from "@/lib/warranty-policy";
import type { Locale } from "@/lib/i18n/locale";
import { orderCopy } from "@/lib/i18n/order-copy";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";

/** Salinan yang sama untuk pesanan Market dan halaman ketentuan publik. */
export function WarrantyClaimBody({ size = "sm", locale = "id" }: { size?: "sm" | "xs"; locale?: Locale }) {
  const claim = locale === "en" ? marketWarrantyClaimEn : marketWarrantyClaim;
  const t = orderCopy(locale);
  return (
    <div className={`space-y-3 text-white/60 ${size === "xs" ? "text-xs leading-relaxed" : "text-sm leading-6"}`}>
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

export function WarrantyClaimAccordion({ className = "mt-6 text-left", locale = "id" }: { className?: string; locale?: Locale }) {
  return (
    <div className={className}>
      <MobileCollapsible title={orderCopy(locale).warranty.title}>
        <WarrantyClaimBody size="xs" locale={locale} />
      </MobileCollapsible>
    </div>
  );
}
