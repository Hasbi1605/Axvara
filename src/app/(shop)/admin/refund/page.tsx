import type { Metadata } from "next";
import { RefundCalculator } from "@/components/refund/RefundCalculator";
import { MARKET_INVOICE } from "@/lib/refund/calculate";

export const runtime = "edge";
export const metadata: Metadata = { title: "Kalkulator Refund | Admin AXVARA", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AdminRefundPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  return <RefundCalculator admin initialCode={MARKET_INVOICE.test(normalized) ? normalized : ""} />;
}
