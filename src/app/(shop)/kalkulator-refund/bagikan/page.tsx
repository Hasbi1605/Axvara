import { RefundCalculator } from "@/components/refund/RefundCalculator";
import { metadata as calculatorMetadata } from "../page";

export const metadata = calculatorMetadata;
export default function SharedRefundPage() { return <RefundCalculator shared />; }
