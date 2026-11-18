import type { Metadata } from "next";
import { RefundCalculator } from "@/components/refund/RefundCalculator";

export const metadata: Metadata = {
  title: "Kalkulator Refund | AXVARA",
  description: "Hitung sisa masa aktif dan estimasi refund AXVARA Market.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function RefundPage() { return <RefundCalculator />; }
