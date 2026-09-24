// GET /api/catalog — Public product catalog with variant summaries
// Used by channels that need variant-aware data

import { NextResponse } from "next/server";
import { listActiveProducts, getProductDetail } from "@/lib/catalog";
import { isVariantsReadEnabled } from "@/lib/catalog";
import { isD1Mode } from "@/lib/db";
import { withVariantCopy } from "@/lib/product-copy/resolve";

export const runtime = "edge";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (slug) {
    const detail = await getProductDetail(slug);
    if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });

    return NextResponse.json({
      // S&K + cara aktivasi versi Axvara (fallback: teks WR dirapikan).
      product: withVariantCopy(detail),
      variantsEnabled: isD1Mode() && isVariantsReadEnabled(),
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  }

  const products = await listActiveProducts();
  return NextResponse.json({
    products,
    variantsEnabled: isD1Mode() && isVariantsReadEnabled(),
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
