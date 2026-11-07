// tests/pedia-email-locale.integration.test.ts — Email pembeli Pedia mengikuti
// orders.locale (2026-11-07). Default ID identik dengan perilaku sebelumnya;
// EN memakai penerjemah fase A untuk nama layanan. Notis admin tetap ID.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

type MailCall = { to: string; subject: string; text: string; html?: string };
const mails: MailCall[] = [];
const adminMessages: { text: string }[] = [];
vi.mock("@/lib/pedia/email", () => ({
  sendPediaEmail: vi.fn(async (args: MailCall) => { mails.push(args); return true; }),
}));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: vi.fn(async (args: { text: string }) => { adminMessages.push(args); return { ok: true }; }),
}));

const CODE = "AXP-20261107-EMAILLOC";
const EMAIL = "buyer@example.com";

let fx: ReturnType<typeof createD1Fixture>;
afterEach(() => { fx?.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
beforeEach(() => { mails.length = 0; adminMessages.length = 0; vi.unstubAllEnvs(); });

function seed(locale: "id" | "en", itemStatus = "queued", counts: { start?: number; remains?: number; receipt?: boolean } = {}) {
  fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  fx.sql.prepare(`INSERT INTO pedia_products (id, slug, platform, metric, target_kind, name, packages_json, step, is_active)
    VALUES (11,'followers-test','instagram','followers','profile','Followers Test','[100]',10,1)`).run();
  fx.sql.prepare(`INSERT INTO pedia_tiers (id, product_id, tier, supplier, supplier_service_id, price_group,
      markup_pct, min_profit_rp, refill_days, package_prices_json, is_active, eta_start, eta_finish, label_note)
    VALUES (21,11,'standar','indosmm',9475,'G3',20,1000,30,'{"100":5000}',1,'0-4 jam',NULL,'HQ')`).run();
  fx.sql.prepare(`INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, present)
    VALUES ('indosmm',9475,'IG','IG','Default',5000,100,100000,1)`).run();
  fx.sql.prepare(`INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal, payment_method,
      status, payment_status, sales_channel, order_kind, paid_at, buyer_access_version, buyer_access_format, locale)
    VALUES (?, 'Buyer One', '62812', ?, '[]', 10000, 'qris', 'lunas', 'paid', 'web', 'pedia', datetime('now'), 1, 'pin6', ?)`)
    .run(CODE, EMAIL, locale);
  const snapshot = JSON.stringify({
    supplier: "indosmm", supplier_service_id: 9475, refill_days: 30,
    service_copy: {
      product_name: "Followers Instagram",
      service_name: "Followers Global HQ · Akun berpostingan",
      description: "d", terms: "t", instructions: "i",
    },
  });
  fx.sql.prepare(`INSERT INTO pedia_order_items (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
      quantity, unit_price, total, credit_used, supplier, supplier_service_id, supplier_rate_snapshot, status, submit_attempts,
      supplier_order_id, start_count, remains)
    VALUES (?, 11, 21, ?, 'https://instagram.com/x', 'https://instagram.com/x', 1000, 10, 10000, 0, 'indosmm', 9475, 5000, ?, 1, ?, ?, ?)`)
    .run(CODE, snapshot, itemStatus, counts.receipt === false ? null : "SUP-1", counts.start ?? 100, counts.remains ?? 100);
  return db;
}

describe("Email pembeli Pedia ID/EN", () => {
  it("paid ID: subject + body Indonesia identik dengan perilaku lama", async () => {
    const db = seed("id");
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    expect(await notifyPediaPaid(db, CODE)).toBe(true);
    const mail = mails.at(-1)!;
    expect(mail.subject).toBe(`Pembayaran diterima — ${CODE}`);
    expect(mail.text).toContain("Pembayaran Diterima");
    expect(mail.text).toContain("Halo Buyer,");
    expect(mail.text).toContain("Jumlah dipesan: 1.000");
    expect(mail.text).toContain("Butuh bantuan?");
    expect(mail.text).toContain("Email otomatis dari Axvara, mohon jangan dibalas.");
  });

  it("paid EN: subject, body, detail, footer, dan nama layanan EN", async () => {
    const db = seed("en");
    const { notifyPediaPaid } = await import("@/lib/pedia/notify");
    expect(await notifyPediaPaid(db, CODE)).toBe(true);
    const mail = mails.at(-1)!;
    expect(mail.subject).toBe(`Payment received — ${CODE}`);
    expect(mail.text).toContain("Payment Received");
    expect(mail.text).toContain("Hi Buyer, we have received your payment for your Pedia order.");
    expect(mail.text).toContain("Quantity ordered: 1,000");
    expect(mail.text).toContain("Followers Global HQ · Accounts with posts");
    expect(mail.text).toContain("Estimated start: 0-4 hours after payment");
    expect(mail.text).toContain("Need help? WA");
    expect(mail.text).toContain("Automated email from Axvara, please do not reply.");
    expect(mail.html).toContain('lang="en"');
    expect(mail.html).toContain("Contact us on WhatsApp");
    expect(mail.html).not.toContain("Butuh bantuan?");
  });

  it("processing & completed EN memakai subject/status EN", async () => {
    const db = seed("en", "submitted");
    const { notifyPediaProcessing } = await import("@/lib/pedia/notify");
    expect(await notifyPediaProcessing(db, CODE)).toBe(true);
    expect(mails.at(-1)!.subject).toBe(`Order processing — ${CODE}`);
    expect(mails.at(-1)!.text).toContain("your Pedia order has been accepted and is being processed automatically.");

    fx.sql.prepare("UPDATE pedia_order_items SET status='completed' WHERE order_code=?").run(CODE);
    const { notifyPediaCompleted } = await import("@/lib/pedia/notify");
    expect(await notifyPediaCompleted(db, CODE)).toBe(true);
    expect(mails.at(-1)!.subject).toBe(`Order completed — ${CODE}`);
    expect(mails.at(-1)!.text).toContain("Order Completed");
    expect(mails.at(-1)!.text).toContain("Refill 30 Days");
  });

  it("processing & completed ID tetap Indonesia", async () => {
    const db = seed("id", "submitted");
    const { notifyPediaProcessing, notifyPediaCompleted } = await import("@/lib/pedia/notify");
    expect(await notifyPediaProcessing(db, CODE)).toBe(true);
    expect(mails.at(-1)!.subject).toBe(`Pesanan sedang diproses — ${CODE}`);
    fx.sql.prepare("UPDATE pedia_order_items SET status='completed' WHERE order_code=?").run(CODE);
    expect(await notifyPediaCompleted(db, CODE)).toBe(true);
    expect(mails.at(-1)!.subject).toBe(`Pesanan selesai — ${CODE}`);
    expect(mails.at(-1)!.text).toContain("Pesanan Selesai");
  });

  it("followup pembeli EN, notis admin tetap ID", async () => {
    const db = seed("en", "needs_check");
    fx.sql.prepare("INSERT INTO pedia_followups(order_code,reason) VALUES(?, 'partial')").run(CODE);
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "12345");
    const { notifyPendingPediaFollowups } = await import("@/lib/pedia/followup");
    await notifyPendingPediaFollowups(db);
    const mail = mails.at(-1)!;
    expect(mail.subject).toBe(`Pedia — ${CODE}`);
    expect(mail.text).toContain("needs manual resolution");
    expect(mail.text).toContain("do not need to place a new order");
    expect(adminMessages.at(-1)!.text).toContain("Pedia butuh tindakan manual");
  });

  it("notis admin needs_check tetap ID apa pun locale order", async () => {
    const db = seed("en", "needs_check");
    const { notifyPediaNeedsCheck } = await import("@/lib/pedia/notify");
    vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "12345");
    expect(await notifyPediaNeedsCheck(db, CODE, "supplier timeout")).toBe("sent");
    expect(adminMessages.at(-1)!.text).toContain("Pedia butuh tindakan manual");
    expect(adminMessages.at(-1)!.text).toContain("supplier timeout");
  });
});
