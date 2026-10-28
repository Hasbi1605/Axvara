// tests/buyer-pin-email.integration.test.ts — Email PIN akses checkout.
//
// PIN 6 alfanumerik dikirim lewat email privat segera setelah order dibuat.
// Seluruh jaringan dimock (SQLite fixture + fetch/mocks); tidak ada email,
// pesan, atau transaksi aktual.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  ACCESS_PIN_EMAIL_PREFIX,
  ACCESS_PIN_MAX_ATTEMPTS,
  accessPinEmailKey,
  credentialAccessEmailStatement as checkoutPinEmailStatement,
  processCredentialAccessEmails,
  sanitizeAccessPinError,
  scheduleCredentialAccessEmail as scheduleCheckoutPinEmail,
} from "@/lib/orders/access-email";
import { deriveOrderAccessCode } from "@/lib/order-access";

const SECRET = "a14-test-only-buyer-access-secret";
const PIN_CODE = "AXV-20261027-PINM0101";
const LEGACY_CODE = "AXV-20261027-LEGACY01";
const CODE26_CODE = "AXV-20261027-C26FMT01";
const WA_CODE = "AXV-20261027-WASKIP01";
const NOEMAIL_CODE = "AXV-20261027-NOMAIL01";
const ROT_CODE = "AXV-20261027-ROTV2X01";

type MailArgs = {
  to: string; subject: string; html: string; text: string; timeoutMs?: number; idempotencyKey?: string;
};
type MailResult = { ok: boolean; providerId?: string; error?: string };
const recorded: { headers: Record<string, string>; idempotencyKey?: string }[] = [];
const { sendForwardEmail, isForwardEmailConfigured } = vi.hoisted(() => ({
  sendForwardEmail: vi.fn(async (params: MailArgs): Promise<MailResult> => {
    recorded.push({ headers: {}, idempotencyKey: params.idempotencyKey });
    return { ok: true, providerId: "res_a14" };
  }),
  isForwardEmailConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail, isForwardEmailConfigured }));

let fx: ReturnType<typeof createD1Fixture>;
let sealed: { ciphertext: string; iv: string };

function seedOrder(code: string, opts: {
  channel?: string; version?: number | null; format?: string | null; email?: string | null;
} = {}) {
  fx.sql.prepare("INSERT OR IGNORE INTO products(id,name,slug,price,stock) VALUES(1,'CapCut Pro','capcut-pro',7500,10)").run();
  fx.sql.prepare("INSERT OR IGNORE INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(1,1,'WR-VAR1','Pro 7 Hari',7500,10,'manual')").run();
  fx.sql.prepare(
    `INSERT INTO orders(code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,sales_channel,fulfillment_status,variant_id,paid_at)
     VALUES(?,?,?,?,?,?,?,'pending','unpaid',?,'not_required',1,NULL)`,
  ).run(code, "Buyer", "628000000000", opts.email === undefined ? "buyer@example.test" : opts.email,
    JSON.stringify([{ product_id: 1, variant_id: 1, name: "CapCut Pro", price: 7500, qty: 1 }]),
    7500, "qris", opts.channel ?? "web");
  const version = opts.version === undefined ? 1 : opts.version;
  if (version === null) {
    fx.sql.prepare(`UPDATE orders SET buyer_access_version=NULL WHERE code=?`).run(code);
  } else {
    fx.sql.prepare(`UPDATE orders SET buyer_access_version=? WHERE code=?`).run(version, code);
  }
  const format = opts.format === undefined ? "pin6" : opts.format;
  if (format === null) {
    fx.sql.prepare(`UPDATE orders SET buyer_access_format=NULL WHERE code=?`).run(code);
  } else {
    fx.sql.prepare(`UPDATE orders SET buyer_access_format=? WHERE code=?`).run(format, code);
  }
  fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(code);
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_ciphertext,delivered_iv)
    VALUES(?,0,1,1,1,'shared','web','delivered',?,?)`).run(code, sealed.ciphertext, sealed.iv);
}

function queueFor(code: string, version = 1) {
  const db = createDatabaseAccess(fx.db);
  fx.db.batch([checkoutPinEmailStatement(fx.db, code)]);
  void db;
  return accessPinEmailKey(code, version);
}

function rows(key?: string): Record<string, unknown>[] {
  return (key
    ? fx.sql.prepare("SELECT * FROM buyer_notice_log WHERE idempotency_key=?").all(key)
    : fx.sql.prepare("SELECT * FROM buyer_notice_log").all()) as Record<string, unknown>[];
}

beforeEach(async () => {
  fx = createD1Fixture();
  // clearAllMocks hanya menghapus calls — implementation mockResolvedValue
  // dari test sebelumnya bertahan; reset penuh + default sukses di sini.
  sendForwardEmail.mockReset();
  sendForwardEmail.mockImplementation(async (params: MailArgs): Promise<MailResult> => {
    recorded.push({ headers: {}, idempotencyKey: params.idempotencyKey });
    return { ok: true, providerId: "res_a14" };
  });
  isForwardEmailConfigured.mockReset();
  isForwardEmailConfigured.mockReturnValue(true);
  recorded.length = 0;
  vi.stubEnv("BUYER_ORDER_ACCESS_SECRET", SECRET);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  sealed = await (await import("@/lib/fulfillment/crypto")).encryptSecret("INLINE-EMAIL-CREDENTIAL-FIXTURE");
  vi.stubEnv("SITE_URL", "https://axvara.tech");
  vi.stubEnv("RESEND_API_KEY", "re_fixture");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.tech");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("derive: pin6 hanya untuk format pin6", () => {
  it("order pin6 menurunkan 6 alfanumerik stabil; code26 tetap 26", async () => {
    const pin = await deriveOrderAccessCode({ code: PIN_CODE, buyer_access_version: 1, buyer_access_format: "pin6" });
    expect(pin).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(await deriveOrderAccessCode({ code: PIN_CODE, buyer_access_version: 1, buyer_access_format: "pin6" })).toBe(pin);
    const old = await deriveOrderAccessCode({ code: PIN_CODE, buyer_access_version: 1, buyer_access_format: "code26" });
    expect(old).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/);
  });

  it("format hilang pada versi>=1 melempar fail-closed", async () => {
    await expect(deriveOrderAccessCode({ code: PIN_CODE, buyer_access_version: 1 })).rejects.toThrow("buyer_access_metadata_unavailable");
  });
});

describe("queue: idempoten dan selektif", () => {
  it("statement antre tepat satu baris failed/attempts0/errorNULL; run ulang idempoten", () => {
    seedOrder(PIN_CODE);
    fx.db.batch([checkoutPinEmailStatement(fx.db, PIN_CODE)]);
    fx.db.batch([checkoutPinEmailStatement(fx.db, PIN_CODE)]);
    const found = rows(accessPinEmailKey(PIN_CODE, 1));
    expect(found).toHaveLength(1);
    expect(found[0].status).toBe("failed");
    expect(Number(found[0].access_attempts)).toBe(0);
    expect(found[0].error).toBeNull();
    expect(String(found[0].idempotency_key)).toBe(`${ACCESS_PIN_EMAIL_PREFIX}${PIN_CODE}:v1`);
  });

  it("legacy v0, format code26, kanal WA, tanpa email tidak antre", () => {
    seedOrder(LEGACY_CODE, { version: 0, format: "code26" });
    seedOrder(CODE26_CODE, { version: 1, format: "code26" });
    seedOrder(WA_CODE, { channel: "whatsapp" });
    seedOrder(NOEMAIL_CODE, { email: "" });
    for (const code of [LEGACY_CODE, CODE26_CODE, WA_CODE, NOEMAIL_CODE]) {
      fx.db.batch([checkoutPinEmailStatement(fx.db, code)]);
    }
    expect(rows()).toHaveLength(0);
  });
});

describe("resend admin: PIN hanya bersama kredensial", () => {
  it("email memuat kredensial lengkap dan PIN pada pesan yang sama", async () => {
    seedOrder(PIN_CODE);
    const db = createDatabaseAccess(fx.db);
    const key = queueFor(PIN_CODE);
    const out = await processCredentialAccessEmails(db, 2);
    expect(out).toEqual({ sent: 1, failed: 0 });
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
    const mail = sendForwardEmail.mock.calls[0][0] as MailArgs;
    const pin = await deriveOrderAccessCode({ code: PIN_CODE, buyer_access_version: 1, buyer_access_format: "pin6" });
    expect(pin).toHaveLength(6);
    expect(mail.to).toBe("buyer@example.test");
    expect(mail.subject).toContain(PIN_CODE);
    // PIN dirender sekali via blok buyerAccessCode (HTML besar + baris text).
    expect(mail.text).toContain(`PIN Akses Pesanan: ${pin}`);
    expect(mail.html).toContain(`<b>${pin}</b>`);
    expect(mail.text).toContain(`/pesanan/${PIN_CODE}`);
    // Status-netral: boleh rotate/retry sesudah paid — tanpa klaim status.
    expect(mail.text).not.toContain("lunas");
    expect(mail.text).not.toContain("telah dibayar");
    expect(mail.text).not.toContain("menunggu pembayaran");
    expect(mail.text).toContain("INLINE-EMAIL-CREDENTIAL-FIXTURE");
    expect(mail.html).toContain("INLINE-EMAIL-CREDENTIAL-FIXTURE");
    // Link tanpa PIN di query.
    expect(mail.html).not.toContain("access_code");
    expect(mail.text).not.toContain("access_code");
    // Header idempotensi stabil dari order+versi (BUKAN PIN).
    expect(mail.idempotencyKey).toMatch(new RegExp(`^axvara-credential-access:${PIN_CODE}:v1:[a-f0-9]{32}$`));
    expect(recorded[0]?.idempotencyKey).toBe(mail.idempotencyKey);
    // Log: sent + provider + tanpa PIN/isi email.
    const [row] = rows(key);
    expect(row.status).toBe("sent");
    expect(row.provider_id).toBe("res_a14");
    expect(row.error).toBeNull();
    expect(JSON.stringify(rows())).not.toContain(pin);
  });

  it("pengiriman kedua idempoten (tidak kirim ulang)", async () => {
    seedOrder(PIN_CODE);
    const db = createDatabaseAccess(fx.db);
    queueFor(PIN_CODE);
    expect(await processCredentialAccessEmails(db, 2)).toEqual({ sent: 1, failed: 0 });
    expect(await processCredentialAccessEmails(db, 2)).toEqual({ sent: 0, failed: 0 });
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  });

  it("WA / non-pin6 / tanpa-email / legacy di-exhaust tanpa kirim", async () => {
    seedOrder(WA_CODE, { channel: "whatsapp" });
    seedOrder(CODE26_CODE, { version: 1, format: "code26" });
    seedOrder(NOEMAIL_CODE, { email: "bukan-email" });
    seedOrder(LEGACY_CODE, { version: 0, format: "code26" });
    const db = createDatabaseAccess(fx.db);
    const keys: string[] = [];
    // Antre manual agar jalur settle diuji walau SELECT statement menolak.
    for (const [code, version] of [[WA_CODE, 1], [CODE26_CODE, 1], [NOEMAIL_CODE, 1], [LEGACY_CODE, 0]] as const) {
      const key = `${ACCESS_PIN_EMAIL_PREFIX}${code}:v${version}`;
      keys.push(key);
      fx.sql.prepare(
        `INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status,access_attempts,error) VALUES(?,?,'email','failed',0,NULL)`,
      ).run(key, code);
    }
    for (const [code, version] of [[WA_CODE, 1], [CODE26_CODE, 1], [NOEMAIL_CODE, 1], [LEGACY_CODE, 0]] as const) {
      expect(await processCredentialAccessEmails(db, 2, code), code).toEqual({ sent: 0, failed: 1 });
    }
    expect(sendForwardEmail).not.toHaveBeenCalled();
    for (const key of keys) {
      const [row] = rows(key);
      expect(Number(row.access_attempts)).toBe(ACCESS_PIN_MAX_ATTEMPTS);
      expect(row.status).toBe("failed");
    }
  });

  it("penerima salah (format email invalid) di-exhaust dengan tag finite", async () => {
    seedOrder(NOEMAIL_CODE, { email: "not-an-email" });
    const db = createDatabaseAccess(fx.db);
    fx.sql.prepare(
      `INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status,access_attempts,error) VALUES(?,?,'email','failed',0,NULL)`,
    ).run(accessPinEmailKey(NOEMAIL_CODE, 1), NOEMAIL_CODE);
    const out = await processCredentialAccessEmails(db, 2, NOEMAIL_CODE);
    expect(out.sent).toBe(0);
    const [row] = rows(accessPinEmailKey(NOEMAIL_CODE, 1));
    expect(row.error).toBe("ineligible_recipient");
    expect(Number(row.access_attempts)).toBe(5);
  });
});

describe("konkurensi: satu pemenang, fence lease basi", () => {
  it("dua worker paralel: tepat satu kirim", async () => {
    seedOrder(PIN_CODE);
    const db = createDatabaseAccess(fx.db);
    queueFor(PIN_CODE);
    const winner = await db.execRun(
      `UPDATE buyer_notice_log SET status='sending', access_lease='lease-other', updated_at=datetime('now')
        WHERE idempotency_key=? AND status='failed'`,
      accessPinEmailKey(PIN_CODE, 1),
    );
    expect(Number(winner.changes)).toBe(1);
    // Worker kedua kalah CAS → tidak kirim.
    expect(await processCredentialAccessEmails(db, 2, PIN_CODE)).toEqual({ sent: 0, failed: 0 });
    expect(sendForwardEmail).not.toHaveBeenCalled();
    // Lease basi (>10 mnt) direclaim tepat satu lalu dikirim sekali.
    fx.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now','-11 minutes') WHERE idempotency_key=?")
      .run(accessPinEmailKey(PIN_CODE, 1));
    expect(await processCredentialAccessEmails(db, 2, PIN_CODE)).toEqual({ sent: 1, failed: 0 });
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  });

  it("late worker dengan lease basi tidak menutup kirim pemenang (fenced)", async () => {
    seedOrder(PIN_CODE);
    const db = createDatabaseAccess(fx.db);
    queueFor(PIN_CODE);
    expect(await processCredentialAccessEmails(db, 2, PIN_CODE)).toEqual({ sent: 1, failed: 0 });
    // Late ACK dengan lease salah tidak boleh mengubah baris sent.
    const ack = await db.execRun(
      `UPDATE buyer_notice_log SET status='failed', error='late' WHERE idempotency_key=? AND access_lease=?`,
      accessPinEmailKey(PIN_CODE, 1), "stale-lease",
    );
    expect(Number(ack.changes)).toBe(0);
    const [row] = rows(accessPinEmailKey(PIN_CODE, 1));
    expect(row.status).toBe("sent");
  });
});

describe("provider: retry bounded + idempotency stabil + defer offline", () => {
  it("gagal provider memakai key sama, attempts+backoff, habis di 5", async () => {
    seedOrder(PIN_CODE);
    const db = createDatabaseAccess(fx.db);
    queueFor(PIN_CODE);
    sendForwardEmail.mockResolvedValue({ ok: false, error: "resend_500" });
    vi.stubEnv("RESEND_API_KEY", "re_fixture");
    const first = await processCredentialAccessEmails(db, 2, PIN_CODE);
    expect(first).toEqual({ sent: 0, failed: 1 });
    let [row] = rows(accessPinEmailKey(PIN_CODE, 1));
    expect(Number(row.access_attempts)).toBe(1);
    expect(row.error).toBe("resend_500");
    const firstKey = sendForwardEmail.mock.calls[0][0].idempotencyKey;
    expect(firstKey).toMatch(new RegExp(`^axvara-credential-access:${PIN_CODE}:v1:[a-f0-9]{32}$`));
    // Belum due (backoff 1 mnt) → tidak dikirim ulang.
    expect(await processCredentialAccessEmails(db, 2, PIN_CODE)).toEqual({ sent: 0, failed: 0 });
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
    // Majukan waktu retry → due lagi dengan key stabil yang sama.
    fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?")
      .run(accessPinEmailKey(PIN_CODE, 1));
    await processCredentialAccessEmails(db, 2, PIN_CODE);
    expect(sendForwardEmail.mock.calls[1][0].idempotencyKey).toBe(firstKey);
    // Paksa hingga exhausted: attempts berhenti di 5.
    for (let i = 0; i < 3; i++) {
      fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?")
        .run(accessPinEmailKey(PIN_CODE, 1));
      await processCredentialAccessEmails(db, 2, PIN_CODE);
    }
    [row] = rows(accessPinEmailKey(PIN_CODE, 1));
    expect(Number(row.access_attempts)).toBe(5);
    expect(row.access_retry_at).toBeNull();
    expect(await processCredentialAccessEmails(db, 2, PIN_CODE)).toEqual({ sent: 0, failed: 0 });
  });

  it("pesan provider mentah disanitasi; PIN tidak masuk log", async () => {
    seedOrder(PIN_CODE);
    queueFor(PIN_CODE);
    sendForwardEmail.mockResolvedValue({ ok: false, error: "boom secret AXV-1 with PIN 9Q8XYZ and PII buyer@example.test" });
    const db = createDatabaseAccess(fx.db);
    await processCredentialAccessEmails(db, 2, PIN_CODE);
    const [row] = rows(accessPinEmailKey(PIN_CODE, 1));
    expect(row.error).toBe("send_failed");
    expect(sanitizeAccessPinError("resend_429")).toBe("resend_429");
    expect(JSON.stringify(row)).not.toContain("boom");
  });

  it("Resend tak terkonfigurasi: tunda tanpa makan budget retry", async () => {
    seedOrder(PIN_CODE);
    queueFor(PIN_CODE);
    isForwardEmailConfigured.mockReturnValue(false);
    const db = createDatabaseAccess(fx.db);
    const out = await processCredentialAccessEmails(db, 2, PIN_CODE);
    expect(out).toEqual({ sent: 0, failed: 0 });
    expect(sendForwardEmail).not.toHaveBeenCalled();
    const [row] = rows(accessPinEmailKey(PIN_CODE, 1));
    expect(Number(row.access_attempts)).toBe(0);
    expect(row.status).toBe("failed");
  });
});

describe("rotasi: versi lama superseded, PIN baru tidak di key lama", () => {
  it("order naik v1→v2: job v1 exhausted superseded; job v2 mengirim PIN v2", async () => {
    seedOrder(ROT_CODE, { version: 1 });
    queueFor(ROT_CODE, 1);
    fx.sql.prepare("UPDATE orders SET buyer_access_version=2 WHERE code=?").run(ROT_CODE);
    const db = createDatabaseAccess(fx.db);
    expect(await processCredentialAccessEmails(db, 2, ROT_CODE)).toEqual({ sent: 0, failed: 1 });
    const [old] = rows(accessPinEmailKey(ROT_CODE, 1));
    expect(old.error).toBe("superseded");
    expect(sendForwardEmail).not.toHaveBeenCalled();
    fx.db.batch([checkoutPinEmailStatement(fx.db, ROT_CODE)]);
    expect(await processCredentialAccessEmails(db, 2, ROT_CODE)).toEqual({ sent: 1, failed: 0 });
    const mail = sendForwardEmail.mock.calls[0][0] as MailArgs;
    const pinV2 = await deriveOrderAccessCode({ code: ROT_CODE, buyer_access_version: 2, buyer_access_format: "pin6" });
    const pinV1 = await deriveOrderAccessCode({ code: ROT_CODE, buyer_access_version: 1, buyer_access_format: "pin6" });
    expect(pinV2).not.toBe(pinV1);
    expect(mail.text).toContain(`PIN Akses Pesanan: ${pinV2}`);
    expect(mail.text).not.toContain(pinV1);
    expect(mail.idempotencyKey).toMatch(new RegExp(`^axvara-credential-access:${ROT_CODE}:v2:[a-f0-9]{32}$`));
  });
});

it("never drains historical PIN-only jobs, even for an order whose credentials are ready", async () => {
  seedOrder(PIN_CODE);
  fx.sql.prepare("INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status) VALUES(?,?,'email','failed')").run(`email:access_pin:${PIN_CODE}:v1`, PIN_CODE);
  expect(await processCredentialAccessEmails(createDatabaseAccess(fx.db), 2)).toEqual({ sent: 0, failed: 0 });
  expect(sendForwardEmail).not.toHaveBeenCalled(); expect(rows()).toHaveLength(1);
});

it("never queues an email for an unpaid order or without available credentials", () => {
  seedOrder(PIN_CODE); fx.sql.prepare("UPDATE orders SET status='pending',payment_status='pending' WHERE code=?").run(PIN_CODE);
  queueFor(PIN_CODE); expect(rows()).toHaveLength(0);
  fx.sql.prepare("UPDATE orders SET status='lunas',payment_status='paid' WHERE code=?").run(PIN_CODE);
  fx.sql.prepare("DELETE FROM fulfillment_items WHERE order_code=?").run(PIN_CODE);
  queueFor(PIN_CODE); expect(rows()).toHaveLength(0);
});

it("changed credential content gets a new opaque provider key while identical retries dedupe", async () => {
  seedOrder(PIN_CODE); const db = createDatabaseAccess(fx.db); const key = queueFor(PIN_CODE);
  sendForwardEmail.mockResolvedValue({ ok: false, error: "resend_timeout" });
  await processCredentialAccessEmails(db, 2);
  const first = sendForwardEmail.mock.calls[0][0];
  const next = await (await import("@/lib/fulfillment/crypto")).encryptSecret("NEW-CREDENTIAL-FIXTURE");
  fx.sql.prepare("UPDATE fulfillment_items SET delivered_ciphertext=?,delivered_iv=? WHERE order_code=?").run(next.ciphertext, next.iv, PIN_CODE);
  fx.sql.prepare("UPDATE buyer_notice_log SET access_retry_at=datetime('now','-1 minute') WHERE idempotency_key=?").run(key);
  await processCredentialAccessEmails(db, 2);
  const second = sendForwardEmail.mock.calls[1][0];
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(second.text).toContain("NEW-CREDENTIAL-FIXTURE");
  expect(JSON.stringify(rows())).not.toContain("NEW-CREDENTIAL-FIXTURE");
});

it("persists attempts before sending and stops at five even if every final settle is lost", async () => {
  seedOrder(PIN_CODE); const db = createDatabaseAccess(fx.db); const key = queueFor(PIN_CODE);
  fx.control.fail = sql => sql.includes("SET status='sent'");
  sendForwardEmail.mockImplementation(async () => {
    expect(Number(rows(key)[0].access_attempts)).toBe(sendForwardEmail.mock.calls.length);
    return { ok: true, providerId: "fixture-ambiguous" };
  });
  for (let i = 0; i < 7; i++) {
    await processCredentialAccessEmails(db, 2);
    fx.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now','-11 minutes') WHERE idempotency_key=?").run(key);
  }
  expect(sendForwardEmail).toHaveBeenCalledTimes(5);
  expect(Number(rows(key)[0].access_attempts)).toBe(5);
});

it("does not start another email when its network timeout no longer fits the cron deadline", async () => {
  seedOrder(PIN_CODE); seedOrder(ROT_CODE); queueFor(PIN_CODE); queueFor(ROT_CODE);
  let timeLeft = 10_000;
  sendForwardEmail.mockImplementation(async () => { timeLeft = 1_000; return { ok: true, providerId: "fixture" }; });
  const out = await processCredentialAccessEmails(createDatabaseAccess(fx.db), 2, undefined, { hasTime: need => timeLeft >= need });
  expect(out.sent).toBe(1); expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  expect(rows().filter(row => Number(row.access_attempts) === 0)).toHaveLength(1);
});

describe("kontrak scheduler + klaim lama utuh", () => {
  it("scheduleCheckoutPinEmail menunggu task yang sama di dev/test", async () => {
    seedOrder(PIN_CODE);
    queueFor(PIN_CODE);
    await scheduleCheckoutPinEmail(PIN_CODE);
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  });

  it("claimNotice lama tetap: failed boleh reclaim, sent tidak", async () => {
    seedOrder(PIN_CODE);
    const db = createDatabaseAccess(fx.db);
    const { claimNotice } = await import("@/lib/notify-buyer");
    expect(await claimNotice(db, "email:legacy-check", PIN_CODE, "email")).toBe(true);
    expect(await claimNotice(db, "email:legacy-check", PIN_CODE, "email")).toBe(false);
  });
});
