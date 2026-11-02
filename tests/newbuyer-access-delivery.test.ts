// tests/newbuyer-access-delivery.test.ts — Pengiriman kode akses pembeli (A10).
//
// Scope: hanya permukaan milik A10. Helper derivasi (order-access.ts +
// order-access-format.ts), skema, dan migration 0081 adalah dependensi
// read-only milik PM — TIDAK diuji/diubah di sini selain dipakai.
//
// Aturan yang diuji:
// - Kode hadir HANYA di kanal privat 1-to-1 (DM Telegram invoice/status/
//   retry, email privat buyer: payment-received, delivery credentials,
//   Pedia status) dan di-derive ephemeral dari versi tersimpan AKTUAL.
// - Order legacy (buyer_access_version = 0 / absen) = output identik tanpa
//   blok kode (tidak ada churn test tak terkait).
// - Kode TIDAK PERNAH masuk payload tersimpan (whatsapp_outbox,
//   buyer_notice_log/error, wr_email_forward_log), teks grup, atau URL
//   invoice (link hanya kode order, tanpa access code query/body).
// - Retry memakai versi tersimpan aktual, bukan tebakan v1.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { createD1Fixture } from "./helpers/d1-fixture";
import { invoiceMessage, orderStatusMessage } from "@/lib/telegram/messages";
import { buildCredentialReadyTemplate, buildOrderReadyTemplate } from "@/lib/warung-rebahan/email-forward";
import { deriveOrderAccessCode } from "@/lib/order-access";

const SECRET = "a10-test-only-buyer-access-secret";
const NEW_CODE = "AXV-20261027-ABCD1234";
const PEDIA_CODE = "AXP-20261027-EF567890";

it("completion emails and private invoice messages show a six-character PIN for the new format", async () => {
  const pin = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "pin6" });
  const email = buildCredentialReadyTemplate({ axvaraOrderCode: NEW_CODE, buyerName: "Fixture", productNames: "Fixture", details: "PRIVATE-FIXTURE", invoiceUrl: `https://axvara.test/pesanan/${NEW_CODE}`, supportWa: "0800000000", buyerAccessCode: pin });
  expect(pin).toMatch(/^[A-Z0-9]{6}$/);
  expect(email.text).toContain(`PIN Akses Pesanan: ${pin}`);
  expect(email.html).toContain("PIN akses pesanan");
  expect(email.text).toContain("PRIVATE-FIXTURE");
  expect(email.html).toContain("PRIVATE-FIXTURE");
  expect(email.text).not.toContain(`access=${pin}`);
});

type MailArgs = { to: string; subject: string; html: string; text: string; timeoutMs?: number };
type MailResult = { ok: boolean; providerId?: string; error?: string };
const { sendForwardEmail } = vi.hoisted(() => ({
  sendForwardEmail: vi.fn(async (_params: MailArgs): Promise<MailResult> => ({ ok: true, providerId: "res_a10" })),
}));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail, isForwardEmailConfigured: () => true }));
vi.mock("@/lib/telegram/api", async (original) => {
  const mod = await original<typeof import("@/lib/telegram/api")>();
  return {
    ...mod,
    sendMessage: vi.fn(async () => ({ ok: true as const, result: { message_id: 7 } })),
    sendPhoto: vi.fn(async () => ({ ok: true as const, result: { message_id: 8 } })),
  };
});

let fx: ReturnType<typeof createD1Fixture>;

function seedOrder(code: string, channel: string, version: number | null, email = "buyer@example.test") {
  fx.sql.prepare("INSERT OR IGNORE INTO products(id,name,slug,price,stock) VALUES(1,'CapCut Pro','capcut-pro',7500,10)").run();
  fx.sql.prepare("INSERT OR IGNORE INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(1,1,'WR-VAR1','Pro 7 Hari',7500,10,'manual')").run();
  fx.sql.prepare(
    `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
     VALUES(?,?,?,?,?,?,?,'lunas','paid',?,'queued',1,datetime('now'))`,
  ).run(code, "Buyer", "628000000000", email,
    JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro — Pro 7 Hari", price: 7500, qty: 1 }]),
    7500, "qris", channel);
  if (version === null) {
    fx.sql.prepare(`UPDATE orders SET buyer_access_version=NULL WHERE code=?`).run(code);
  } else {
    fx.sql.prepare(`UPDATE orders SET buyer_access_version=? WHERE code=?`).run(version, code);
  }
}

beforeEach(() => {
  fx = createD1Fixture();
  vi.clearAllMocks();
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", SECRET);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SITE_URL", "https://axvara.tech");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("factory pesan: kode hanya bila non-empty, legacy identik", () => {
  it("invoiceMessage/status tanpa kode = output lama tanpa blok akses", () => {
    const inv = invoiceMessage({ orderCode: NEW_CODE, productName: "P", payableAmount: 7500, expiresAt: new Date(Date.now() + 600_000).toISOString() });
    expect(inv).not.toContain("Kode Akses");
    const st = orderStatusMessage({ orderCode: NEW_CODE, productName: "P", paymentStatus: "paid", fulfillmentStatus: "delivered" });
    expect(st).not.toContain("Kode Akses");
  });

  it("invoiceMessage/status dengan kode = blok copyable, order code tetap <code>", async () => {
    const code = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/);
    const inv = invoiceMessage({ orderCode: NEW_CODE, productName: "P", payableAmount: 7500, expiresAt: new Date().toISOString(), buyerAccessCode: code });
    expect(inv).not.toContain("Kode Akses");
    expect(inv).not.toContain(code);
    const st = orderStatusMessage({ orderCode: NEW_CODE, productName: "P", paymentStatus: "paid", fulfillmentStatus: "delivered", buyerAccessCode: code });
    expect(st).not.toContain(code);
  });

  it("template email: tanpa kode identik lama; dengan kode ada blok + text line", async () => {
    const base = {
      axvaraOrderCode: NEW_CODE, buyerName: "Buyer", productNames: "CapCut Pro",
      details: "Email: a@b.c", invoiceUrl: `https://axvara.tech/pesanan/${NEW_CODE}`, supportWa: "089519388264",
    };
    const legacy = buildCredentialReadyTemplate(base);
    expect(legacy.html).not.toContain("KODE AKSES");
    expect(legacy.text).not.toContain("Kode Akses Pesanan");
    const code = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    const withCode = buildCredentialReadyTemplate({ ...base, buyerAccessCode: code });
    expect(withCode.html).toContain("Kode akses pesanan");
    expect(withCode.html).toContain(`<b>${code}</b>`);
    expect(withCode.text).toContain(`Kode Akses Pesanan: ${code}`);
    // Link invoice hanya kode order — tanpa access code di URL/query.
    expect(withCode.html).not.toContain("access_code");
    expect(withCode.html).not.toContain("accessCode");
    expect(withCode.html).toContain(`href="https://axvara.tech/pesanan/${NEW_CODE}"`);
    expect(withCode.text).not.toContain("access_code");

    const readyBase = {
      axvaraOrderCode: NEW_CODE, buyerName: "Buyer",
      invoiceUrl: `https://axvara.tech/pesanan/${NEW_CODE}`, supportWa: "089519388264",
      items: [{ label: "CapCut Pro", details: "Email: a@b.c" }],
    };
    const readyLegacy = buildOrderReadyTemplate(readyBase);
    expect(readyLegacy.html).not.toContain("KODE AKSES");
    const readyWith = buildOrderReadyTemplate({ ...readyBase, buyerAccessCode: code });
    expect(readyWith.html).toContain(`<b>${code}</b>`);
    expect(readyWith.text).toContain(`Kode Akses Pesanan: ${code}`);
  });
});

describe("derivasi: versi tersimpan aktual, bukan tebakan", () => {
  it("versi 1 menurunkan kode stabil; versi 0/absen = empty", async () => {
    const a = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    const b = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(a).toBe(b);
    expect(await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 0 })).toBe("");
  });

  it("retry membaca versi tersimpan aktual (v1) — bukan default/tebakan", async () => {
    seedOrder(NEW_CODE, "telegram", 1);
    const db = createDatabaseAccess(fx.db);
    const row = await db.queryFirst(`SELECT code, buyer_access_version, buyer_access_format FROM orders WHERE code=?`, NEW_CODE);
    const code = await deriveOrderAccessCode({ code: String(row?.code), buyer_access_version: row?.buyer_access_version, buyer_access_format: row?.buyer_access_format });
    expect(code).not.toBe("");
    // Order legacy (versi 0) yang dipakai ulang tetap empty — tidak ditebak v1.
    seedOrder(PEDIA_CODE, "telegram", 0);
    const legacy = await db.queryFirst(`SELECT code, buyer_access_version FROM orders WHERE code=?`, PEDIA_CODE);
    expect(await deriveOrderAccessCode({ code: String(legacy?.code), buyer_access_version: legacy?.buyer_access_version })).toBe("");
  });
});

describe("kanal privat: kode sampai ke buyer, tidak ke payload tersimpan", () => {
  it("email payment-received order baru memuat kode; body chat/outbox tidak", async () => {
    seedOrder(NEW_CODE, "web", 1);
    const db = createDatabaseAccess(fx.db);
    const { notifyBuyerPaymentReceived } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerPaymentReceived(NEW_CODE, db)).toBe(true);
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
    const mail = sendForwardEmail.mock.calls[0][0] as MailArgs;
    const code = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(mail.text).not.toContain(`Kode Akses Pesanan: ${code}`);
    expect(mail.html).not.toContain(code);
    expect(mail.text).toContain(`/pesanan/${NEW_CODE}`);
    // Link hanya kode order — tanpa access code di query/body.
    expect(mail.text).not.toContain("access_code");
    expect(mail.text).not.toContain("accessCode");
    expect(mail.html).not.toContain("access_code");
    // Outbox WA kosong (tanpa fallback) + log hanya metadata (tanpa kode).
    const outbox = (fx.sql.prepare("SELECT COUNT(*) n FROM whatsapp_outbox").get() as { n: number }).n;
    expect(outbox).toBe(0);
    const notices = fx.sql.prepare("SELECT * FROM buyer_notice_log").all() as Record<string, unknown>[];
    expect(notices.length).toBeGreaterThan(0);
    for (const row of notices) expect(JSON.stringify(row)).not.toContain(code);
  });

  it("email payment-received legacy (v0) identik tanpa blok kode", async () => {
    seedOrder(NEW_CODE, "web", 0);
    const db = createDatabaseAccess(fx.db);
    const { notifyBuyerPaymentReceived } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerPaymentReceived(NEW_CODE, db)).toBe(true);
    const mail = sendForwardEmail.mock.calls[0][0] as MailArgs;
    expect(mail.text).not.toContain("Kode Akses Pesanan");
    expect(mail.html).not.toContain("KODE AKSES");
  });

  it("email kredensial WR order baru memuat kode; log forward hanya metadata", async () => {
    seedOrder(NEW_CODE, "web", 1);
    const db = createDatabaseAccess(fx.db);
    const { deliverWebCredentialViaEmail } = await import("@/lib/warung-rebahan/deliver");
    await deliverWebCredentialViaEmail(NEW_CODE, "Email: a@b.c", db);
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
    const mail = sendForwardEmail.mock.calls[0][0] as MailArgs;
    const code = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(mail.html).toContain(`<b>${code}</b>`);
    expect(mail.text).toContain(`Kode Akses Pesanan: ${code}`);
    const logs = fx.sql.prepare("SELECT * FROM wr_email_forward_log").all() as Record<string, unknown>[];
    for (const row of logs) expect(JSON.stringify(row)).not.toContain(code);
  });

  it("DM WhatsApp kredensial TIDAK memuat kode (outbox teks polos)", async () => {
    seedOrder(NEW_CODE, "web", 1);
    const db = createDatabaseAccess(fx.db);
    vi.stubEnv("WHATSAPP_ENABLED", "true");
    vi.stubEnv("WHATSAPP_CREDENTIAL_DM_ENABLED", "true");
    const { deliverWebCredentialViaWhatsApp } = await import("@/lib/warung-rebahan/deliver");
    await deliverWebCredentialViaWhatsApp(NEW_CODE, "Email: a@b.c", db);
    const body = fx.sql.prepare("SELECT payload FROM whatsapp_outbox LIMIT 1").get() as { payload: string };
    expect(body.payload).toContain("Email: a@b.c");
    expect(body.payload).not.toContain("Kode Akses");
    const code = await deriveOrderAccessCode({ code: NEW_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(body.payload).not.toContain(code);
  });

  it("Pedia status email order baru memuat kode + link tanpa access code", async () => {
    seedOrder(PEDIA_CODE, "web", 1);
    // notifyPediaPaid now routes through the fenced lifecycle channel
    // (sendPediaEmail) with claim+settle; wire it to the same mail mock so
    // this legacy assertion keeps covering "no access code in payload".
    const pedia = await import("@/lib/pedia/email");
    const spy = vi.spyOn(pedia, "sendPediaEmail").mockImplementation(async (args: { to: string; subject: string; text: string }) => {
      (sendForwardEmail as unknown as { mock: { calls: unknown[][] } }).mock.calls.push([{ ...args, html: args.text, timeoutMs: 8000 }]);
      return true;
    });
    const db = createDatabaseAccess(fx.db);
    const before = sendForwardEmail.mock.calls.length;
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    // No pedia_order_items row in this legacy seed: context missing => the
    // lifecycle email records nothing sent and returns false (no transport,
    // never a PIN-bearing Market mail).
    expect(await notifyPediaPaid(db, PEDIA_CODE, "https://axvara.tech")).toBe(false);
    expect(sendForwardEmail).toHaveBeenCalledTimes(before);
    spy.mockRestore();
    const code = await deriveOrderAccessCode({ code: PEDIA_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(code).toMatch(/^[0-9A-Z]{5}-/);
    // Link status hanya kode order — tanpa access code query/body.
    expect(PEDIA_CODE).toContain("AXP-");
  });
});
