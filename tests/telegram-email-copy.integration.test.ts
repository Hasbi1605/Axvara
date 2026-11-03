// tests/telegram-email-copy.integration.test.ts — Salinan EMAIL untuk pembeli
// Telegram dengan produk wajib-email (keputusan owner 2026-11-04).
//
// Yang dikunci, lewat jalur asli di atas D1 nyata (node:sqlite):
//  - Order Telegram + produk wajib-email: DM Telegram TETAP terkirim dan email
//    "Pesanan Siap" (isi produk + tanda terima) terkirim tepat sekali.
//  - Retry/rerun tidak mengirim email kedua.
//  - Produk tanpa require_email (walau order punya email tersimpan) = tanpa email.
//  - Provider email gagal TIDAK menggagalkan/membatalkan pengiriman Telegram.
//  - Tanda terima via email saja (tanpa pesan Telegram ganda) untuk order yang
//    belum terkirim otomatis (Made By Order).
//  - Kredensial WR dan SK jalur Telegram juga mendapat salinan email.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { telegramEmailCopyTarget } from "@/lib/telegram/email-copy";

type Mail = { to: string[]; subject: string; html: string; text: string };
type TgCall = { chat_id: string; text: string };

let fixture: ReturnType<typeof createD1Fixture>;
let emails: Mail[];
let resendAttempts: number;
let resendOk: boolean;
let tgCalls: TgCall[];
let tgOk: boolean;

const BUYER = "880001";
const MAIL = "pembeli@contoh.test";

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  emails = [];
  tgCalls = [];
  resendAttempts = 0;
  resendOk = true;
  tgOk = true;
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@axvara.test");
  vi.stubEnv("SITE_URL", "https://axvara.test");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("api.telegram.org")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as TgCall;
      tgCalls.push({ chat_id: String(body.chat_id), text: String(body.text ?? "") });
      if (!tgOk) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: tgCalls.length } }), { status: 200 });
    }
    if (String(url) === "https://api.resend.com/emails") {
      resendAttempts++;
      if (!resendOk) return new Response(JSON.stringify({ message: "resend_down" }), { status: 503 });
      emails.push(JSON.parse(String(init?.body)) as Mail);
      return new Response(JSON.stringify({ id: `email-${emails.length}` }), { status: 200 });
    }
    throw new Error(`Network disabled: ${url}`);
  }));

  const shared = await encryptSecret("https://canva.test/join?token=UNDANGAN-TG");
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock,source,require_email) VALUES
    (1,'Canva Pro','canva-pro',2000,100,'manual',1),
    (2,'Netflix','netflix',3000,100,'manual',0),
    (3,'Prime Video','prime-sk',5000,10,'manual',0),
    (4,'Spotify','spotify-wr',6000,10,'manual',0)`);
  const variant = fixture.sql.prepare(`INSERT INTO product_variants
    (id,product_id,sku,label,price,stock,fulfillment_mode,shared_secret_ciphertext,shared_secret_iv,sk_variant_id,wr_variant_id)
    VALUES(?,?,?,?,?,-1,?,?,?,?,?)`);
  variant.run(1, 1, "CANVA-SH", "Invite", 2000, "shared", shared.ciphertext, shared.iv, null, null);
  variant.run(2, 2, "NF-SH", "1 Bulan", 3000, "shared", shared.ciphertext, shared.iv, null, null);
  variant.run(3, 1, "CANVA-MBO", "Private", 2000, "manual", null, null, null, null);
  variant.run(10, 3, "SK-PV", "1 Bulan", 5000, "manual", null, null, "201", null);
  variant.run(20, 4, "WR-SP", "Invite", 6000, "manual", null, null, null, "w-sp");
  fixture.sql.exec(`INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price)
    VALUES('201','9','Prime Video','1 Bulan',3000,10,'auto',3,10,5000)`);
  fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wp','Spotify')`);
  fixture.sql.exec(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class,wr_type)
    VALUES('w-sp','wp','Invite',4000,'restock','Invite')`);
  fixture.sql.exec(`INSERT INTO telegram_users(user_id,chat_id,username,first_name) VALUES('${BUYER}','${BUYER}','buyer','Budi')`);
});
afterEach(() => { fixture.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

type Line = { product: number; variant: number };
function paidTelegramOrder(code: string, lines: Line[], email: string | null = MAIL, channel = "telegram") {
  const items = lines.map(l => ({ product_id: l.product, variant_id: l.variant, name: `Produk ${l.product}`, price: 2000, qty: 1 }));
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,telegram_chat_id,telegram_user_id,variant_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, "Budi Santoso", "", email, JSON.stringify(items), items.length * 2000, "qris", "DANA Business", "lunas", "paid",
      channel, BUYER, BUYER, JSON.stringify({ fulfillment_mode: "shared" }));
}
const db = () => createDatabaseAccess(fixture.db);
const itemRows = (code: string) => fixture.sql.prepare(
  "SELECT status, attempt_count, delivered_message_id FROM fulfillment_items WHERE order_code=? ORDER BY item_index",
).all(code) as { status: string; attempt_count: number; delivered_message_id: string | null }[];
const dmsWith = (needle: string) => tgCalls.filter(c => c.text.includes(needle));

describe("telegramEmailCopyTarget (kelayakan)", () => {
  it("hanya order Telegram dengan email valid DAN minimal satu produk wajib-email", async () => {
    paidTelegramOrder("AXV-TGE-ELIG0001", [{ product: 1, variant: 1 }]);
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0001", db())).toBe(MAIL);

    // Keranjang multi-baris: satu produk wajib-email cukup.
    paidTelegramOrder("AXV-TGE-ELIG0002", [{ product: 2, variant: 2 }, { product: 1, variant: 1 }]);
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0002", db())).toBe(MAIL);

    // Tanpa produk wajib-email = tanpa email walau email tersimpan.
    paidTelegramOrder("AXV-TGE-ELIG0003", [{ product: 2, variant: 2 }]);
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0003", db())).toBeNull();

    // Varian WR Invite wajib-email walau products.require_email=0.
    paidTelegramOrder("AXV-TGE-ELIG0004", [{ product: 4, variant: 20 }]);
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0004", db())).toBe(MAIL);

    // Email kosong/invalid, kanal bukan Telegram, Pedia, order tak ada.
    paidTelegramOrder("AXV-TGE-ELIG0005", [{ product: 1, variant: 1 }], "bukan-email");
    paidTelegramOrder("AXV-TGE-ELIG0006", [{ product: 1, variant: 1 }], MAIL, "web");
    paidTelegramOrder("AXV-TGE-ELIG0007", [{ product: 1, variant: 1 }]);
    fixture.sql.prepare("UPDATE orders SET order_kind='pedia' WHERE code=?").run("AXV-TGE-ELIG0007");
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0005", db())).toBeNull();
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0006", db())).toBeNull();
    expect(await telegramEmailCopyTarget("AXV-TGE-ELIG0007", db())).toBeNull();
    expect(await telegramEmailCopyTarget("AXV-TGE-NOPE0000", db())).toBeNull();
  });

  it("gagal baca database = null (fail closed)", async () => {
    paidTelegramOrder("AXV-TGE-FAIL0001", [{ product: 1, variant: 1 }]);
    fixture.control.fail = query => query.includes("product_variants");
    expect(await telegramEmailCopyTarget("AXV-TGE-FAIL0001", db())).toBeNull();
  });
});

describe("non-WR shared: DM Telegram + satu email Pesanan Siap", () => {
  it("produk wajib-email: DM tetap terkirim, email berisi isi + tanda terima, tanpa email tanda terima terpisah", async () => {
    const code = "AXV-TGE-SHARED01";
    paidTelegramOrder(code, [{ product: 1, variant: 1 }]);
    expect(await ensureFulfillmentForPaidOrder(code)).toBe(true);

    expect(itemRows(code)).toMatchObject([{ status: "delivered" }]);
    expect(dmsWith("UNDANGAN-TG")).toHaveLength(1);
    expect(dmsWith("UNDANGAN-TG")[0].chat_id).toBe(BUYER);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([MAIL]);
    expect(emails[0].subject).toContain(code);
    expect(emails[0].subject.startsWith("Pesanan siap, ")).toBe(true);
    expect(emails[0].html).toContain("UNDANGAN-TG");
    expect(emails[0].html).toContain("PEMBAYARAN DITERIMA");
    expect(emails[0].html).toContain(`/pesanan/${code}`);
    // Pesan lunas Telegram tetap tepat satu.
    expect(dmsWith("Pembayaran lunas")).toHaveLength(1);
  });

  it("menjalankan ulang pengiriman tidak mengirim email kedua", async () => {
    const code = "AXV-TGE-RERUN001";
    paidTelegramOrder(code, [{ product: 1, variant: 1 }]);
    await ensureFulfillmentForPaidOrder(code);
    await ensureFulfillmentForPaidOrder(code);
    expect(emails).toHaveLength(1);

    // Item dipaksa retry: DM boleh terkirim lagi (perilaku lama), email TIDAK.
    fixture.sql.prepare("UPDATE fulfillment_items SET status='retry', locked_until=NULL WHERE order_code=?").run(code);
    const order = fixture.sql.prepare("SELECT * FROM orders WHERE code=?").get(code)!;
    const item = fixture.sql.prepare("SELECT * FROM fulfillment_items WHERE order_code=?").get(code)!;
    const { processItem } = await import("@/lib/fulfillment/delivery/send");
    expect(await processItem(order, item, undefined, db())).toBe(true);
    expect(dmsWith("UNDANGAN-TG")).toHaveLength(2);
    expect(emails).toHaveLength(1);
  });

  it("produk TANPA require_email walau order punya email: tidak ada email", async () => {
    const code = "AXV-TGE-NOREQ001";
    paidTelegramOrder(code, [{ product: 2, variant: 2 }]);
    await ensureFulfillmentForPaidOrder(code);
    expect(itemRows(code)).toMatchObject([{ status: "delivered" }]);
    expect(dmsWith("UNDANGAN-TG")).toHaveLength(1);
    expect(resendAttempts).toBe(0);
    expect(emails).toHaveLength(0);
  });

  it("provider email gagal: pengiriman Telegram tetap delivered, tanpa retry item, tanpa throw", async () => {
    const code = "AXV-TGE-RESEND01";
    resendOk = false;
    paidTelegramOrder(code, [{ product: 1, variant: 1 }]);
    await expect(ensureFulfillmentForPaidOrder(code)).resolves.toBe(true);

    expect(itemRows(code)).toMatchObject([{ status: "delivered", attempt_count: 1 }]);
    expect(fixture.sql.prepare("SELECT fulfillment_status FROM orders WHERE code=?").get(code)?.fulfillment_status).toBe("delivered");
    expect(dmsWith("UNDANGAN-TG")).toHaveLength(1);
    expect(resendAttempts).toBeGreaterThan(0);
    expect(emails).toHaveLength(0);
    // Email item gagal tercatat; tanda terima dicoba sebagai cadangan (juga gagal) tanpa efek ke Telegram.
    expect(fixture.sql.prepare("SELECT status FROM buyer_notice_log WHERE idempotency_key LIKE 'email:fulfillment-item:%'").get()?.status).toBe("failed");
  });

  it("email item gagal lalu provider pulih: tanda terima email-only tetap sampai", async () => {
    const code = "AXV-TGE-RESEND02";
    resendOk = false;
    paidTelegramOrder(code, [{ product: 1, variant: 1 }]);
    await ensureFulfillmentForPaidOrder(code);
    expect(emails).toHaveLength(0);
    resendOk = true;
    const { notifyBuyerPaymentReceived } = await import("@/lib/notify-buyer");
    await notifyBuyerPaymentReceived(code, db(), { emailOnly: true });
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(`Pembayaran pesanan ${code} diterima`);
  });
});

describe("tanda terima email-only untuk order Telegram yang belum terkirim otomatis", () => {
  it("Made By Order: satu email tanda terima, tidak ada pesan lunas Telegram ganda, idempoten", async () => {
    const code = "AXV-TGE-MBO00001";
    paidTelegramOrder(code, [{ product: 1, variant: 3 }]);
    await ensureFulfillmentForPaidOrder(code);
    expect(itemRows(code)).toMatchObject([{ status: "manual_required" }]);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([MAIL]);
    expect(emails[0].subject).toBe(`Pembayaran pesanan ${code} diterima`);
    expect(dmsWith("Pembayaran lunas")).toHaveLength(1);
    expect(dmsWith("Pembayaran pesanan")).toHaveLength(0);

    await ensureFulfillmentForPaidOrder(code);
    expect(emails).toHaveLength(1);
    expect(dmsWith("Pembayaran lunas")).toHaveLength(1);
  });

  it("order Telegram tanpa produk wajib-email: tidak ada tanda terima email", async () => {
    const code = "AXV-TGE-MBO00002";
    fixture.sql.exec("UPDATE product_variants SET fulfillment_mode='manual' WHERE id=2");
    paidTelegramOrder(code, [{ product: 2, variant: 2 }]);
    await ensureFulfillmentForPaidOrder(code);
    expect(resendAttempts).toBe(0);
  });
});

describe("kabar pembeli (sendToBuyer) untuk order Telegram", () => {
  it("pengiriman bermasalah: DM Telegram + satu email; hasil = hasil DM, email tetap walau DM gagal", async () => {
    const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
    const code = "AXV-TGE-NOTICE01";
    paidTelegramOrder(code, [{ product: 1, variant: 1 }]);
    expect(await notifyBuyerDeliveryFailed(code, db())).toBe(true);
    expect(dmsWith("Pengiriman produk bermasalah")).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(`Pengiriman pesanan ${code} bermasalah`);
    // Idempoten: panggilan kedua tidak menambah email.
    await notifyBuyerDeliveryFailed(code, db());
    expect(emails).toHaveLength(1);

    // DM gagal (return false, semantik retry tidak berubah) tetapi email terkirim.
    const code2 = "AXV-TGE-NOTICE02";
    paidTelegramOrder(code2, [{ product: 1, variant: 1 }]);
    tgOk = false;
    expect(await notifyBuyerDeliveryFailed(code2, db())).toBe(false);
    expect(emails).toHaveLength(2);
  });

  it("tanpa produk wajib-email: kabar hanya lewat Telegram", async () => {
    const { notifyBuyerDeliveryFailed } = await import("@/lib/notify-buyer");
    const code = "AXV-TGE-NOTICE03";
    paidTelegramOrder(code, [{ product: 2, variant: 2 }]);
    expect(await notifyBuyerDeliveryFailed(code, db())).toBe(true);
    expect(emails).toHaveLength(0);
    expect(resendAttempts).toBe(0);
  });

  it("serah terima admin: DM berisi detail + email Pesanan Siap", async () => {
    const code = "AXV-TGE-HANDOVR1";
    paidTelegramOrder(code, [{ product: 1, variant: 3 }]);
    const sealed = await encryptSecret("AKUN-MANUAL-123");
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,delivered_message_id,delivered_ciphertext,delivered_iv)
      VALUES(?,0,1,3,1,'manual','telegram',?,'delivered','manual',?,?)`).run(code, BUYER, sealed.ciphertext, sealed.iv);
    const { notifyBuyerHandover } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerHandover(code, db())).toBe(true);
    expect(dmsWith("AKUN-MANUAL-123")).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0].html).toContain("AKUN-MANUAL-123");
  });
});

describe("kredensial supplier jalur Telegram", () => {
  it("SK: DM lisensi + satu email Pesanan Siap; webhook replay tidak menggandakan", async () => {
    const code = "AXV-TGE-SK000001";
    paidTelegramOrder(code, [{ product: 3, variant: 10 }]);
    // Produk SK default tanpa require_email → tidak berhak.
    fixture.sql.exec("UPDATE products SET require_email=1 WHERE id=3");
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES(?,0,3,10,1,'manual','telegram',?,'queued',0,datetime('now'))`).run(code, BUYER);
    fixture.sql.prepare(`INSERT INTO sk_order_links
      (order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key,sk_invoice)
      VALUES(?,'201',1,3000,'processing',1,3,datetime('now'),?,?)`).run(code, `sk:${code}`, `SPY-${code}`);
    const { handleSkOrderCompleted } = await import("@/lib/sekalipay/deliver");
    const detail = {
      invoice: `SPY-${code}`, status: "completed",
      items: [{ variant_id: 201, variant_name: "1 Bulan", product_name: "Prime Video", product_license: "pv@mail.com|rahasia-sk" }],
    } as never;
    expect(await handleSkOrderCompleted(`SPY-${code}`, detail, db())).toBe(true);
    expect(dmsWith("rahasia-sk")).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([MAIL]);
    expect(emails[0].html).toContain("rahasia-sk");
    await handleSkOrderCompleted(`SPY-${code}`, detail, db());
    expect(dmsWith("rahasia-sk")).toHaveLength(1);
    expect(emails).toHaveLength(1);
  });

  it("SK tanpa produk wajib-email: hanya DM Telegram", async () => {
    const code = "AXV-TGE-SK000002";
    paidTelegramOrder(code, [{ product: 3, variant: 10 }]);
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES(?,0,3,10,1,'manual','telegram',?,'queued',0,datetime('now'))`).run(code, BUYER);
    fixture.sql.prepare(`INSERT INTO sk_order_links
      (order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key,sk_invoice)
      VALUES(?,'201',1,3000,'processing',1,3,datetime('now'),?,?)`).run(code, `sk:${code}`, `SPY-${code}`);
    const { handleSkOrderCompleted } = await import("@/lib/sekalipay/deliver");
    await handleSkOrderCompleted(`SPY-${code}`, {
      invoice: `SPY-${code}`, status: "completed",
      items: [{ variant_id: 201, variant_name: "1 Bulan", product_name: "Prime Video", product_license: "pv@mail.com|rahasia-sk2" }],
    } as never, db());
    expect(dmsWith("rahasia-sk2")).toHaveLength(1);
    expect(resendAttempts).toBe(0);
  });

  it("WR Invite: DM kredensial + satu email Detail Akun; email gagal tidak mengubah status delivered", async () => {
    const code = "AXV-TGE-WR000001";
    paidTelegramOrder(code, [{ product: 4, variant: 20 }]);
    const secret = await encryptSecret("wr-akun@mail.test|SECRET-WR");
    const link = fixture.sql.prepare(`INSERT INTO wr_order_links
      (order_code,wr_variant_id,quantity,wr_cost,status,idempotency_key,delivery_status,delivery_channel,wr_account_details,wr_account_iv)
      VALUES(?,'w-sp',1,4000,'completed',?,'queued','telegram',?,?)`)
      .run(code, `wr:${code}`, secret.ciphertext, secret.iv);
    const { processCredentialDelivery } = await import("@/lib/warung-rebahan/deliver");
    expect(await processCredentialDelivery(Number(link.lastInsertRowid), db())).toBe(true);
    expect(dmsWith("wr-akun@mail.test")).toHaveLength(1);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual([MAIL]);
    expect(emails[0].html).toContain("SECRET-WR");

    // Provider mati pada order WR lain: Telegram tetap delivered.
    const code2 = "AXV-TGE-WR000002";
    paidTelegramOrder(code2, [{ product: 4, variant: 20 }]);
    resendOk = false;
    const link2 = fixture.sql.prepare(`INSERT INTO wr_order_links
      (order_code,wr_variant_id,quantity,wr_cost,status,idempotency_key,delivery_status,delivery_channel,wr_account_details,wr_account_iv)
      VALUES(?,'w-sp',1,4000,'completed',?,'queued','telegram',?,?)`)
      .run(code2, `wr:${code2}`, secret.ciphertext, secret.iv);
    expect(await processCredentialDelivery(Number(link2.lastInsertRowid), db())).toBe(true);
    expect(fixture.sql.prepare("SELECT delivery_status FROM wr_order_links WHERE id=?").get(Number(link2.lastInsertRowid))?.delivery_status).toBe("delivered");
    expect(emails).toHaveLength(1);
  });
});
