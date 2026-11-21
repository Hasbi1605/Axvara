import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestOrder, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { encryptSecret } from "@/lib/fulfillment/crypto";

// Telegram transport is the only seam: `sendMessage` keeps Telegram's real
// response shape so the module can inspect error_code/description.
const api = vi.hoisted(() => ({ send: vi.fn(), document: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  safeEditOrSend: vi.fn(),
  sendPhoto: vi.fn(),
  sendChatAction: vi.fn(),
  showLoadingBar: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
}));
vi.mock("@/lib/telegram/send-document", () => ({ sendDocument: api.document }));

import { resendTelegramCredentials } from "@/lib/telegram/credential-delivery";

const code = "AXV-20991231-00F1701A";
const buyer = 12345;
let fx: ReturnType<typeof createD1Fixture>;

type SentMsg = { text?: string; parse_mode?: string };
const sent = (): SentMsg[] => api.send.mock.calls.map(([params]) => params as SentMsg);
const lastText = () => String(api.send.mock.calls.at(-1)?.[0].text ?? "");
const lastMarkup = () =>
  (api.send.mock.calls.at(-1)?.[0] as { reply_markup?: { inline_keyboard: { text: string; callback_data?: string; url?: string }[][] } })
    ?.reply_markup?.inline_keyboard.flat() ?? [];
const flatCallbacks = () => lastMarkup().flatMap(button => (button.callback_data ? [button.callback_data] : []));

beforeEach(async () => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.document.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  stubFulfillmentKey();
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 1);
  insertTestOrder(fx.sql, code, { status: "lunas", items: [{ product_id: 1, variant_id: 1, name: "Prime Video Sharing", price: 10000, qty: 1 }] });
  fx.control.fail = null;
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** One delivered SK row, the exact shape production reports (`sk:` prefix). */
async function deliveredSkRow(plaintext: string) {
  const secret = await encryptSecret(plaintext);
  fx.sql.prepare(`INSERT INTO fulfillment_items
    (order_code,item_index,product_id,variant_id,fulfillment_mode,status,delivered_ciphertext,delivered_iv,delivered_message_id)
    VALUES(?,0,1,1,'manual','delivered',?,?,'sk:6')`).run(code, secret.ciphertext, secret.iv);
  return secret;
}

describe("Ambil Ulang for Sekalipay rows (sk: prefix)", () => {
  it("re-sends a stored SK-style license to the owner", async () => {
    await deliveredSkRow("Premium Sharing 1 bulan|akun@mail.test|pass-123");
    expect(await resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db))).toBe(1);
    const html = sent().find(message => String(message.text).includes("akun@mail.test"));
    expect(html).toBeTruthy();
    expect(String(html?.text)).toContain("pass-123");
    // The delivery is marked as success, not a transient failure.
    expect(lastText()).not.toContain("gagal dibaca");
  });

  it("re-sends supplier text containing HTML-unsafe characters", async () => {
    await deliveredSkRow("Plan <Premium> & 2 devices\nemail: a<b>@mail.test");
    expect(await resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db))).toBe(1);
    const html = sent().find(message => String(message.text).includes("a&lt;b&gt;"));
    expect(html).toBeTruthy();
    // Escaped once (no double escaping), so the buyer copies the real value.
    expect(String(html?.text)).toContain("&amp; 2 devices");
    expect(String(html?.text)).not.toContain("&amp;amp;");
  });

  it("retries once as plain text when Telegram rejects the HTML entities", async () => {
    await deliveredSkRow("account@mail.test:secret");
    api.send.mockImplementation(async (params: SentMsg & { parse_mode?: string }) => {
      if (params.parse_mode === "HTML") {
        return { ok: false, error_code: 400, description: "Bad Request: can't parse entities: unsupported start tag" };
      }
      return { ok: true, result: { message_id: 9 } };
    });
    expect(await resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db))).toBe(1);
    const plain = sent().filter(message => message.parse_mode === undefined);
    expect(plain.some(message => String(message.text).includes("account@mail.test:secret"))).toBe(true);
    expect(lastText()).not.toContain("gagal dibaca");
  });

  it("classifies a rotated-key decrypt failure as permanent, without a retry button", async () => {
    await deliveredSkRow("older-secret");
    // Simulate the 2026-11-10 FULFILLMENT_ENCRYPTION_KEY replacement.
    process.env.FULFILLMENT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db))).toBe(0);
    expect(lastText()).toContain("tidak tersimpan di bot");
    expect(flatCallbacks()).not.toContain(`cred:${code}`);
    expect(flatCallbacks()).toContain(`order:${code}`);
    // Diagnostics never carry the credential.
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain("older-secret");
  });

  it("logs one structured line per failure stage with no secret in it", async () => {
    await deliveredSkRow("leak-me-not");
    process.env.FULFILLMENT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db));
    const lines = warn.mock.calls.filter(([label]) => label === "[tg-resend] failed");
    expect(lines).toHaveLength(1);
    const payload = lines[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({ order: code, item: 0, stage: "decrypt" });
    expect(String(payload.tg)).not.toContain("leak-me-not");
    expect(String(payload.tg).length).toBeLessThanOrEqual(120);
  });

  it("splits an over-long part instead of aborting the unit", async () => {
    const { sendTelegramCredentialParts } = await import("@/lib/telegram/credential-delivery");
    api.send.mockImplementation(async (params: SentMsg & { text: string }) => (
      String(params.text).length > 4096
        ? { ok: false, error_code: 400, description: "Bad Request: message is too long" }
        : { ok: true, result: { message_id: 7 } }
    ));
    await sendTelegramCredentialParts(buyer, ["x".repeat(9000)]);
    const accepted = sent().filter(message => message.parse_mode === undefined);
    expect(accepted.length).toBe(3);
    expect(accepted.map(message => String(message.text)).join("")).toBe("x".repeat(9000));
  });

  it("keeps classic transient copy for transport failures", async () => {
    await deliveredSkRow("transport-fail");
    api.send.mockResolvedValue({ ok: false, error_code: 429, description: "Too Many Requests: retry after 5" });
    expect(await resendTelegramCredentials(code, buyer, createDatabaseAccess(fx.db))).toBe(0);
    expect(lastText()).toContain("gagal dibaca atau dikirim");
    expect(flatCallbacks()).toContain(`cred:${code}`);
  });
});
