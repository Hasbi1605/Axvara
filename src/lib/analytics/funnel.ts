import { isSyntheticRequest } from "@/lib/rateLimit";
import { getCryptoAsset } from "@/lib/payments/crypto-assets";
import type { D1 } from "@/lib/db/types";

type Stage = "view" | "quote" | "order" | "paid";
type Kind = "apps" | "pedia" | "games";
type Channel = "web" | "telegram" | "whatsapp";
type Outcome = "ok" | "out_of_stock" | "below_min" | "method_unavailable";
type Binding = { writeDataPoint(point: { indexes: string[]; blobs: string[]; doubles: number[] }): void | Promise<void> };
export type FunnelEventInput = {
  stage: Stage;
  orderKind?: Kind;
  channel?: Channel;
  method?: string;
  productId?: number;
  productSlug?: string;
  variantId?: number;
  locale?: string;
  outcome?: Outcome;
  subtotal?: number;
  quantity?: number;
};

function context() {
  // next-on-pages 1.13 exposes this request-local context to its API wrapper.
  // Read it without eagerly importing the server-only wrapper in shared DB tests.
  return (globalThis as unknown as Record<symbol, {
    env?: Record<string, unknown>; ctx: { waitUntil(task: Promise<unknown>): void };
  } | undefined>)[Symbol.for("__cloudflare-request-context__")];
}
function binding(): Binding | undefined {
  const global = globalThis as unknown as Record<string, unknown>;
  const env = process.env as unknown as Record<string, unknown>;
  return (global.FUNNEL_ANALYTICS ?? env.FUNNEL_ANALYTICS
    ?? (context()?.env as Record<string, unknown> | undefined)?.FUNNEL_ANALYTICS) as Binding | undefined;
}
function background(task: Promise<unknown>): void {
  const safe = task.catch(() => undefined);
  try { context()?.ctx.waitUntil(safe); } catch { /* Analytics never holds the response open. */ }
}
const id = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : "none";

/** Fixed vocabulary only: never sanitize arbitrary buyer strings into analytics. */
function payment(method = "none"): [string, string] {
  if (method === "qris" || /^qris:(dana|gopay|klikqris)$/.test(method)) return ["qris", method];
  const coin = method.startsWith("nowpayments:") ? getCryptoAsset(method.slice(12)) : null;
  if (coin) return ["crypto", `nowpayments:${coin.ticker}`];
  const channel = method.match(/^sekalipay_gateway:([A-Z_]{2,32})$/)?.[1];
  if (channel && /^(?:[A-Z]{2,10}VA(?:_ALTERNATIVE)?|SHOPEEPAY|DANA_REALTIME|GOPAY|OVO|LINKAJA|VIRGO|ASTRAPAY)$/.test(channel)) {
    return [channel.includes("VA") ? "gateway_va" : "gateway_ewallet", method];
  }
  return method === "manual" ? ["manual", "manual"] : ["none", "none"];
}

/** Synchronous native WAE write; absent/broken binding is a no-op. No PII-shaped fields accepted. */
export function trackFunnelEvent(event: FunnelEventInput, request?: Pick<Request, "headers">): void {
  try {
    // UA spoofing can only suppress telemetry, never bypass auth/rate limits.
    // A-S uses axvara-synth/1.0 without forwarding cron secrets to public pages.
    if (request && (isSyntheticRequest(request) || request.headers.get("user-agent")?.startsWith("axvara-synth/"))) return;
    const dataset = binding();
    if (!dataset || !["view", "quote", "order", "paid"].includes(event.stage)) return;
    const kind = ["apps", "pedia", "games"].includes(event.orderKind ?? "") ? event.orderKind! : "apps";
    const channel = ["web", "telegram", "whatsapp"].includes(event.channel ?? "") ? event.channel! : "web";
    const [family, method] = payment(event.method);
    const outcome = ["ok", "out_of_stock", "below_min", "method_unavailable"].includes(event.outcome ?? "") ? event.outcome! : "ok";
    const amount = Number.isSafeInteger(event.subtotal) && event.subtotal! > 0 ? event.subtotal! : 0;
    const result = dataset.writeDataPoint({
      indexes: [`${kind}:${event.stage}`],
      blobs: [event.stage, kind, channel, family, method, id(event.productId), event.locale === "en" ? "en" : "id", outcome, id(event.variantId),
        event.productSlug && /^[a-z][a-z0-9-]{0,79}$/.test(event.productSlug) ? event.productSlug : "none"],
      // Value bucket lower bound, not the exact invoice amount. 0 also covers unknown/view.
      doubles: [1, [1_000_000, 500_000, 100_000, 50_000, 10_000].find((n) => amount >= n) ?? 0,
        Number.isSafeInteger(event.quantity) && event.quantity! > 0 ? Math.min(event.quantity!, 1_000_000) : 0],
    });
    if (result) background(Promise.resolve(result));
  } catch { /* Do not log buyer context or block commerce on telemetry. */ }
}

/** Called ONLY by the winner of either atomic paid transition. One PK read, off the response path. */
export function trackPaidOrder(orderCode: string, database: D1 | null, memoryOrder?: Record<string, unknown>): void {
  try {
    if (!binding()) return;
    background((async () => {
      const order = (database ? await database.prepare(
        `SELECT o.order_kind,o.sales_channel,o.locale,o.subtotal,o.items,o.payment_method,
                pt.provider,pt.gateway_channel,pt.pay_currency
         FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code WHERE o.code=?`,
      ).bind(orderCode).first() : memoryOrder) as Record<string, unknown> | undefined;
      if (!order) return;
      let items: { product_id?: number; variant_id?: number; qty?: number }[] = [];
      try { items = typeof order.items === "string" ? JSON.parse(order.items) : []; } catch { /* No item dimension. */ }
      if (!Array.isArray(items)) items = [];
      const method = order.provider === "nowpayments" ? `nowpayments:${order.pay_currency}`
        : order.provider === "sekalipay_gateway" ? `sekalipay_gateway:${order.gateway_channel}`
        : ["dana", "gopay", "klikqris"].includes(String(order.provider)) ? `qris:${order.provider}` : String(order.payment_method ?? "manual");
      trackFunnelEvent({ stage: "paid", orderKind: order.order_kind as Kind, channel: order.sales_channel as Channel,
        locale: String(order.locale), method, subtotal: Number(order.subtotal), productId: items[0]?.product_id,
        variantId: items[0]?.variant_id, quantity: items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0) });
    })());
  } catch { /* Best-effort even when an execution context is unavailable. */ }
}
