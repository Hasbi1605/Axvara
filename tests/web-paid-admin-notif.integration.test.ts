// tests/web-paid-admin-notif.integration.test.ts — Notif admin "Pembayaran diterima — Web"
// ke grup Telegram (laporan owner 2026-09-25: order web tidak pernah muncul di
// Axvara_Notif, order Telegram muncul).
//
// Penyebab: notif web dibangun dengan `SITE_URL ?? fallback`; SITE_URL kosong
// di worker (ARCHITECTURE §16.4) → tombol ber-URL relatif → Telegram menolak
// seluruh pesan, dan hasil kirim diabaikan. Dikunci di sini pada D1 nyata:
//  - URL tombol selalu absolut walau SITE_URL kosong / tanpa skema;
//  - tombol ditolak (400) → dikirim ulang tanpa tombol, alasan tercatat;
//  - timeout → pemulihan bertanda hanya dari cron setelah 30 menit;
//  - sekali per order; order lama (>6 jam) tidak dikirim ulang oleh cron;
//  - order web tidak lagi mengirim "Order Baru" saat dibuat.
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createOrderWithStock } from "@/lib/db";
import { ensureFulfillmentForPaidOrder } from "@/lib/fulfillment/deliver";
import { siteOrigin } from "@/lib/site-url";
import { summarizeWebDelivery } from "@/lib/telegram/order-notifications";
import { webPaidAdminKeyboard } from "@/lib/telegram/keyboards";

type Msg = { chat_id: string; text: string; reply_markup?: { inline_keyboard: { text: string; url?: string }[][] } };
let fixture: ReturnType<typeof createD1Fixture>;
const CODE = "AXV-20260925-NOTIF001";
let messages: Msg[];
let telegramResponse: () => Response;

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  vi.stubEnv("AUTO_FULFILLMENT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-test");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100200");
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("CRON_SECRET", "fixture");
  messages = [];
  telegramResponse = () => Response.json({ ok: true, result: { message_id: 1 } });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (input === "https://api.telegram.org/botbot-test/getMe" && init?.method === "POST") {
      return Response.json({ ok: true, result: { id: 17 } });
    }
    if (input !== "https://api.telegram.org/botbot-test/sendMessage" || init?.method !== "POST") {
      throw new Error("Network disabled in fixture");
    }
    messages.push(JSON.parse(String(init.body)) as Msg);
    return telegramResponse();
  }));
  fixture.sql.exec("INSERT INTO products(id,name,slug,price,stock,source) VALUES(1,'Canva Pro','canva-premium',5000,100,'manual')");
  fixture.sql.exec("INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode) VALUES(2,1,'SKU-2','Invite Lifetime',5000,-1,'manual')");
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function paidWebOrder(code = CODE) {
  await createOrderWithStock({
    code, quoteId: `q-${code}`, customerName: "Rani Putri", customerWa: "628123456789",
    customerEmail: "rani@contoh.test", items: [{ product_id: 1, variant_id: 2, name: "Canva Pro — Invite Lifetime", price: 5000, qty: 1 }],
    subtotal: 5000, paymentMethod: "qris", paymentAccount: "DANA Business", proofUrl: null,
  });
  fixture.sql.prepare("UPDATE orders SET status='lunas', payment_status='paid', paid_at=datetime('now') WHERE code=?").run(code);
}

async function adminMessages(): Promise<Msg[]> {
  return messages.filter((m) => m.chat_id === "-100200");
}
const ledger = (code = CODE) => fixture.sql.prepare("SELECT status, error FROM buyer_notice_log WHERE idempotency_key=?").get(`admin-paid:${code}`) as { status: string; error: string | null } | undefined;

// Cron menjalankan maks 3 fase per run dan menggilir sisanya (fase tertunda
// jalan lebih dulu di run berikutnya), jadi ulangi sampai fase notify aktif.
async function cron(): Promise<Record<string, unknown>> {
  const { POST } = await import("@/app/api/cron/operations/route");
  for (let run = 0; run < 3; run++) {
    const res = await POST(new NextRequest("http://localhost/api/cron/operations", { method: "POST", headers: { authorization: "Bearer fixture" } }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    if (!((body.deferred as string[] | undefined) ?? []).includes("notify")) return body;
  }
  throw new Error("fase notify tidak pernah jalan");
}

describe("notif Pembayaran diterima — Web ke grup admin", () => {
  it("SITE_URL kosong → tombol tetap ber-URL absolut; dikirim sekali per order", async () => {
    await paidWebOrder();
    await ensureFulfillmentForPaidOrder(CODE);
    const msgs = await adminMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("Pembayaran diterima — Web · perlu dikirim admin");
    expect(msgs[0].text).toContain(CODE);
    expect(msgs[0].text).toContain("rani@contoh.test");
    const buttons = msgs[0].reply_markup!.inline_keyboard.flat();
    expect(buttons.at(-1)).toMatchObject({ text: "🧮 Hitung Refund" });
    const urls = buttons.map((b) => b.url);
    expect(urls).toEqual(["https://wa.me/628123456789", `https://axvara.tech/lacak-pesanan?code=${CODE}&admin=1`, `https://axvara.tech/admin?section=orders&q=${CODE}`, `https://axvara.tech/admin/refund?code=${CODE}`]);
    expect(ledger()).toMatchObject({ status: "sent", error: null });

    await ensureFulfillmentForPaidOrder(CODE);
    await cron();
    expect(await adminMessages()).toHaveLength(1);
  });

  it("tombol ditolak Telegram (400) → dikirim ulang tanpa tombol, alasannya tercatat", async () => {
    const accept = telegramResponse;
    telegramResponse = () => messages.length === 1
      ? Response.json({ ok: false, error_code: 400, description: "Bad Request: inline keyboard button URL '/admin' is invalid" }, { status: 400 })
      : accept();
    await paidWebOrder();
    await ensureFulfillmentForPaidOrder(CODE);
    const msgs = await adminMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].reply_markup).toBeTruthy();
    expect(msgs[1].reply_markup).toBeUndefined();
    expect(msgs[1].text).toBe(msgs[0].text);
    expect(ledger()?.status).toBe("sent");
    expect(ledger()?.error).toContain("terkirim tanpa tombol: Bad Request");
  });

  it("timeout → unknown; hanya fase notify boleh mengirim ulang setelah 30 menit", async () => {
    telegramResponse = () => { throw new DOMException("aborted", "AbortError"); };
    await paidWebOrder();
    await ensureFulfillmentForPaidOrder(CODE);
    expect(await adminMessages()).toHaveLength(1);
    expect(ledger()).toMatchObject({ status: "unknown", error: "ambiguous" });

    for (const minutes of [10, 20, 29]) {
      fixture.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now',?) WHERE idempotency_key=?")
        .run(`-${minutes} minutes`, `admin-paid:${CODE}`);
      const tick = await cron();
      expect(tick.telegram_paid_admin_web_notifications_retried ?? 0).toBe(0);
    }
    fixture.sql.prepare("UPDATE buyer_notice_log SET updated_at=datetime('now','-31 minutes') WHERE idempotency_key=?").run(`admin-paid:${CODE}`);
    await ensureFulfillmentForPaidOrder(CODE);
    expect(await adminMessages()).toHaveLength(1);
    expect(ledger()?.status).toBe("unknown");
    telegramResponse = () => Response.json({ ok: true, result: { message_id: 2 } });
    expect((await cron()).telegram_paid_admin_web_notifications_retried).toBe(1);
    const [original, recovery] = await adminMessages();
    expect(recovery).toEqual({ ...original, text: `🔁 Kirim ulang otomatis — abaikan bila notif lunas order ini sudah ada\n${original.text}` });
    expect(ledger()?.status).toBe("sent");
    await cron();
    expect(await adminMessages()).toHaveLength(2);
  });

  it("order web yang lunas lebih dari 6 jam lalu tidak dikirim oleh cron", async () => {
    await paidWebOrder();
    fixture.sql.prepare("UPDATE orders SET paid_at=datetime('now','-7 hours'), updated_at=datetime('now','-7 hours') WHERE code=?").run(CODE);
    await cron();
    expect(await adminMessages()).toHaveLength(0);
  });

  it("order web tidak lagi mengirim notif 'Order Baru' saat dibuat", () => {
    const route = fs.readFileSync("src/app/api/orders/route.ts", "utf8");
    expect(route).not.toMatch(/sendMessage|adminWebOrderNotification|notifyAdminTelegram/);
  });
});

describe("ringkasan status kirim + origin situs", () => {
  it("merangkum item otomatis, manual, WR, dan yang masih berjalan", () => {
    const res = summarizeWebDelivery([
      { status: "delivered", delivered_message_id: "item:1", wr_link_id: null },
      { status: "manual_required", delivered_message_id: null, wr_link_id: null },
      { status: "queued", delivered_message_id: null, wr_link_id: 9 },
      { status: "retry", delivered_message_id: null, wr_link_id: null },
    ]);
    expect(res.needsAdmin).toBe(true);
    expect(res.lines).toEqual([
      "🛠 1 item perlu dikirim: Panel → Pesanan → Kirim ke pembeli",
      "🤖 1 item terkirim otomatis",
      "🤖 2 item sedang diproses otomatis",
    ]);
    expect(summarizeWebDelivery([{ status: "delivered", delivered_message_id: "manual", wr_link_id: null }]))
      .toEqual({ needsAdmin: false, lines: ["✅ 1 item sudah diserahkan admin"], orderStatus: "SELESAI" });
  });

  it("item SK pending disebut Sekalipay eksplisit di notif admin", () => {
    const res = summarizeWebDelivery([
      { status: "processing", delivered_message_id: null, sk_link_id: 3 },
      { status: "delivered", delivered_message_id: "sk:7", sk_link_id: 7 },
    ]);
    expect(res.needsAdmin).toBe(false);
    expect(res.lines).toContain("🤖 1 item terkirim otomatis");
    expect(res.lines).toContain("🤖 1 item sedang diproses otomatis");
    expect(res.orderStatus).toBe("DIPROSES OTOMATIS");
  });

  it("tombol WA hanya untuk nomor valid (satu URL buruk menggagalkan seluruh pesan)", () => {
    for (const customerWa of ["", "0812", "12345678901"]) {
      const kb = webPaidAdminKeyboard({ customerWa, orderCode: CODE, siteUrl: "https://axvara.tech" });
      expect(kb.inline_keyboard.flat().map((b) => b.text)).toEqual(["👁 Lihat pesanan pembeli", "🔧 Buka Pesanan"]);
    }
  });

  it("siteOrigin tahan SITE_URL kosong, spasi, tanpa skema, dan garis miring", () => {
    const cases: [string | undefined, string][] = [
      ["", "https://axvara.tech"], ["   ", "https://axvara.tech"], [undefined, "https://axvara.tech"],
      ["axvara.tech", "https://axvara.tech"], ["https://axvara.tech/", "https://axvara.tech"],
      ["http://127.0.0.1:3000", "http://127.0.0.1:3000"], [" https://staging.axvara.tech// ", "https://staging.axvara.tech"],
    ];
    for (const [value, expected] of cases) {
      if (value === undefined) delete process.env.SITE_URL; else vi.stubEnv("SITE_URL", value);
      expect(siteOrigin()).toBe(expected);
    }
  });
});
