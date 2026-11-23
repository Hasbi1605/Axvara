import { expect, it } from "vitest";
import { catalogItems, SUPPLIERS, supplierMoney } from "@/components/admin/supplier-admin-data";

it("shows the Pixel Verification credit cost as Modal in the Markup tab (was '—')", () => {
  const rows = [{
    service_key: "normal_3", flow_type: "normal", validity: 3, credit_cost: 1, fx_idr_per_usd: 18300,
    markup_percent: 35, admin_price_idr: null, stock: 1, available: 1,
    axvara_product_id: 1, product_name: "Google AI Pro 3 Bulan", product_active: 0, product_archived: 0,
    variant_id: 1, sku: "PV-NORMAL-3", label: "Link Redeem 3 Bulan", variant_price: 24700, variant_active: 0,
  }];
  const [item] = catalogItems(rows as never, SUPPLIERS.pixelverif);
  expect(item.cost).toBe(1);
  expect(item.fx).toBe(18300);
  expect(supplierMoney("USD", item.cost)).toBe("$1.00");
});
