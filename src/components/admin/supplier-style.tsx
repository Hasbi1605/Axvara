import type { Prod } from "./product-types";
import { Badge } from "./ui/badge";

/** Supplier identity only; availability and fulfillment keep their status tokens. */
export const SUPPLIER_STYLES = {
  WR: { label: "WR", fullName: "Warung Rebahan", className: "admin-supplier-wr" },
  SK: { label: "SK", fullName: "Sekalipay", className: "admin-supplier-sk" },
  TUNVN: { label: "TUNVN", fullName: "TUNVN PREHUB", className: "admin-supplier-tunvn" },
  AIVault: { label: "AIVault", fullName: "AIVault Hub", className: "admin-supplier-aivault" },
  Manual: { label: "Manual", fullName: "Manual Axvara", className: "admin-supplier-manual" },
} as const;

export function SupplierBadge({ supplier = "Manual", slug }: { supplier?: Prod["supplier"]; slug?: string }) {
  const identity = SUPPLIER_STYLES[supplier];
  const label = `Supplier: ${identity.fullName}`;
  return (
    <Badge variant="outline" className={`admin-supplier-badge ${identity.className} gap-1.5 whitespace-nowrap rounded-full`}
      data-supplier={supplier} aria-label={label} title={`${label}${slug ? ` · slug /${slug}` : ""}`}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {identity.label}
    </Badge>
  );
}
