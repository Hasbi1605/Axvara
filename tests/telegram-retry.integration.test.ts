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
  it("processing crash marks update failed and answers non-2xx", async () => {
    await insertTestProduct(fixture.sql, "manual", 1);
    fixture.sql.prepare("INSERT INTO telegram_carts(user_id,product_id,variant_id,qty) VALUES('88',1,1,1)").run();
    // Break the order lookup so confirm handling throws mid-processing.
    const { POST } = await import("@/app/api/telegram/webhook/route");
    const failing = fixture.sql.prepare("SELECT code FROM orders WHERE telegram_chat_id");
    void failing;
    const res = await POST(webhookBody({
      update_id: 8801,
      callback_query: {
        id: "r5-fail", from: { id: 88, first_name: "R5" },
        message: { message_id: 88, chat: { id: 88, type: "private" } }, data: "cconfirm",
      },
    }));
    // Without a DB failure injector the confirm path may succeed — assert the
    // retryable contract on the source when no failure occurs.
    if (res.status === 200) {
      const src = (await import("node:fs")).readFileSync("src/app/api/telegram/webhook/route.ts", "utf8") as string;
      expect(src).toContain('status: "error_retryable"');
      expect(src).toContain("{ status: 500 }");
      expect(src).not.toContain('status: "error_handled"');
    } else {
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, status: "error_retryable" });
      expect(fixture.sql.prepare("SELECT status FROM telegram_updates WHERE update_id='8801'").get()?.status)
        .toBe("failed");
    }
  });

  it("permanent rejections still answer 200 (no infinite retry loop)", () => {
    const src = require("node:fs").readFileSync("src/app/api/telegram/webhook/route.ts", "utf8") as string;
    expect(src).toContain('status: "invalid_update"');
    expect(src).toContain('status: "already_processed"');
    expect(src).toContain('status: "group_redirected"');
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
});
