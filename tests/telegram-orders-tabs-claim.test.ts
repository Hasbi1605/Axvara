// Item 11 — Pesanan Saya tabs / detail date+warranty / warranty claim flow.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

const api = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn(), photo: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send, safeEditOrSend: api.edit, sendPhoto: api.photo, sendChatAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/payments/paid-fulfillment", () => ({ schedulePaidFulfillment: vi.fn() }));

const buyer = 12345;
const DAY = 86400;
let fx: ReturnType<typeof createD1Fixture>;

function insertOrder(code: string, opts: { status?: string; payment?: string; fulfillment?: string; items?: unknown[]; subtotal?: number; paidAt?: string | null } = {}) {
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,
     sales_channel,telegram_chat_id,telegram_user_id,variant_id,fulfillment_status,created_at,paid_at,locale)
     VALUES(?,?,?,?,?,'qris',?,?,'telegram',?,?,1,?,?,?,?)`)
    .run(
      code, "Buyer", "6280",
      JSON.stringify(opts.items ?? [{ product_id: 1, variant_id: 1, name: "Canva Pro", price: 10000, qty: 1 }]),
      opts.subtotal ?? 10000, opts.status ?? "pending", opts.payment ?? "pending",
      String(buyer), String(buyer), opts.fulfillment ?? "not_required",
      "2026-11-18 10:00:00", opts.paidAt ?? null, "id",
    );
}

/** Seed a live warranty snapshot (readEstimate → ready) for a paid order.
 * The 0137 trigger already inserted a skeleton row from the order items;
 * update it in place (same PK) instead of inserting a duplicate. */
function seedWarranty(code: string, startedAgoSeconds = 3600, warrantyDays = 7) {
  const started = Math.floor(Date.now() / 1000) - startedAgoSeconds;
  fx.sql.prepare(`UPDATE market_refund_items SET duration_value=30, duration_unit='day',
     warranty_type='limited', warranty_value=?, warranty_unit='day', rate_bps=10000, started_at=?
     WHERE order_code=?`)
    .run(warrantyDays, started, code);
  const row = fx.sql.prepare("SELECT started_at, warranty_type FROM market_refund_items WHERE order_code=?").get(code);
  if (!row) {
    fx.sql.prepare(`INSERT INTO market_refund_items(order_code,item_index,name,price,qty,duration_value,duration_unit,
       warranty_type,warranty_value,warranty_unit,rate_bps,started_at)
       VALUES(?,0,'Canva Pro',10000,1,30,'day','limited',?,'day',10000,?)`)
      .run(code, warrantyDays, started);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "999");
  fx = createD1Fixture();
  await insertTestProduct(fx.sql, "manual", 1);
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,locale) VALUES(?,?,'id')").run(String(buyer), String(buyer));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network disabled"); }));
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("handleMyOrdersPaged — tabs, counts, paging", () => {
  it("defaults to Aktif when it has rows, renders 5/page and tab counts", async () => {
    const { handleMyOrdersPaged } = await import("@/lib/telegram/handlers/orders");
    for (let i = 0; i < 7; i++) insertOrder(`AXV-20261118-ACT0000${i}`);
    insertOrder("AXV-20261118-DONE0001", { status: "lunas", payment: "paid", fulfillment: "delivered" });
    await handleMyOrdersPaged(buyer, 0, undefined, 0, { id: buyer, first_name: "B" });
    const first = api.edit.mock.calls.at(-1)?.[0];
    // 7 active spread across 2 pages of 5.
    expect(first.text).toContain("Aktif");
    expect(first.text).toContain("Halaman 1/2");
    const buttons = first.reply_markup.inline_keyboard.flat();
    expect(buttons.filter((b: { callback_data?: string }) => String(b.callback_data).startsWith("order:")).length).toBe(5);
    expect(buttons.some((b: { callback_data?: string }) => b.callback_data === "mo:a:1")).toBe(true);
    // Selesai tab has exactly one completed order.
    expect(buttons.some((b: { text: string }) => b.text.includes("Selesai (1)"))).toBe(true);
  });

  it("falls back to Selesai when there are no active orders", async () => {
    const { handleMyOrdersPaged } = await import("@/lib/telegram/handlers/orders");
    insertOrder("AXV-20261118-DONE0002", { status: "lunas", payment: "paid", fulfillment: "delivered" });
    await handleMyOrdersPaged(buyer, 0, undefined, 0, { id: buyer, first_name: "B" });
    expect(api.edit.mock.calls.at(-1)?.[0].text).toContain("Selesai");
  });

  it("truncates long order labels without a dangling separator", async () => {
    const { handleMyOrdersPaged } = await import("@/lib/telegram/handlers/orders");
    insertOrder("AXV-20261118-LONG0001", {
      status: "lunas", payment: "paid", fulfillment: "delivered",
      items: [{ product_id: 1, variant_id: 1, name: "Canva Pro / Premium — Invite 1 Tahun", price: 5000, qty: 1 }],
    });
    await handleMyOrdersPaged(buyer, 0, "s", 0, { id: buyer, first_name: "B" });
    const labels = api.edit.mock.calls.at(-1)?.[0].reply_markup.inline_keyboard.flat()
      .filter((b: { callback_data?: string }) => String(b.callback_data).startsWith("order:"))
      .map((b: { text: string }) => b.text) as string[];
    expect(labels).toHaveLength(1);
    expect(labels[0]).not.toMatch(/[—/·]\s*·/u);
    expect(labels[0].startsWith("📋 Canva Pro / Premium")).toBe(true);
    expect(labels[0]).toContain("… · ");
  });

  it("never lists another buyer's orders", async () => {
    const { handleMyOrdersPaged } = await import("@/lib/telegram/handlers/orders");
    insertOrder("AXV-20261118-OTHER001", { status: "lunas", payment: "paid", fulfillment: "delivered" });
    fx.sql.exec("UPDATE orders SET telegram_user_id='777'");
    await handleMyOrdersPaged(buyer, 0, "s", 0, { id: buyer, first_name: "B" });
    expect(api.edit.mock.calls.at(-1)?.[0].text).toContain("Belum ada pesanan");
  });
});

describe("handleOrderStatus — order date + warranty remaining", () => {
  it("shows created date and remaining warranty for a delivered paid order, with claim button", async () => {
    const { handleOrderStatus } = await import("@/lib/telegram/handlers/orders");
    insertOrder("AXV-20261118-WRN00001", { status: "lunas", payment: "paid", fulfillment: "delivered", paidAt: "2026-11-18 11:00:00" });
    seedWarranty("AXV-20261118-WRN00001", 3600, 7);
    await handleOrderStatus(buyer, "AXV-20261118-WRN00001", buyer);
    const text = String(api.send.mock.calls.at(-1)?.[0].text ?? "");
    expect(text).toContain("Sisa garansi");
    expect(text).toContain("Dibuat");
    expect(text).toContain("Lunas");
    const markup = JSON.stringify(api.send.mock.calls.at(-1)?.[0].reply_markup);
    expect(markup).toContain("claim:AXV-20261118-WRN00001");
  });

  it("omits the claim button when no warranty row exists", async () => {
    const { handleOrderStatus } = await import("@/lib/telegram/handlers/orders");
    insertOrder("AXV-20261118-NOWR0001", { status: "lunas", payment: "paid", fulfillment: "delivered" });
    await handleOrderStatus(buyer, "AXV-20261118-NOWR0001", buyer);
    const markup = JSON.stringify(api.send.mock.calls.at(-1)?.[0].reply_markup);
    expect(markup).not.toContain("claim:");
    expect(markup).toContain("cred:AXV-20261118-NOWR0001");
  });
});

describe("warranty claim flow (claim → claimstart → forward)", () => {
  it("shows eligibility then forwards the buyer's text and confirms with a ticket reference", async () => {
    const { handleWarrantyClaim, handleWarrantyClaimStart, handlePendingWarrantyClaimInput } = await import("@/lib/telegram/handlers/orders");
    const code = "AXV-20261118-CLAM0001";
    insertOrder(code, { status: "lunas", payment: "paid", fulfillment: "delivered" });
    seedWarranty(code, 3600, 7);
    await handleWarrantyClaim(buyer, 1, code, { id: buyer, first_name: "B", username: "buyer" });
    expect(String(api.edit.mock.calls.at(-1)?.[0].text)).toContain("Klaim Garansi");
    expect(JSON.stringify(api.edit.mock.calls.at(-1)?.[0].reply_markup)).toContain(`claimstart:${code}`);

    await handleWarrantyClaimStart(buyer, 1, code, { id: buyer, first_name: "B", username: "buyer" });
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer))?.pending_action).toBe(`wclaim:${code}`);

    const handled = await handlePendingWarrantyClaimInput("Akun tidak bisa login", buyer, { id: buyer, first_name: "B", username: "buyer" });
    expect(handled).toBe(true);
    // Forwarded to admin (999) and confirmed to buyer with the ticket reference.
    const forwarded = api.send.mock.calls.find(([p]) => String(p.chat_id) === "999");
    expect(String(forwarded?.[0].text)).toContain(`KLAIM-${code}`);
    expect(String(forwarded?.[0].text)).toContain("Akun tidak bisa login");
    expect(api.send.mock.calls.some(([p]) => String(p.chat_id) === String(buyer) && String(p.text).includes(`KLAIM-${code}`))).toBe(true);
    // State cleared after forwarding.
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer))?.pending_action).toBeNull();
  });

  it("only consumes text while pending_action is wclaim:", async () => {
    const { handlePendingWarrantyClaimInput } = await import("@/lib/telegram/handlers/orders");
    expect(await handlePendingWarrantyClaimInput("hello", buyer, { id: buyer, first_name: "B" })).toBe(false);
  });

  it("/batal cancels the claim and clears the state", async () => {
    const { handleWarrantyClaimStart, handlePendingWarrantyClaimInput } = await import("@/lib/telegram/handlers/orders");
    const code = "AXV-20261118-CLAM0002";
    insertOrder(code, { status: "lunas", payment: "paid" });
    await handleWarrantyClaimStart(buyer, 1, code, { id: buyer, first_name: "B" });
    expect(await handlePendingWarrantyClaimInput("/batal", buyer, { id: buyer, first_name: "B" })).toBe(true);
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer))?.pending_action).toBeNull();
    expect(api.send.mock.calls.some(([p]) => String(p.chat_id) === "999")).toBe(false);
  });

  it("enforces max 3 claims per order per 24h", async () => {
    const { handleWarrantyClaimStart } = await import("@/lib/telegram/handlers/orders");
    const code = "AXV-20261118-CLAM0003";
    insertOrder(code, { status: "lunas", payment: "paid" });
    for (let i = 0; i < 3; i++) {
      fx.sql.prepare(`INSERT INTO buyer_notice_log(idempotency_key,order_code,channel,status,error) VALUES(?,?,'telegram','sent','warranty_claim')`)
        .run(`tg-wclaim:${code}:uuid-${i}`, code);
    }
    api.edit.mockClear();
    await handleWarrantyClaimStart(buyer, 1, code, { id: buyer, first_name: "B" });
    expect(String(api.edit.mock.calls.at(-1)?.[0].text)).toContain("Batas klaim");
    expect(fx.sql.prepare("SELECT pending_action FROM telegram_users WHERE user_id=?").get(String(buyer))?.pending_action).toBeNull();
  });
});
