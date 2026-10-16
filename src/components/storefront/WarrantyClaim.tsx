import { marketWarrantyClaim } from "@/lib/warranty-policy";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";

/** Salinan yang sama untuk pesanan Market dan halaman ketentuan publik. */
export function WarrantyClaimBody() {
  return (
    <div className="space-y-3 text-sm leading-6 text-white/60">
      <p>{marketWarrantyClaim.eligibility}</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        {marketWarrantyClaim.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
      </ol>
      <p className="font-semibold text-white/80">Catatan:</p>
      <ul className="list-disc space-y-2 pl-5">
        {marketWarrantyClaim.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      <p>{marketWarrantyClaim.closing}</p>
    </div>
  );
}

export function WarrantyClaimAccordion({ className = "mt-6 text-left" }: { className?: string }) {
  return (
    <div className={className}>
      <MobileCollapsible title="Syarat klaim garansi">
        <WarrantyClaimBody />
      </MobileCollapsible>
    </div>
  );
}
