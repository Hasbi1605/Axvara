import type { NextRequest } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { buyerOrderAccessMatches, newOrderAccessFailure, requestOrderAccessCode, requiresOrderAccessCode, verifyCheckoutCredentialGrant } from "@/lib/order-access";
import { readEstimate, readShare, refundBody, refundOrder, refundResponse, SHARE_TOKEN } from "@/lib/refund/server";

export const runtime = "edge";
const denied = () => refundResponse({ error: "access" }, 404);

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
    const contact = requestOrderAccessCode(req);
    const grant = req.headers.get("x-checkout-credential-grant") || "";
    if (!contact && !grant && !req.headers.get("x-buyer-access-session")) return denied();
    const order = await refundOrder(db, code);
    if (!order) return denied();
    if (!(grant && await verifyCheckoutCredentialGrant(grant, order))) {
      if (requiresOrderAccessCode(order)) {
        const failure = await newOrderAccessFailure(req, order, contact, { allowAdmin: false, allowStatusSession: true });
        if (failure) return refundResponse({ error: failure.status === 429 ? "rate" : failure.status === 503 ? "unavailable" : "access" }, failure.status);
      } else if (!(await buyerOrderAccessMatches(contact, order))) return denied();
    }
    return refundResponse({ estimate: await readEstimate(db, order), locale: order.locale });
  } catch {
    return refundResponse({ error: "unavailable" }, 503);
  }
}
