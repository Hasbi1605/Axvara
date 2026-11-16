import { NextRequest } from "next/server";
import { financeRequest } from "@/lib/finance/expenses";
import { paymentFeeSchema, readPaymentFees, savePaymentFees } from "@/lib/finance/payment-fees";
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const GET = (req: NextRequest) => financeRequest(req, () => readPaymentFees());
export const PUT = (req: NextRequest) => financeRequest(req, body => savePaymentFees(paymentFeeSchema.parse(body)));
