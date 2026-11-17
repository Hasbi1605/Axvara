import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { processItem, sendToRecipient } from "@/lib/fulfillment/delivery/send";
import { CredentialSendDeferred, sendFencedCredential } from "@/lib/fulfillment/delivery/send-fence";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn() }));
vi.mock("@/lib/whatsapp/gateway", () => ({ sendTextMessage: vi.fn() }));
import { sendMessage } from "@/lib/telegram/api";
import { sendTextMessage } from "@/lib/whatsapp/gateway";

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  vi.stubEnv("WHATSAPP_FULFILLMENT", "true");
  vi.stubEnv("WHATSAPP_CREDENTIAL_DM_ENABLED", "true");
  vi.mocked(sendMessage).mockReset().mockResolvedValue({ ok: true, result: { message_id: 1 } } as never);
  vi.mocked(sendTextMessage).mockReset().mockResolvedValue({ ok: true, messageId: "wa-1" });
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

async function setup(channel = "telegram", mode = "shared") {
  await insertTestProduct(fixture.sql, mode);
  const order = insertTestOrder(fixture.sql, "C0-FIXTURE", { status: "lunas", channel });
  fixture.sql.exec("INSERT INTO telegram_users(user_id,chat_id) VALUES('12345','12345')");
  fixture.sql.prepare(`INSERT INTO fulfillment_items
    (id,order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status)
    VALUES(1,?,0,1,1,1,?,?,?,'queued')`).run(order.code, mode, channel, channel === "telegram" ? "12345" : "628000000000");
  if (mode === "unique") {
    const { encryptSecret } = await import("@/lib/fulfillment/crypto");
    const secret = await encryptSecret("UNIQUE-SECRET");
    fixture.sql.prepare(`INSERT INTO fulfillment_inventory(id,product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status,order_code)
      VALUES(1,1,1,?,?,'fixture','reserved',?)`).run(secret.ciphertext, secret.iv, order.code);
    fixture.sql.exec("UPDATE fulfillment_items SET inventory_id=1 WHERE id=1");
  }
  return { order, database: createDatabaseAccess(fixture.db) };
}
const item = () => fixture.sql.prepare("SELECT * FROM fulfillment_items WHERE id=1").get()!;
const ledger = () => fixture.sql.prepare("SELECT * FROM fulfillment_send_claims WHERE item_id=1").get()!;
const reclaim = () => fixture.sql.exec("UPDATE fulfillment_items SET status='retry',locked_until=NULL WHERE id=1");
const lease = () => {
  const fence = new Date(Date.now() + 60_000).toISOString();
  fixture.sql.prepare("UPDATE fulfillment_items SET status='sending',locked_until=? WHERE id=1").run(fence);
  return fence;
};

describe("durable automatic credential-send fence", () => {
  it.each(["telegram", "whatsapp"].flatMap(channel => ["shared", "unique"].map(mode => [channel, mode])))
  ("%s/%s: two executors including item-lease takeover invoke transport once", async (channel, mode) => {
    const { order, database } = await setup(channel, mode);
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const mock = channel === "telegram" ? vi.mocked(sendMessage) : vi.mocked(sendTextMessage);
    mock.mockImplementationOnce(async () => { started(); await pending; return { ok: true, result: { message_id: 42 }, messageId: "wa-42" } as never; });
    const first = processItem(order, item(), undefined, database);
    await entered;
    reclaim(); // cron recovered an expired item while the original send was in flight
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(item().attempt_count).toBe(1); // busy send is not a failed attempt
    finish();
    await first;
    expect(ledger().status).toBe("sent");
    expect(await processItem(order, item(), undefined, database)).toBe(true);
    expect(item().status).toBe("delivered");
    expect(mock).toHaveBeenCalledTimes(1);
    if (mode === "unique") expect(fixture.sql.prepare("SELECT status FROM fulfillment_inventory WHERE id=1").get()?.status).toBe("delivered");
  });

  it.each(["telegram", "whatsapp"])("%s: definite rejection retries; ambiguous response waits beyond ten minutes", async channel => {
    const { order, database } = await setup(channel);
    if (channel === "telegram") vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error_code: 403 } as never);
    else vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: false, outcomeUnknown: false, error: "target_not_allowed" });
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(ledger().status).toBe("failed");
    if (channel === "telegram") vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, description: "Request timeout" });
    else vi.mocked(sendTextMessage).mockResolvedValueOnce({ ok: false, outcomeUnknown: true, error: "timeout" });
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(ledger().status).toBe("sending");
    const mock = channel === "telegram" ? sendMessage : sendTextMessage;
    for (const age of [null, "-599 seconds"]) {
      if (age) fixture.sql.prepare("UPDATE fulfillment_send_claims SET updated_at=datetime('now',?)").run(age);
      expect(await processItem(order, item(), undefined, database)).toBe(false);
      expect(mock).toHaveBeenCalledTimes(2);
    }
    fixture.sql.exec("UPDATE fulfillment_send_claims SET updated_at=datetime('now','-601 seconds')");
    expect(await processItem(order, item(), undefined, database)).toBe(true);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(ledger()).toMatchObject({ status: "sent", attempt_count: 3, part_count: 1 });
  });

  it("failed ledger access is fail-closed, with no transport", async () => {
    const { order, database } = await setup();
    fixture.control.fail = query => query.includes("fulfillment_send_claims");
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(item().attempt_count).toBe(0);
  });

  it("a sent ledger heals lost settlement using the original shared snapshot after rotation", async () => {
    const { order, database } = await setup();
    fixture.control.fail = query => query.startsWith("UPDATE fulfillment_items SET status='delivered'");
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(ledger().status).toBe("sent");
    const original = String(item().delivered_ciphertext);
    fixture.control.fail = null;
    const { encryptSecret } = await import("@/lib/fulfillment/crypto");
    const replacement = await encryptSecret("ROTATED-DO-NOT-SEND");
    fixture.sql.prepare("UPDATE product_variants SET shared_secret_ciphertext=?,shared_secret_iv=?").run(replacement.ciphertext, replacement.iv);
    expect(await processItem(order, item(), undefined, database)).toBe(true);
    expect(item().delivered_ciphertext).toBe(original);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("explicit owner fetch and admin handover bypass the automatic ledger", async () => {
    const { order, database } = await setup();
    expect(await processItem(order, item(), undefined, database)).toBe(true);
    const { resendTelegramCredentials } = await import("@/lib/telegram/credential-delivery");
    expect(await resendTelegramCredentials(String(order.code), 12345, database)).toBe(1);
    // Existing admin handover notification uses its own handover notice key.
    fixture.sql.exec("UPDATE fulfillment_items SET delivered_message_id='manual'");
    const { notifyBuyerHandover } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerHandover(String(order.code), database)).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(ledger().attempt_count).toBe(1);
  });

  it("multipart retries resume only unacknowledged parts, and reject a changed payload", async () => {
    const { database } = await setup();
    const fence = lease();
    const send = vi.fn().mockResolvedValueOnce({ ok: true, messageId: "1" }).mockResolvedValueOnce({ ok: false, definiteFailure: true });
    await expect(sendFencedCredential(database, 1, fence, "telegram", ["a", "b"], send)).rejects.toThrow("credential_send_rejected");
    expect(ledger()).toMatchObject({ status: "failed", part_count: 1 });
    await expect(sendFencedCredential(database, 1, fence, "telegram", ["changed", "b"], send)).rejects.toThrow("credential_send_payload_changed");
    send.mockResolvedValue({ ok: true, messageId: "2" });
    expect(await sendFencedCredential(database, 1, fence, "telegram", ["a", "b"], send)).toBe("2");
    expect(send.mock.calls.map(args => args[0])).toEqual(["a", "b", "b"]);
  });

  it("stops starting parts after 30s and resumes progress on the next invocation", async () => {
    const { database } = await setup();
    const fence = lease();
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const send = vi.fn(async () => { clock += 10_000; return { ok: true, messageId: "part" }; });
    await expect(sendFencedCredential(database, 1, fence, "telegram", ["a", "b", "c", "d"], send)).rejects.toBeInstanceOf(CredentialSendDeferred);
    expect(send).toHaveBeenCalledTimes(3);
    expect(ledger()).toMatchObject({ status: "failed", part_count: 3 });
    await sendFencedCredential(database, 1, fence, "telegram", ["a", "b", "c", "d"], send);
    expect(send.mock.calls).toHaveLength(4);
    expect(ledger().status).toBe("sent");
  });

  it("fences stale item owners and stale send checkpoint writes", async () => {
    const { database } = await setup();
    const old = lease();
    const current = new Date(Date.now() + 59_000).toISOString();
    fixture.sql.prepare("UPDATE fulfillment_items SET locked_until=?").run(current);
    const send = vi.fn(async () => ({ ok: true }));
    await expect(sendFencedCredential(database, 1, old, "telegram", ["a"], send)).rejects.toBeInstanceOf(CredentialSendDeferred);
    expect(send).not.toHaveBeenCalled();
    await expect(sendFencedCredential(database, 1, current, "telegram", ["a"], async () => {
      fixture.sql.exec("UPDATE fulfillment_send_claims SET token='new-owner',status='sent',message_id='winner'");
      return { ok: true, messageId: "stale" };
    })).rejects.toBeInstanceOf(CredentialSendDeferred);
    expect(ledger().message_id).toBe("winner");
  });

  it("explicit direct send remains unfenced", async () => {
    const { database } = await setup();
    await sendToRecipient("telegram", "12345", "C0-FIXTURE", "details", 1, database);
    await sendToRecipient("telegram", "12345", "C0-FIXTURE", "details", 1, database);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(ledger()).toBeUndefined();
  });

  it("WhatsApp 500 without outcomeUnknown is still ambiguous, not an immediate retry", async () => {
    const { order, database } = await setup("whatsapp");
    vi.mocked(sendTextMessage).mockResolvedValue({ ok: false, outcomeUnknown: false, error: "send_failed" });
    await processItem(order, item(), undefined, database);
    await processItem(order, item(), undefined, database);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(ledger().status).toBe("sending");
  });

  it("a successful send whose checkpoint fails remains sending until the stale window", async () => {
    const { order, database } = await setup();
    fixture.control.fail = query => query.startsWith("UPDATE fulfillment_send_claims SET part_count");
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(ledger().status).toBe("sending");
    fixture.control.fail = null;
    expect(await processItem(order, item(), undefined, database)).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("stale ambiguous claims cannot cause unlimited automatic sends", async () => {
    const { order, database } = await setup();
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false });
    await processItem(order, item(), undefined, database);
    fixture.sql.exec("UPDATE fulfillment_send_claims SET attempt_count=5,updated_at=datetime('now','-601 seconds')");
    await processItem(order, item(), undefined, database);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(item().last_error).toBe("credential_send_attempts_exhausted");
  });

  it("native Telegram text timeout is 10s, below the automatic start-window + claim TTL", async () => {
    vi.useFakeTimers();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-only");
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const real = await vi.importActual<typeof import("@/lib/telegram/api")>("@/lib/telegram/api");
    const request = real.sendMessage({ chat_id: "12345", text: "fixture" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await request).toMatchObject({ ok: false, description: "Request timeout" });
  });

  it("native WhatsApp text transport uses AbortSignal.timeout(15000)", async () => {
    vi.stubEnv("WHATSAPP_GATEWAY_URL", "https://fixture.test");
    vi.stubEnv("WHATSAPP_WEBHOOK_TOKEN", "fixture-only");
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, id: "wa-native" })));
    const real = await vi.importActual<typeof import("@/lib/whatsapp/gateway")>("@/lib/whatsapp/gateway");
    expect(await real.sendTextMessage({ target: "628000000000", message: "fixture" })).toMatchObject({ ok: true });
    expect(timeout).toHaveBeenCalledWith(15_000);
  });
});
