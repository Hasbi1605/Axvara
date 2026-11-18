import type { NextRequest } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { readEstimate, readShare, refundBody, refundOrder, refundResponse, SHARE_TOKEN } from "@/lib/refund/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const parsed = await refundBody(req, "orders:refund");
  if (parsed.error) return parsed.error;
  const { code, token } = parsed.data;
  const db = createDatabaseAccess();
  try {
    if (token !== undefined) {
      if (typeof token !== "string" || !SHARE_TOKEN.test(token)) return refundResponse({ error: "share_expired" }, 404);
      const estimate = await readShare(db, token);
      return estimate ? refundResponse({ estimate, locale: estimate.locale }) : refundResponse({ error: "share_expired" }, 404);
    }
    // The invoice authorizes only this estimate projection, not order status APIs or credentials.
    const order = await refundOrder(db, code);
    if (!order) return refundResponse({ error: "not_found" }, 404);
    return refundResponse({ estimate: await readEstimate(db, order), locale: order.locale });
  } catch {
    return refundResponse({ error: "unavailable" }, 503);
  }
}
