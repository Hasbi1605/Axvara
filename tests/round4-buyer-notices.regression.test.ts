// Audit ronde 4 (2026-09-24) — kabar pembeli yang dulu tidak pernah sampai.
//
// Semua kabar pembeli kanal WEB dulu masuk outbox WhatsApp, padahal bot WA
// mati (outbox produksi 18–19 Sep: `dead`, `whatsapp_not_connected`).
// Kegagalan WR hanya mem-ping admin, halaman pesanan tidak mengenal
// `failed`, dan handover membuang hasil kabar pembeli. Test ini memakai
// fixture D1 nyata; hanya Resend dan Telegram yang di-mock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createDatabaseAccess } from "@/lib/db-access";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { seedWrCatalog, seedWrFulfillmentItem, seedWrOrder } from "./warung-rebahan/helpers";

type MailArgs = { to: string; subject: string; html: string; text: string; timeoutMs?: number };
type MailResult = { ok: boolean; providerId?: string; error?: string };
const { sendForwardEmail } = vi.hoisted(() => ({
  sendForwardEmail: vi.fn(async (_params: MailArgs): Promise<MailResult> => ({ ok: true, providerId: "res_1" })),
}));
vi.mock("@/lib/warung-rebahan/forward-sender", () => ({ sendForwardEmail, isForwardEmailConfigured: () => true }));
vi.mock("@/lib/telegram/api", async (original) => ({
  ...await original<typeof import("@/lib/telegram/api")>(),
  sendMessage: vi.fn(async () => ({ ok: true, result: { message_id: 1 } })),
}));

import { sendMessage } from "@/lib/telegram/api";
import { notifyBuyerDeliveryFailed } from "@/lib/notify-buyer";
import { handleWrOrderFailed, refreshOrderAggregate } from "@/lib/warung-rebahan/deliver";
import { createWrOrderLink, processWrPendingOrders } from "@/lib/warung-rebahan/order";

const CODE = "AXV-20260924-WEBNOTE1";
let fx: ReturnType<typeof createD1Fixture>;

beforeEach(() => {
  fx = createD1Fixture();
  stubFulfillmentKey();
  vi.clearAllMocks();
  sendForwardEmail.mockImplementation(async () => ({ ok: true, providerId: "res_1" }));
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function webOrder(email: string | null = "buyer@example.test") {
  seedWrCatalog(fx);
  seedWrOrder(fx, CODE, "web");
  fx.sql.prepare("UPDATE orders SET customer_email=? WHERE code=?").run(email, CODE);
}
const outboxRows = () => (fx.sql.prepare("SELECT COUNT(*) AS n FROM whatsapp_outbox").get() as { n: number }).n;
const ledger = (key: string) =>
  (fx.sql.prepare("SELECT status FROM buyer_notice_log WHERE idempotency_key=?").get(key) as { status: string } | undefined)?.status;
const fulfillment = () =>
  (fx.sql.prepare("SELECT fulfillment_status AS s FROM orders WHERE code=?").get(CODE) as { s: string }).s;
const mailsWith = (needle: string) => sendForwardEmail.mock.calls.filter(([mail]) => mail.subject.includes(needle));

describe("kanal web: kabar pembeli lewat email", () => {
  it("kabar gagal kirim sampai lewat email, bukan outbox WA yang mati — dan hanya sekali", async () => {
    webOrder();
    const db = createDatabaseAccess(fx.db);
    expect(await notifyBuyerDeliveryFailed(CODE, db)).toBe(true);
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
    const mail = sendForwardEmail.mock.calls[0][0];
    expect(mail.to).toBe("buyer@example.test");
    expect(mail.subject).toContain(CODE);
    expect(mail.text).toContain(`/pesanan/${CODE}`);
    expect(mail.text).not.toContain("<b>");
    // Pengirim noreply: ajakan "balas pesan ini" khusus chat.
    expect(mail.text).not.toMatch(/balas pesan ini/i);
    expect(mail.timeoutMs).toBeLessThanOrEqual(8_000);
    expect(outboxRows()).toBe(0);
    expect(ledger(`email:delivery-failed:${CODE}`)).toBe("sent");

    expect(await notifyBuyerDeliveryFailed(CODE, db)).toBe(true);
    expect(sendForwardEmail).toHaveBeenCalledTimes(1);
  });

  it("email yang gagal ditandai failed lalu dicoba lagi pada pemicu berikutnya", async () => {
    webOrder();
    const db = createDatabaseAccess(fx.db);
    sendForwardEmail.mockImplementationOnce(async () => ({ ok: false, error: "resend_timeout" }));
    expect(await notifyBuyerDeliveryFailed(CODE, db)).toBe(false);
    expect(ledger(`email:delivery-failed:${CODE}`)).toBe("failed");
    expect(await notifyBuyerDeliveryFailed(CODE, db)).toBe(true);
    expect(sendForwardEmail).toHaveBeenCalledTimes(2);
    expect(ledger(`email:delivery-failed:${CODE}`)).toBe("sent");
  });

  it("order web lama tanpa email tetap jatuh ke outbox WA (perilaku lama)", async () => {
    webOrder(null);
    expect(await notifyBuyerDeliveryFailed(CODE, createDatabaseAccess(fx.db))).toBe(true);
    expect(sendForwardEmail).not.toHaveBeenCalled();
    expect(outboxRows()).toBe(1);
  });

  it("Telegram: kabar yang sama tidak terkirim dua kali", async () => {
    seedWrCatalog(fx);
    seedWrOrder(fx, CODE, "telegram");
    fx.sql.prepare("UPDATE orders SET telegram_user_id='555' WHERE code=?").run(CODE);
    fx.sql.prepare("INSERT INTO telegram_users(user_id, chat_id) VALUES('555','555')").run();
    const db = createDatabaseAccess(fx.db);
    expect(await notifyBuyerDeliveryFailed(CODE, db)).toBe(true);
    expect(await notifyBuyerDeliveryFailed(CODE, db)).toBe(true);
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(sendMessage).mock.calls[0][0].text)).toMatch(/balas pesan ini/i);
    expect(ledger(`telegram:delivery-failed:${CODE}`)).toBe("sent");
  });
});

describe("T-H1: kegagalan Warung Rebahan akhirnya mengabari pembeli", () => {
  it("vendor menolak order (webhook order.failed): pembeli dikabari sekali", async () => {
    webOrder();
    seedWrFulfillmentItem(fx, CODE);
    fx.sql.prepare(`INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status,fulfillment_item_id)
      VALUES(?,'ORD-R4-1','var-1',1,5000,'processing',1)`).run(CODE);
    fx.sql.prepare("UPDATE fulfillment_items SET wr_link_id=1 WHERE order_code=?").run(CODE);
    const db = createDatabaseAccess(fx.db);
    expect(await handleWrOrderFailed("ORD-R4-1", "stok WR habis", db)).toBe(true);
    expect(fulfillment()).toBe("failed");
    expect(mailsWith("bermasalah")).toHaveLength(1);
    // Event ganda dan reconciler berikutnya tidak mengirim ulang.
    await handleWrOrderFailed("ORD-R4-1", "stok WR habis", db);
    await refreshOrderAggregate(CODE, db);
    expect(mailsWith("bermasalah")).toHaveLength(1);
  });

  it("percobaan order WR habis (3x): pembeli dikabari, bukan hanya admin", async () => {
    webOrder();
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    const db = createDatabaseAccess(fx.db);
    await createWrOrderLink(CODE, [{ product_id: 1, variant_id: 1, qty: 1 }], db);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    for (let i = 0; i < 3; i++) {
      fx.sql.prepare("UPDATE wr_order_links SET next_attempt_at=datetime('now','-1 minute')").run();
      await processWrPendingOrders(createDatabaseAccess(fx.db));
    }
    expect((fx.sql.prepare("SELECT status FROM wr_order_links").get() as { status: string }).status).toBe("failed");
    expect(fulfillment()).toBe("failed");
    expect(mailsWith("bermasalah")).toHaveLength(1);
  });
});

describe("B-H1: tanda terima pembayaran untuk pembeli web", () => {
  it("hook lunas mengirim satu email tanda terima walau terpanggil ulang", async () => {
    webOrder();
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/delivery/ensure");
    await ensureFulfillmentForPaidOrder(CODE);
    await ensureFulfillmentForPaidOrder(CODE);
    const receipts = mailsWith("Pembayaran");
    expect(receipts).toHaveLength(1);
    expect(receipts[0][0].to).toBe("buyer@example.test");
    expect(outboxRows()).toBe(0);
  });
});

describe("T-M5: handover melaporkan apakah pembeli berhasil dikabari", () => {
  const ADMIN = { email: "admin@axvara.tech", secret: "handover-secret-0123456789", hash: "c".repeat(64) };
  const HO = "AXV-20260924-HANDOVR1";

  async function handoverAll(): Promise<Record<string, unknown>> {
    process.env.ADMIN_EMAIL = ADMIN.email;
    process.env.ADMIN_JWT_SECRET = ADMIN.secret;
    process.env.ADMIN_PASSWORD_SHA256 = ADMIN.hash;
    vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
    await insertTestProduct(fx.sql, "manual", 1);
    fx.sql.prepare(`INSERT INTO orders
      (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,
       sales_channel,variant_id,variant_snapshot)
      VALUES (?,?,?,?,?,10000,'qris','lunas','paid','web',1,?)`)
      .run(HO, "Buyer", "628000000000", "buyer@example.test",
        JSON.stringify([{ product_id: 1, variant_id: 1, name: "Manual", price: 10000, qty: 1 }]),
        JSON.stringify({ lines: [{ variant_id: 1, fulfillment_mode: "manual" }] }));
    const { ensureFulfillmentForPaidOrder } = await import("@/lib/fulfillment/deliver");
    await ensureFulfillmentForPaidOrder(HO);
    const { createAdminToken, createIdleToken } = await import("@/lib/auth");
    const { token, sid } = await createAdminToken(ADMIN.email);
    const cookie = `axvara_admin_token=${encodeURIComponent(token)}; axvara_idle=${encodeURIComponent(await createIdleToken(sid))}`;
    const { POST } = await import("@/app/api/admin/orders/[code]/handover/route");
    const res = await POST(new NextRequest(`http://localhost/api/admin/orders/${HO}/handover`, {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ item_index: 0 }),
    }), { params: Promise.resolve({ code: HO }) });
    expect(res.status).toBe(200);
    return await res.json();
  }

  it("email handover gagal → admin diberi tahu (buyer_notified=false)", async () => {
    sendForwardEmail.mockImplementation(async (mail) => (mail.subject.includes("diserahkan")
      ? { ok: false, error: "resend_timeout" } : { ok: true, providerId: "res_1" }));
    expect(await handoverAll()).toMatchObject({ fulfillment_status: "delivered", buyer_notified: false });
  });

  it("email handover terkirim → buyer_notified=true", async () => {
    expect(await handoverAll()).toMatchObject({ fulfillment_status: "delivered", buyer_notified: true });
  });
});

describe("W-H1: API halaman pesanan mengenal gagal kirim", () => {
  it("GET /api/orders?code= dan /api/orders/[code] sama-sama mengembalikan fulfillment_status", async () => {
    webOrder();
    fx.sql.prepare("UPDATE orders SET fulfillment_status='failed' WHERE code=?").run(CODE);
    const { GET } = await import("@/app/api/orders/route");
    const list = await GET(new NextRequest(`http://localhost/api/orders?code=${CODE}`));
    expect((await list.json()).order.fulfillment_status).toBe("failed");
    const { GET: GET_ONE } = await import("@/app/api/orders/[code]/route");
    const one = await GET_ONE(new NextRequest(`http://localhost/api/orders/${CODE}`), { params: Promise.resolve({ code: CODE }) });
    expect((await one.json()).order.fulfillment_status).toBe("failed");
  });
});

describe("W-M3: checkout tidak lagi mematikan tombol bayar tanpa penjelasan", () => {
  it("S&K belum dicentang tidak menonaktifkan CTA; klik menjelaskan dan membawa ke checkbox", () => {
    const page = readFileSync("src/app/checkout/page.tsx", "utf8");
    const cta = page.match(/const ctaDisabled = ([^;]+);/)?.[1] ?? "";
    expect(cta).toContain("quoteLoading");
    expect(cta).not.toContain("agreed");
    const start = page.indexOf("if (!agreed) {");
    const branch = page.slice(start, page.indexOf("return;", start));
    expect(branch).toContain("Centang persetujuan");
    expect(branch).toContain("scrollIntoView");
  });
});
