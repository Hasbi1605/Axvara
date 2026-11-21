import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { sendMessage } from "@/lib/telegram/api";
import { sendPendingOrderReminders } from "@/lib/telegram/order-notifications";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn(async () => ({ ok: true })) }));

const issued = Date.parse("2026-11-20T06:50:00Z"); // 13:50 WIB
const minute = 60_000;
let fx: ReturnType<typeof createD1Fixture>;
const at = (minutes: number) => new Date(issued + minutes * minute).toISOString();
const tick = (minutes: number) => vi.spyOn(Date, "now").mockReturnValue(Date.parse(at(minutes)));

beforeEach(() => {
  fx = createD1Fixture();
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture");
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function seed(code: string, provider: string, lifetime: number, issuedAt: string | null = "2026-11-20 06:50:00") {
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
    sales_channel,telegram_chat_id,locale,expires_at,created_at) VALUES(?,'Buyer','','[]',9000,?,'pending','pending','telegram','1',?,?,?)`)
    .run(code, provider === "nowpayments" ? "nowpayments:usdtbsc" : "qris", provider === "nowpayments" ? "en" : "id", at(lifetime), at(-60));
  fx.sql.prepare(`INSERT INTO payment_transactions(order_code,provider,provider_mode,provider_order_id,merchant_id,
    requested_amount,payable_amount,status,expires_at,invoice_issued_at,created_at,price_amount_text,price_currency)
    VALUES(?,?,'fixture',?,'fixture',9000,9123,'pending',?,?,?,'2.15','usd')`)
    .run(code, provider, code, at(lifetime), issuedAt, issuedAt ? at(-60) : at(0));
}

it.each(["klikqris", "gopay"])("%s: next-tick regression, 5-minute window, atomic one-reminder limit", async provider => {
  const code = "AXV-20261120-969F88D9";
  seed(code, provider, 15);
  tick(1);
  expect(await sendPendingOrderReminders()).toBe(0);
  expect(sendMessage).not.toHaveBeenCalled();
  tick(9.99);
  expect(await sendPendingOrderReminders()).toBe(0);
  tick(10);
  expect((await Promise.all([sendPendingOrderReminders(), sendPendingOrderReminders()])).sort()).toEqual([0, 1]);
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: [
    "⏰ <b>5 menit lagi</b>", `Kode  : <code>${code}</code>`, "Total : <code>Rp9.123</code>",
    "Selesaikan pembayaran sebelum 14:05 WIB.",
  ].join("\n") }));
  tick(13);
  expect(await sendPendingOrderReminders()).toBe(0);
});

it("does not remind buyers to pay retired DANA invoices", async () => {
  seed("AXV-20261120-969F88D9", "dana", 15);
  tick(10);
  expect(await sendPendingOrderReminders()).toBe(0);
  expect(sendMessage).not.toHaveBeenCalled();
});

it("uses the crypto invoice lifetime for first eligibility and ≥1/3 spacing", async () => {
  seed("AXV-CRYPTO-LONG", "nowpayments", 60, null);
  tick(35.99);
  expect(await sendPendingOrderReminders()).toBe(0);
  tick(36);
  expect(await sendPendingOrderReminders()).toBe(1);
  tick(55.99);
  expect(await sendPendingOrderReminders()).toBe(0);
  tick(56);
  expect(await sendPendingOrderReminders()).toBe(1);
  expect(vi.mocked(sendMessage).mock.lastCall?.[0]).toMatchObject({ text: expect.stringContaining("Total : <code>2.15 USD</code>") });
});

it("enforces the 8-minute age floor and never sends in the final minute", async () => {
  seed("AXV-CRYPTO-SHORT", "nowpayments", 12);
  tick(7.99);
  expect(await sendPendingOrderReminders()).toBe(0);
  tick(11);
  expect(await sendPendingOrderReminders()).toBe(0);
});
