import type { Metadata } from "next";
import { RefundCalculator } from "@/components/refund/RefundCalculator";
import { MARKET_INVOICE } from "@/lib/refund/calculate";

export const runtime = "edge";

export const metadata: Metadata = {
  title: "Kalkulator Refund | AXVARA",
  description: "Hitung sisa masa aktif dan estimasi refund AXVARA Market.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function RefundPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const { code } = await searchParams;
  const normalized = typeof code === "string" ? code.trim().toUpperCase() : "";
  const buyerCode = MARKET_INVOICE.test(normalized) ? normalized : "";
  return <RefundCalculator key={buyerCode} buyerCode={buyerCode} />;
}
