// tests/telegram-supplier-parity.test.ts — Paritas order Telegram = Web (2026-10-04).
//
// Laporan owner: (1) order SK instan via Telegram (Prime Video) lunas tetapi
// pembeli hanya menerima "Pemasok sedang menyiapkan… dikirim ke email ini" —
// tanpa email, tanpa kredensial; (2) WR/SK MBO perlu pesan tunggu + kredensial
// otomatis ke chat yang sama; (3) SK tampil "Tanpa Garansi" padahal garansinya
// ada di S&K; (4) pasangan WR/SK pecundang tampil dobel di Telegram.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

let fixture: ReturnType<typeof createD1Fixture>;
type TgCall = { chat_id: string; text: string; reply_markup?: { inline_keyboard?: { callback_data?: string }[][] } };
let tgCalls: TgCall[];
let failingChats: Set<string>;

const PRIVATE_CHAT = "555001";
const BUYER = "777001";

function seedCatalog() {
  fixture.sql.exec(`INSERT INTO products(id,name,slug,price,stock,source,telegram_enabled,sold_count) VALUES
    (1,'Prime Video','prime-video-sk',5000,10,'manual',1,9),
    (2,'Prime Video','prime-video-wr',6000,10,'manual',1,5),
    (3,'Canva Pro','canva-pro',3000,10,'manual',1,1)`);
  const v = fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,sk_variant_id,wr_variant_id,warranty_type,warranty_value,warranty_unit)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  v.run(10, 1, "SK-PV", "1 Bulan", 5000, 10, "manual", "201", null, "none", null, null);
  v.run(20, 2, "WR-PV", "1 Bulan", 6000, 10, "manual", null, "w-pv", "limited", 7, "day");
  v.run(21, 2, "WR-MBO", "Private", 9000, 10, "manual", null, "w-mbo", "none", null, null);
  v.run(30, 3, "CANVA", "Invite", 3000, -1, "shared", null, null, "none", null, null);
  fixture.sql.exec(`INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process,axvara_product_id,axvara_variant_id,axvara_sell_price)
    VALUES('201','9','Prime Video','1 Bulan',3000,10,'auto',1,10,5000)`);
  fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('wp','Prime Video')`);
  fixture.sql.exec(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_delivery_class) VALUES
    ('w-pv','wp','1 Bulan',4000,'restock'),('w-mbo','wp','Private',7000,'made_by_order')`);
  fixture.sql.exec(`INSERT INTO telegram_users(user_id,chat_id,username,first_name) VALUES('${BUYER}','${PRIVATE_CHAT}','buyer','Budi')`);
}

function insertTelegramOrder(code: string, variantId: number, productId: number, chatId = PRIVATE_CHAT) {
  fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel,telegram_chat_id,telegram_user_id,variant_snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(code, "Budi", "", "", JSON.stringify([{ product_id: productId, variant_id: variantId, name: "Prime Video", price: 5000, qty: 1 }]),
      5000, "qris", "DANA Business", "lunas", "paid", "telegram", chatId, BUYER, JSON.stringify({ fulfillment_mode: "manual" }));
}

beforeEach(() => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  seedCatalog();
  tgCalls = [];
  failingChats = new Set();
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes("api.telegram.org")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as TgCall;
      tgCalls.push({ chat_id: String(body.chat_id), text: String(body.text ?? ""), reply_markup: body.reply_markup });
      if (failingChats.has(String(body.chat_id))) {
        return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" }), { status: 400 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: tgCalls.length } }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});
afterEach(() => {
  fixture.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("SK completed → lisensi langsung ke chat Telegram pembeli", () => {
  async function completeSk(code: string) {
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,attempt_count,next_attempt_at)
      VALUES(?,0,1,10,1,'manual','telegram',?,'queued',0,datetime('now'))`).run(code, BUYER);
    fixture.sql.prepare(`INSERT INTO sk_order_links
      (order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,max_attempts,next_attempt_at,idempotency_key,sk_invoice)
      VALUES(?,'201',1,3000,'processing',1,3,datetime('now'),?,?)`).run(code, `sk:${code}`, `SPY-${code}`);
    const { handleSkOrderCompleted } = await import("@/lib/sekalipay/deliver");
    return handleSkOrderCompleted(`SPY-${code}`, {
      invoice: `SPY-${code}`, status: "completed",
      items: [{ variant_id: 201, variant_name: "1 Bulan", product_name: "Prime Video", product_license: "pv@mail.com|rahasia1" }],
    } as never, createDatabaseAccess(fixture.db));
  }

  it("order Telegram tanpa email menerima DM lisensi SATU kali (idempoten)", async () => {
    const code = "AXV-20261004-SKTG0001";
    insertTelegramOrder(code, 10, 1);
    expect(await completeSk(code)).toBe(true);
    const dms = tgCalls.filter((c) => c.text.includes("pv@mail.com"));
    expect(dms).toHaveLength(1);
    expect(dms[0].chat_id).toBe(PRIVATE_CHAT);
    expect(dms[0].text).toContain("Produk Siap");
    expect(dms[0].text.toLowerCase()).not.toContain("pemasok");
    expect(dms[0].text.toLowerCase()).not.toContain("sekalipay");

    // Webhook replay + reconcile tidak mengirim ulang.
    const { handleSkOrderCompleted, reconcilePendingSkCredentialEmails } = await import("@/lib/sekalipay/deliver");
    await handleSkOrderCompleted(`SPY-${code}`, { invoice: `SPY-${code}`, status: "completed", items: [{ product_license: "pv@mail.com|rahasia1" }] } as never, createDatabaseAccess(fixture.db));
    await reconcilePendingSkCredentialEmails(createDatabaseAccess(fixture.db));
    expect(tgCalls.filter((c) => c.text.includes("pv@mail.com"))).toHaveLength(1);
  });

  it("order dari grup, pembeli belum START: tidak bocor ke grup, menyusul setelah START", async () => {
    const code = "AXV-20261004-SKTG0002";
    fixture.sql.exec(`DELETE FROM telegram_users`);
    failingChats.add(BUYER); // bot belum pernah di-START → Telegram "chat not found"
    insertTelegramOrder(code, 10, 1, "-100200300");
    expect(await completeSk(code)).toBe(true);
    expect(tgCalls.some((c) => c.chat_id.startsWith("-"))).toBe(false);
    expect(tgCalls.filter((c) => c.text.includes("pv@mail.com")).every((c) => c.chat_id === BUYER)).toBe(true);

    // Pembeli START bot di chat pribadi → backoff dilepas → reconcile mengirim.
    failingChats.clear();
    fixture.sql.exec(`INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES('${BUYER}','${PRIVATE_CHAT}','Budi')`);
    const { ensurePrivateRecipient } = await import("@/lib/fulfillment/deliver");
    await ensurePrivateRecipient(BUYER, PRIVATE_CHAT);
    tgCalls = [];
    const { reconcilePendingSkCredentialEmails } = await import("@/lib/sekalipay/deliver");
    expect(await reconcilePendingSkCredentialEmails(createDatabaseAccess(fixture.db))).toBe(1);
    const dm = tgCalls.find((c) => c.text.includes("pv@mail.com"));
    expect(dm?.chat_id).toBe(PRIVATE_CHAT);
  });

  it("kabar 'sedang diproses' SK tidak dikirim ke pembeli Telegram (tanpa kata pemasok/email)", async () => {
    const code = "AXV-20261004-SKTG0003";
    insertTelegramOrder(code, 10, 1);
    const { notifyBuyerSkProcessing } = await import("@/lib/notify-buyer");
    expect(await notifyBuyerSkProcessing(code, "SPY-X", createDatabaseAccess(fixture.db))).toBe(false);
    expect(tgCalls).toHaveLength(0);
  });

  it("kabar saldo tertunda WR/SK tidak menyebut pemasok", async () => {
    const code = "AXV-20261004-SKTG0004";
    insertTelegramOrder(code, 10, 1);
    const { notifyBuyerSkBlocked, notifyBuyerWrBlocked } = await import("@/lib/notify-buyer");
    await notifyBuyerSkBlocked(code, createDatabaseAccess(fixture.db));
    await notifyBuyerWrBlocked(code, createDatabaseAccess(fixture.db));
    expect(tgCalls.length).toBeGreaterThan(0);
    for (const call of tgCalls) expect(call.text.toLowerCase()).not.toContain("pemasok");
  });
});

describe("Pesan lunas Telegram mengikuti kelas kirim (instan / MBO / manual)", () => {
  async function paidText(code: string, variantId: number, productId: number) {
    insertTelegramOrder(code, variantId, productId);
    const { notifyTelegramBuyerPaid } = await import("@/lib/telegram/order-notifications");
    await notifyTelegramBuyerPaid(code, createDatabaseAccess(fixture.db));
    const call = tgCalls.find((c) => c.chat_id === PRIVATE_CHAT && c.text.includes("Pembayaran Berhasil"));
    expect(call).toBeTruthy();
    return call!.text;
  }

  it("SK auto → kirim otomatis, tidak minta WA, tidak 'dikirim admin'", async () => {
    const text = await paidText("AXV-20261004-PAID0001", 10, 1);
    expect(text).toContain("dikirim otomatis ke chat ini");
    expect(text).not.toContain("dikirim admin");
    expect(text).not.toContain("nomor WhatsApp");
  });

  it("WR Made By Order → pesan tunggu + janji kirim otomatis ke chat ini", async () => {
    const text = await paidText("AXV-20261004-PAID0002", 21, 2);
    expect(text).toContain("Made By Order");
    expect(text).toContain("maksimal 12 jam");
    expect(text).toContain("otomatis ke chat ini");
    expect(text).not.toContain("nomor WhatsApp");
  });

  it("WR restock → instan", async () => {
    expect(await paidText("AXV-20261004-PAID0003", 20, 2)).toContain("dikirim otomatis ke chat ini");
  });
});

describe("WR delivery Telegram: format seragam + requeue setelah START", () => {
  it("ensurePrivateRecipient mengantrekan ulang delivery Telegram yang gagal", async () => {
    const code = "AXV-20261004-WRTG0001";
    insertTelegramOrder(code, 20, 2, "-100200300");
    fixture.sql.prepare(`INSERT INTO wr_order_links
      (order_code,wr_variant_id,quantity,wr_cost,status,idempotency_key,delivery_status,delivery_channel,delivery_attempt_count,delivery_last_error)
      VALUES(?,'w-pv',1,4000,'completed',?,'failed','telegram',5,'no_private_telegram_chat')`).run(code, `wr:${code}`);
    const { ensurePrivateRecipient } = await import("@/lib/fulfillment/deliver");
    await ensurePrivateRecipient(BUYER, PRIVATE_CHAT);
    const row = fixture.sql.prepare(`SELECT delivery_status, delivery_attempt_count FROM wr_order_links WHERE order_code=?`).get(code) as Record<string, unknown>;
    expect(row).toMatchObject({ delivery_status: "queued", delivery_attempt_count: 0 });
  });

  it("supplierCredentialMessage memuat kode, produk, dan detail ter-escape", async () => {
    const { supplierCredentialMessage } = await import("@/lib/telegram/messages");
    const msg = supplierCredentialMessage("AXV-1", "Netflix <Premium>", "Email: a@b.c\nPassword: x<y");
    expect(msg).toContain("AXV-1");
    expect(msg).toContain("Netflix &lt;Premium&gt;");
    expect(msg).toContain("<pre>Email: a@b.c\nPassword: x&lt;y</pre>");
  });
});

describe("Katalog Telegram memfilter pecundang pasangan WR/SK", () => {
  beforeEach(() => {
    // Pasangan Prime Video: WR (2) menang → SK (1) disembunyikan.
    fixture.sql.exec(`INSERT INTO supplier_pairs(wr_product_id,sk_product_id,winner) VALUES(2,1,'WR')`);
  });

  it("listTelegramProducts + bestseller + pencarian tidak memuat pecundang", async () => {
    const { listTelegramProducts } = await import("@/lib/telegram/handlers/catalog");
    const ids = (await listTelegramProducts()).map((p) => p.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(1);

    const { getBestsellers } = await import("@/lib/telegram/handlers/shared");
    const best = (await getBestsellers(5)).map((p) => p.productId);
    expect(best).not.toContain(1);

    const { handleSearchResults } = await import("@/lib/telegram/handlers/discovery");
    await handleSearchResults(Number(PRIVATE_CHAT), "prime");
    const result = tgCalls.at(-1)!;
    const callbacks = (result.reply_markup?.inline_keyboard ?? []).flat().map((b) => String(b.callback_data ?? ""));
    // Satu kartu Prime Video (pemenang WR id 2), bukan dua.
    expect(callbacks).toContain("prd:2");
    expect(callbacks).not.toContain("prd:1");
  });

  it("winner NULL (Opsi B) → SK tetap disembunyikan; winner SK → WR disembunyikan", async () => {
    const { listTelegramProducts } = await import("@/lib/telegram/handlers/catalog");
    fixture.sql.exec(`UPDATE supplier_pairs SET winner=NULL`);
    expect((await listTelegramProducts()).map((p) => p.id)).not.toContain(1);
    fixture.sql.exec(`UPDATE supplier_pairs SET winner='SK'`);
    const ids = (await listTelegramProducts()).map((p) => p.id);
    expect(ids).toContain(1);
    expect(ids).not.toContain(2);
  });

  it("winnerForLoserProduct mengarahkan detail pecundang ke pemenang", async () => {
    const { winnerForLoserProduct } = await import("@/lib/supplier-pairs");
    const db = createDatabaseAccess(fixture.db);
    expect(await winnerForLoserProduct(1, db)).toBe(2);
    expect(await winnerForLoserProduct(2, db)).toBeNull();
    expect(await winnerForLoserProduct(3, db)).toBeNull();
  });
});

describe("Garansi: varian tanpa data garansi tidak ditulis 'Tanpa Garansi'", () => {
  it("buyerWarrantyLabel kosong untuk none, kanonis untuk limited", async () => {
    const { buyerWarrantyLabel } = await import("@/lib/catalog");
    const base = { id: 1, product_id: 1, sku: "x", label: "x", price: 1, stock: 1, is_active: true, fulfillment_mode: "manual" } as never;
    expect(buyerWarrantyLabel({ ...(base as object), warranty_type: "none" } as never)).toBe("");
    expect(buyerWarrantyLabel({ ...(base as object), warranty_type: "limited", warranty_value: 7, warranty_unit: "day" } as never)).toBe("Garansi 7 Hari");
  });

  it("tombol varian Telegram SK tanpa garansi tidak memuat kata garansi", async () => {
    const { getProductDetail, buyerWarrantyLabel } = await import("@/lib/catalog");
    const detail = await getProductDetail(1);
    expect(detail).toBeTruthy();
    const { variantsKeyboard } = await import("@/lib/telegram/keyboards");
    const kb = variantsKeyboard(1, detail!.variants.map((v) => ({
      id: v.id, label: v.label, price: v.price, stock: v.stock, warranty_label: buyerWarrantyLabel(v) || null,
    })));
    const texts = kb.inline_keyboard.flat().map((b) => b.text);
    expect(texts.some((t) => /garansi/i.test(t))).toBe(false);
  });

  it("WhatsApp detail produk tidak menulis 'Tanpa Garansi'", async () => {
    const { getProductDetail } = await import("@/lib/catalog");
    const { productDetailMessage } = await import("@/lib/whatsapp/messages");
    const detail = await getProductDetail(1);
    const msg = productDetailMessage("Prime Video", null, detail!.variants);
    expect(msg).not.toContain("Tanpa Garansi");
  });
});

describe("Fallback pengiriman kredensial Telegram", () => {
  it("chat_id tersimpan gagal → dicoba ulang ke telegram_user_id (jalur stok sendiri)", async () => {
    fixture.sql.exec(`UPDATE telegram_users SET chat_id='999999' WHERE user_id='${BUYER}'`);
    failingChats.add("999999");
    const { sendTelegramCredential } = await import("@/lib/telegram/credential-delivery");
    const res = await sendTelegramCredential(
      { telegram_user_id: BUYER, telegram_chat_id: "-100200300" }, "isi", createDatabaseAccess(fixture.db),
    );
    expect(res.chatId).toBe(BUYER);
    expect(tgCalls.map((c) => c.chat_id)).toEqual(["999999", BUYER]);
  });

  it("tidak pernah mencoba id grup; semua gagal → throw agar retry", async () => {
    fixture.sql.exec(`DELETE FROM telegram_users`);
    failingChats.add(BUYER);
    const { sendTelegramCredential } = await import("@/lib/telegram/credential-delivery");
    await expect(sendTelegramCredential(
      { telegram_user_id: BUYER, telegram_chat_id: "-100200300" }, "isi", createDatabaseAccess(fixture.db),
    )).rejects.toThrow(/telegram_delivery_failed/);
    expect(tgCalls.some((c) => c.chat_id.startsWith("-"))).toBe(false);
  });

  it("tombol Ambil Detail Produk mengirim ulang detail yang sudah siap (pemilik saja)", async () => {
    const code = "AXV-20261004-CRED0001";
    insertTelegramOrder(code, 30, 3);
    const { encryptSecret } = await import("@/lib/fulfillment/crypto");
    const { ciphertext, iv } = await encryptSecret("canva-invite-link");
    fixture.sql.prepare(`INSERT INTO fulfillment_items
      (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,recipient_target,status,delivered_message_id,delivered_ciphertext,delivered_iv)
      VALUES(?,0,3,30,1,'shared','telegram',?,'delivered','m1',?,?)`).run(code, BUYER, ciphertext, iv);
    const { handleCallback } = await import("@/lib/telegram/handlers/callback");
    await handleCallback(`cred:${code}`, Number(PRIVATE_CHAT), 1, { id: Number(BUYER), first_name: "Budi" });
    expect(tgCalls.some((c) => c.chat_id === PRIVATE_CHAT && c.text.includes("canva-invite-link"))).toBe(true);

    // Orang lain menekan tombol yang diteruskan → ditolak, tidak bocor.
    tgCalls = [];
    await handleCallback(`cred:${code}`, 444, 1, { id: 444, first_name: "Asing" });
    expect(tgCalls.some((c) => c.text.includes("canva-invite-link"))).toBe(false);
    expect(tgCalls[0]?.text).toContain("bukan milikmu");
  });

  it("belum siap → pesan tunggu, bukan diam", async () => {
    const code = "AXV-20261004-CRED0002";
    insertTelegramOrder(code, 20, 2);
    const { resendTelegramCredentials } = await import("@/lib/telegram/credential-delivery");
    expect(await resendTelegramCredentials(code, Number(PRIVATE_CHAT), createDatabaseAccess(fixture.db))).toBe(0);
    expect(tgCalls.at(-1)?.text).toContain("belum siap");
  });

  it("pesan lunas memuat tombol Ambil Detail Produk", async () => {
    const { orderPaidKeyboard } = await import("@/lib/telegram/keyboards");
    const cbs = orderPaidKeyboard("AXV-1").inline_keyboard.flat().map((b) => (b as { callback_data?: string }).callback_data);
    expect(cbs).toContain("cred:AXV-1");
  });
});
