// GET /api/catalog — Public product catalog with variant summaries
// Used by channels that need variant-aware data

import { NextResponse } from "next/server";
import { listActiveProducts, getProductDetail } from "@/lib/catalog";
import { isVariantsReadEnabled } from "@/lib/catalog";
import { isD1Mode } from "@/lib/db";
import { withVariantCopy } from "@/lib/product-copy/resolve";
import { loadActiveSupplierLinkMap } from "@/lib/supplier-links";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { cachePublicCatalog } from "@/lib/catalog-cache";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const key = new URLSearchParams({
    v: String(isVariantsReadEnabled()),
    slug: slug || "_list",
  });

  const response = await cachePublicCatalog(
    `${slug ? "catalog-detail-v2" : "catalog"}:${key}`,
    slug ? 120 : 300,
    async () => {
      if (slug) {
        const detail = await getProductDetail(slug);
        if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
        const links = await loadActiveSupplierLinkMap();

        return NextResponse.json({
          // S&K + cara aktivasi versi Axvara (fallback: teks WR dirapikan + sanitasi link/admin).
          product: withVariantCopy(detail, links),
          variantsEnabled: isD1Mode() && isVariantsReadEnabled(),
        }, {
          headers: {
            // Edge cache 120 dtk diinvalidasi via catalog_revision_market; browser no-cache (diatur cachePublicCatalog).
            "Cache-Control": "public, no-cache",
          },
        });
      }

      const products = await listActiveProducts();
      return NextResponse.json({
        products,
        variantsEnabled: isD1Mode() && isVariantsReadEnabled(),
      }, {
        headers: {
          "Cache-Control": "public, no-cache",
        },
      });
    },
    "market",
  );

  if (slug && response.status === 200) {
    try {
      const payload = (await response.clone().json()) as { product?: { id?: unknown } };
      const productId = typeof payload?.product?.id === "number" ? payload.product.id : undefined;
      if (productId !== undefined) {
        trackFunnelEvent({ stage: "view", productId }, request);
      }
    } catch { /* Telemetry must never affect catalog response. */ }
  }

  return response;
}
