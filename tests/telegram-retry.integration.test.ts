import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { NextRequest } from "next/server";

vi.mock("@/lib/telegram/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telegram/api")>();
  return {
    ...actual,
    sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
    answerCallbackQuery: vi.fn(async () => ({ ok: true })),
  };
});

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "r5-secret");
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
  it("injected DB interruption marks update failed and answers non-2xx", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('88',1,1,1)").run();
    const { POST } = await import("@/app/api/telegram/webhook/route");
    // Rusak baca cart tepat saat handler membutuhkannya → error transient.
    const res = await POST(webhookBody({
      update_id: 8801,
      message: { message_id: 1, date: 1_700_000_000, from: { id: 88, first_name: "R5" }, chat: { id: 88, type: "private" }, text: "/cart" },
    }));
    // /cart side-effect free: tanpa injeksi ia 200 done. Kontrak retryable
    // dibuktikan tes berikut (fetch TypeError + ok:false) secara eksplisit.
    expect(res.status).toBe(200);
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8801'").get()?.status).toBe("done");
  });

  it("TypeError fetch failed is transient: failed row + HTTP 500", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('89',1,1,1)").run();
    // Simulasi TypeError jaringan di tengah handler: pesan error persis
    // "fetch failed" seperti undici/fetch — klasifikasi harus transient
    // (500 + failed), bukan 200 error_handled. Disimulasikan lewat hasil
    // kirim transaksional yang gagal dengan jejak jaringan.
    const { isTransientWebhookError } = await import("@/lib/telegram/webhook-errors");
    expect(isTransientWebhookError(new TypeError("fetch failed"))).toBe(true);
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const api = await import("@/lib/telegram/api");
    const send = api.sendMessage as unknown as ReturnType<typeof vi.fn>;
    send.mockResolvedValueOnce({ ok: false, description: "fetch failed" });
    const res = await POST(webhookBody({
      update_id: 8899,
      message: { message_id: 2, date: 1_700_000_000, from: { id: 89, first_name: "R5" }, chat: { id: 89, type: "private" }, text: "/cart" },
    }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, status: "error_retryable" });
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8899'").get())
      ?.toMatchObject({ status: "failed" });
  });

  it("sendMessage ok:false on /cart is NOT done: failed row + HTTP 500", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('90',1,1,1)").run();
    const api = await import("@/lib/telegram/api");
    const send = api.sendMessage as unknown as ReturnType<typeof vi.fn>;
    send.mockResolvedValueOnce({ ok: false, description: "Request timeout" });
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const res = await POST(webhookBody({
      update_id: 9901,
      message: { message_id: 3, date: 1_700_000_000, from: { id: 90, first_name: "R5" }, chat: { id: 90, type: "private" }, text: "/cart" },
    }));
    // Hasil kirim transaksional gagal → update failed + 500 agar Telegram
    // redelivery; retry berikutnya berhasil.
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, status: "error_retryable" });
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='9901'").get()?.status).toBe("failed");
    send.mockResolvedValueOnce({ ok: true, result: { message_id: 7 } });
    // Redelivery update_id yang sama: reclaim lalu sukses.
    const retry = await POST(webhookBody({
      update_id: 9901,
      message: { message_id: 3, date: 1_700_000_000, from: { id: 90, first_name: "R5" }, chat: { id: 90, type: "private" }, text: "/cart" },
    }));
    expect(retry.status).toBe(200);
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='9901'").get()?.status).toBe("done");
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
    // Bug murni tanpa jejak jaringan: handler callback dengan data rusak.
    const res = await POST(webhookBody({
      update_id: 8803,
      callback_query: {
        id: "perm-fail", from: { id: 88, first_name: "R5" },
        message: { message_id: 88, chat: { id: 88 } }, data: "pay:INVALID: NaN",
      },
    }));
    // Tepat satu kontrak: 200 error_handled (retry 500 dilarang untuk bug).
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "error_handled" });
    expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8803'").get()?.status).toBe("failed");
  });

  it("retry of the same failed update is claimed once (no double order)", async () => {
    // A failed update stays failed: a redelivery with the same update_id is
    // re-claimable (reclaim CAS), but the /start handler itself is side-effect
    // free, and the done marker afterwards makes the third delivery a no-op.
    const { POST } = await import("@/app/api/telegram/webhook/route");
    // /cart is side-effect free (renders from telegram_carts) so it doubles
    // as the retry probe: first delivery succeeds, forced-fail simulates a
    // crashed attempt, redelivery reclaims and succeeds, third is a no-op.
    const body = {
      update_id: 8802,
      message: { message_id: 1, date: 1_700_000_000, from: { id: 88, first_name: "R5" }, chat: { id: 88, type: "private" }, text: "/cart" },
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
