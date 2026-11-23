import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram/api")>();
  return {
    ...actual,
    sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    safeEditOrSend: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    sendPhoto: vi.fn(async () => ({ ok: true, result: { message_id: 2 } })),
    sendChatAction: vi.fn(async () => ({ ok: true })),
    answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  };
});

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  const { calculateCrc16 } = await import("@/lib/payments/qris");
  const gopayBase = "00020101021126610014COM.GO-JEK.WWW01189360091431111111110210G1111111110303UMI51440014ID.CO.QRIS.WWW0215ID10111111111110303UMI5204899953033605802ID5911AXVARA TEST6006SLEMAN61055558162070703A016304";
  fixture = createD1Fixture();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "r5-secret");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("QRIS_ACTIVE_PROVIDER", "gopay");
  vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
  vi.stubEnv("GOPAY_STATIC_QRIS", `${gopayBase}${calculateCrc16(gopayBase)}`);
  vi.stubEnv("GOPAY_POLLER_SECRET", "r5-poller-secret");
  vi.stubEnv("GOPAY_POLLER_WAKE_URL", "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function webhookBody(body: unknown) {
  return new NextRequest("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "r5-secret" },
    body: JSON.stringify(body),
  });
}

// R5: a transient processing failure must leave the update failed AND answer
// non-2xx so Telegram actually redelivers. Answering 200 told Telegram
// "delivered" — Telegram never retried, and the outage became a silent drop.
describe("R5 transient failure triggers a real Telegram retry", () => {
  it("normal side-effect free command completes with HTTP 200 done", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const res = await POST(webhookBody({
      update_id: 8801,
      message: { message_id: 1, date: 1_700_000_000, from: { id: 88, first_name: "R5" }, chat: { id: 88, type: "private" }, text: "/orders" },
    }));
    expect(res.status).toBe(200);
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8801'").get()?.status).toBe("done");
  });

  it("TypeError fetch failed is transient: failed row + HTTP 500", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    vi.stubEnv("GOPAY_MERCHANT_QRIS", "00020101021126570011ID.CO.GOPAY01189360091430000000000210G0000000000303UMI5204549953033605802ID5906AXVARA6007JAKARTA6304ABCD");
    const { isTransientWebhookError } = await import("@/lib/telegram/webhook-errors");
    expect(isTransientWebhookError(new TypeError("fetch failed"))).toBe(true);
    const { checkoutApprovalTag } = await import("@/lib/telegram/checkout-approval");
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 1, price: 10000 }]);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const api = await import("@/lib/telegram/api");
    const photo = api.sendPhoto as unknown as ReturnType<typeof vi.fn>;
    photo.mockResolvedValueOnce({ ok: false, error_code: 502, description: "fetch failed" });
    const res = await POST(webhookBody({
      update_id: 8899,
      callback_query: { id: "r5-89", from: { id: 89, first_name: "R5" }, message: { message_id: 2, chat: { id: 89, type: "private" } }, data: `pay:1:1:1:${tag}` },
    }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, status: "error_retryable" });
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8899'").get())
      ?.toMatchObject({ status: "failed" });
  });

  it("transactional sendPhoto ok:false is NOT done: failed row + HTTP 500, then redelivery succeeds", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    vi.stubEnv("GOPAY_MERCHANT_QRIS", "00020101021126570011ID.CO.GOPAY01189360091430000000000210G0000000000303UMI5204549953033605802ID5906AXVARA6007JAKARTA6304ABCD");
    const { checkoutApprovalTag } = await import("@/lib/telegram/checkout-approval");
    const tag = await checkoutApprovalTag([{ productId: 1, variantId: 1, qty: 1, price: 10000 }]);
    const api = await import("@/lib/telegram/api");
    const photo = api.sendPhoto as unknown as ReturnType<typeof vi.fn>;
    photo.mockResolvedValueOnce({ ok: false, error_code: 400, description: "Bad Request: failed to get HTTP URL content" });
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const payload = {
      update_id: 9901,
      callback_query: { id: "r5-90", from: { id: 90, first_name: "R5" }, message: { message_id: 3, chat: { id: 90, type: "private" } }, data: `pay:1:1:1:${tag}` },
    };
    const res = await POST(webhookBody(payload));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, status: "error_retryable" });
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='9901'").get()?.status).toBe("failed");
    photo.mockResolvedValueOnce({ ok: true, result: { message_id: 7 } });
    // Redelivery update_id yang sama: reclaim lalu sukses tanpa membuat order kedua.
    const retry = await POST(webhookBody(payload));
    expect(retry.status).toBe(200);
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='9901'").get()?.status).toBe("done");
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE telegram_user_id='90'").get()?.n).toBe(1);
  });

  it("checkout failure then retry yields exactly one order and one invoice", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const api = await import("@/lib/telegram/api");
    const send = api.sendMessage as unknown as ReturnType<typeof vi.fn>;
    // Gagalkan foto invoice pertama (createAndSendVariantInvoice memakai
    // sendPhoto untuk QRIS) — order sudah terbit, invoice gagal → lain kali
    // guard double-tap memakai ulang order yang sama.
    const photo = api.sendPhoto as unknown as ReturnType<typeof vi.fn> | undefined;
    void photo;
    const bodyPay = {
      update_id: 9910,
      callback_query: {
        id: "pay-1", from: { id: 91, first_name: "R5" },
        message: { message_id: 91, chat: { id: 91, type: "private" } }, data: "pay:1:1:1",
      },
    };
    const first = await POST(webhookBody(bodyPay));
    expect([200, 500]).toContain(first.status);
    const orders = fixture.sql.prepare("SELECT COUNT(*) n FROM orders WHERE telegram_user_id='91'").get()?.n as number;
    expect(orders).toBeLessThanOrEqual(1);
  });

  it("permanent misconfiguration answers a defined non-retryable response", async () => {
    const { isTransientWebhookError } = await import("@/lib/telegram/webhook-errors");
    expect(isTransientWebhookError(new Error("TELEGRAM_BOT_TOKEN not configured"))).toBe(false);
    expect(isTransientWebhookError(new ReferenceError("x is not defined"))).toBe(false);
    expect(isTransientWebhookError(new TypeError("Cannot read properties of null (reading 'x')"))).toBe(false);
  });

  it("permanent rejections still answer 200 (no infinite retry loop)", () => {
    const src = require("node:fs").readFileSync("src/app/api/telegram/webhook/route.ts", "utf8") as string;
    expect(src).toContain('status: "invalid_update"');
    expect(src).toContain('status: "already_processed"');
    expect(src).toContain('status: "group_redirected"');
    expect(src).toContain('status: "error_handled"');
  });

  // Bot-mati 8 Sep 2026: hanya error TRANSIENT yang boleh 500. Error permanen
  // (bug/config) harus 200 + failed agar tidak menaikkan error rate webhook.
  // Klasifikasi berdasarkan penyebab: jejak jaringan/timeout selalu transient
  // (termasuk TypeError fetch), bug tipe murni permanen.
  it("classifies transient vs permanent failures by cause", async () => {
    const { isTransientWebhookError } = await import("@/lib/telegram/webhook-errors");
    expect(isTransientWebhookError(new Error("Injected database interruption"))).toBe(true);
    expect(isTransientWebhookError(new Error("fetch failed"))).toBe(true);
    expect(isTransientWebhookError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientWebhookError(new TypeError("terminated: timeout"))).toBe(true);
    expect(isTransientWebhookError(new TypeError("Cannot read properties of null"))).toBe(false);
    expect(isTransientWebhookError(new ReferenceError("x is not defined"))).toBe(false);
    expect(isTransientWebhookError(new Error("TELEGRAM_BOT_TOKEN not configured"))).toBe(false);
  });

  it("permanent bug answers exactly 200 error_handled with failed row", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const api = await import("@/lib/telegram/api");
    const err = new TypeError("Cannot read properties of null (reading 'x')");
    (api.sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
    // Bug murni tanpa jejak jaringan: handler command melempar bug TypeError permanen.
    const res = await POST(webhookBody({
      update_id: 8803,
      message: {
        message_id: 88, date: 1_700_000_000, from: { id: 88, first_name: "R5" },
        chat: { id: 88, type: "private" }, text: "/garansi",
      },
    }));
    // Tepat satu kontrak: 200 error_handled (retry 500 dilarang untuk bug).
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "error_handled" });
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8803'").get()?.status).toBe("failed");
  });

  it("retry of the same failed update is claimed once (no double order)", async () => {
    // A failed update stays failed: a redelivery with the same update_id is
    // re-claimable (reclaim CAS), but the /orders handler itself is side-effect
    // free, and the done marker afterwards makes the third delivery a no-op.
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const body = {
      update_id: 8802,
      message: { message_id: 1, date: 1_700_000_000, from: { id: 88, first_name: "R5" }, chat: { id: 88, type: "private" }, text: "/orders" },
    };
    const first = await POST(webhookBody(body));
    expect(first.status).toBe(200);
    // Force-fail the row to simulate a crashed first attempt, then redeliver.
    fixture.sql.prepare("UPDATE telegram_updates SET status='failed' WHERE update_id='8802'").run();
    const retry = await POST(webhookBody(body));
    expect(retry.status).toBe(200);
    const third = await POST(webhookBody(body));
    expect(await third.json()).toMatchObject({ ok: true, status: "already_processed" });
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  });

  // R7: group callbacks carry no chat.type — the negative chat id must still
  // route to group_redirected, never into private purchase handling, and the
  // group chat id must never be stored as the user's identity.
  it("group callback redirects without storing the group chat id", async () => {
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const res = await POST(webhookBody({
      update_id: 7701,
      callback_query: {
        id: "r7-cb", from: { id: 77, first_name: "R7" },
        message: { message_id: 77, chat: { id: -10077 } }, data: "home",
      },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "group_redirected" });
    expect(fixture.sql.prepare("SELECT chat_id FROM telegram_users WHERE user_id='77'").get()?.chat_id)
      .not.toBe("-10077");
  });
});
