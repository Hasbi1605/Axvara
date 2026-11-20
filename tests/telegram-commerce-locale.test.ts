// TG2a read-commerce locale/currency (LOCAL ONLY): saved prefs drive EN/ID
// copy + ONE primary display price on buttons/lines; no invoice/order writes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { handleCommand } from "@/lib/telegram/handlers/command";
import { handleCallback } from "@/lib/telegram/handlers/callback";

const api = vi.hoisted(() => ({ send: vi.fn(), edit: vi.fn(), photo: vi.fn(), answer: vi.fn() }));
vi.mock("@/lib/telegram/api", () => ({
  sendMessage: api.send,
  safeEditOrSend: api.edit,
  sendPhoto: api.photo,
  sendChatAction: vi.fn(async () => ({ ok: true })),
  answerCallbackQuery: api.answer,
  withLoadingIndicator: vi.fn(async (_chat: number, _label: string, work: (b: () => Promise<void>) => Promise<void>) => work(async () => {})),
}));

let fx: ReturnType<typeof createD1Fixture>;
const user = { id: 555001, first_name: "Locale" };
const sentTexts = () => api.send.mock.calls.map((c) => String(c[0]?.text ?? ""));
const editTexts = () => api.edit.mock.calls.map((c) => String(c[0]?.text ?? ""));
const allTexts = () => [...sentTexts(), ...editTexts()];
const lastMarkup = () => {
  const calls = [...api.edit.mock.calls, ...api.send.mock.calls, ...api.photo.mock.calls];
  return JSON.stringify(calls.at(-1)?.[0]?.reply_markup ?? {});
};

function seedProduct() {
  // Categories are pre-seeded by schema.sql (id 1 = AI & Chatbot).
  fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,telegram_enabled,require_email,category_id,sort_order)
    VALUES(1,'Canva Pro <b>Bold</b>','canva-pro',160000,100,1,1,0,1,0)`).run();
  fx.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,min_qty,fulfillment_mode,is_active)
    VALUES(11,1,'SKU-11','1 Bulan',160000,-1,1,'manual',1)`).run();
}

beforeEach(() => {
  vi.clearAllMocks();
  api.send.mockResolvedValue({ ok: true, result: { message_id: 1 } });
  api.edit.mockResolvedValue({ ok: true });
  api.photo.mockResolvedValue({ ok: true });
  api.answer.mockResolvedValue({ ok: true });
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  // Fresh FX: 16000 IDR/USD (set LOCALLY for this test only, never prod).
  vi.stubEnv("USD_IDR_RATE", "16000");
  vi.stubEnv("USD_FX_EFFECTIVE_AT", new Date(Date.now() - 60_000).toISOString());
  fx = createD1Fixture();
  fx.sql.prepare("INSERT INTO telegram_users(user_id,chat_id,first_name) VALUES(?,?,?)").run(String(user.id), String(user.id), "Locale");
  seedProduct();
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("TG2a read commerce follows saved locale/currency", () => {
  it("EN home -> catalog -> product -> qty/email/cart/help all EN", async () => {
    await handleCallback("lang:en", user.id, 7, user, "cb-en-1");
    vi.clearAllMocks();
    await handleCommand("/katalog", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/AXVARA Catalog/);
    expect(lastMarkup()).toContain("Canva Pro");
    expect(lastMarkup()).toContain("$10.00");
    expect(lastMarkup()).toContain("Ready");
    vi.clearAllMocks();
    await handleCallback("prd:1", user.id, 8, user, "cb-prd");
    expect(allTexts().join("\n")).toContain("Choose a variant 👇");
    expect(allTexts().join("\n")).not.toMatch(/Harga mulai|Varian tersedia|Pilih varian/);
    expect(lastMarkup()).toContain("$10.00");
    vi.clearAllMocks();
    await handleCallback("var:11", user.id, 9, user, "cb-var");
    expect(allTexts().join("\n")).toMatch(/Stock ∞/);
    expect(allTexts().join("\n")).toMatch(/\$10\.00\/pcs/);
    expect(allTexts().join("\n")).not.toMatch(/Stok|Jumlah pesanan|Harga satuan/);
    vi.clearAllMocks();
    await handleCallback("q:1:11:1", user.id, 9, user, "cb-rev");
    expect(allTexts().join("\n")).toContain("Read before you pay");
    expect(allTexts().join("\n")).toMatch(/Quantity 1 × \$10\.00 = <b>\$10\.00<\/b>/);
    expect(lastMarkup()).toContain("Continue to Payment");
    expect(allTexts().join("\n")).not.toContain("<b>Bold</b>");
    vi.clearAllMocks();
    await handleCommand("/cart", user.id, "private", user);
    expect(allTexts().join("\n")).toMatch(/Cart/);
    vi.clearAllMocks();
    await handleCommand("/bantuan", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/AXVARA Help/);
    // Owner HTML escaped, never translated away: raw <b>Bold</b> must not appear.
    expect(allTexts().join("\n")).not.toContain("<b>Bold</b>");
  });

  it("ID baseline stays ID", async () => {
    await handleCallback("lang:id", user.id, 7, user, "cb-id-1");
    vi.clearAllMocks();
    await handleCommand("/katalog", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/Katalog AXVARA/);
    vi.clearAllMocks();
    await handleCommand("/bantuan", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/Bantuan AXVARA/);
  });

  it("display currency always follows language and ignores stored display_currency", async () => {
    await handleCallback("lang:en", user.id, 7, user, "cb-en");
    fx.sql.prepare("UPDATE telegram_users SET display_currency='IDR' WHERE user_id=?").run(String(user.id));
    vi.clearAllMocks();
    await handleCommand("/katalog", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/AXVARA Catalog/);
    expect(lastMarkup()).toContain("$10.00");
    expect(lastMarkup()).not.toMatch(/USD|Rp/);

    await handleCallback("lang:id", user.id, 9, user, "cb-id");
    fx.sql.prepare("UPDATE telegram_users SET display_currency='USD' WHERE user_id=?").run(String(user.id));
    vi.clearAllMocks();
    await handleCommand("/katalog", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/Katalog AXVARA/);
    expect(lastMarkup()).toContain("Rp160.000");
    expect(lastMarkup()).not.toMatch(/\$|USD/);
  });

  it("ID with stored display_currency=USD still renders Rupiah everywhere", async () => {
    await handleCallback("lang:id", user.id, 7, user, "cb-id");
    fx.sql.prepare("UPDATE telegram_users SET display_currency='USD' WHERE user_id=?").run(String(user.id));
    vi.clearAllMocks();
    await handleCommand("/katalog", user.id, "private", user);
    const markup = lastMarkup();
    expect(markup).toContain("Rp160.000");
    expect(markup).not.toMatch(/\$|USDT|USD/);
    vi.clearAllMocks();
    await handleCallback("prd:1", user.id, 9, user, "cb-prd2");
    const detail = allTexts().join("\n");
    expect(detail).toBe("<b>Canva Pro &lt;b&gt;Bold&lt;/b&gt;</b>\nPilih varian 👇");
    expect(lastMarkup()).toContain("Rp160.000");
    expect(lastMarkup()).not.toMatch(/\$|USDT/);
    expect(detail).not.toMatch(/\$|USDT/);
  });

  it("missing/stale FX keeps USD choice with honest IDR fallback, no $0", async () => {
    await handleCallback("lang:en", user.id, 7, user, "cb-en");
    await handleCallback("cur:USD", user.id, 8, user, "cb-usd");
    vi.stubEnv("USD_IDR_RATE", "");
    vi.stubEnv("USD_FX_EFFECTIVE_AT", "");
    vi.clearAllMocks();
    await handleCommand("/katalog", user.id, "private", user);
    expect(lastMarkup()).toMatch(/Rp/);
    expect(lastMarkup()).not.toMatch(/USDT/);
    vi.clearAllMocks();
    await handleCallback("prd:1", user.id, 9, user, "cb-prd3");
    expect(lastMarkup()).toContain("Rp160.000");
    expect(lastMarkup()).not.toMatch(/\$0/);
    vi.clearAllMocks();
    await handleCallback("var:11", user.id, 9, user, "cb-var3");
    const detail = allTexts().join("\n");
    expect(detail).toMatch(/USD equivalent unavailable|Perkiraan USD tidak tersedia/);
    expect(detail).not.toMatch(/\$0/);
    expect(fx.sql.prepare("SELECT display_currency FROM telegram_users WHERE user_id=?").get(String(user.id)))
      .toMatchObject({ display_currency: "USD" });
  });

  it("old ID reply-keyboard labels still route; query counter does not grow with buttons", async () => {
    await handleCallback("lang:en", user.id, 7, user, "cb-en");
    const before = fx.control.queries;
    vi.clearAllMocks();
    await handleCommand("🛍 Katalog", user.id, "private", user);
    expect(sentTexts().join("\n")).toMatch(/AXVARA Catalog/);
    const catalogQueries = fx.control.queries - before;
    vi.clearAllMocks();
    await handleCommand("🛒 Cart", user.id, "private", user);
    expect(allTexts().join("\n")).toMatch(/Cart/);
    // Rendering N buttons must not cost N extra D1 reads: catalog+cart stay bounded.
    expect(fx.control.queries - before - catalogQueries).toBeLessThan(15);
  });

  it("real FX math: 160000 IDR @16000 => $10.00 grouped exactly, display-only USD", async () => {
    const { formatUsdCents } = await import("@/lib/i18n/format");
    const { idrToUsdCents, loadFxSnapshot } = await import("@/lib/payments/fx");
    const snapshot = loadFxSnapshot();
    expect(snapshot).not.toBeNull();
    // formatUsdCents follows the shared payment-locale contract (exact BigInt,
    // locale-grouped, display-only — never USDT, never $0 fallback).
    expect(formatUsdCents(idrToUsdCents(160000, snapshot!), "en")).toBe("$10.00");
    expect(formatUsdCents(idrToUsdCents(160000, snapshot!), "id")).toBe("US$10,00");
    expect(formatUsdCents(idrToUsdCents(123456789, snapshot!), "en")).toBe("$7,716.05");
  });
});
