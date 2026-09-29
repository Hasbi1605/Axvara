import { beforeEach, describe, expect, it, vi } from "vitest";
import { promoMessages, promoSlotAt, selectPromoProducts, sendDueAdminPromoDigest } from "@/lib/telegram/promo-digest";
import type { DatabaseAccess } from "@/lib/db-access";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn() }));
import { sendMessage } from "@/lib/telegram/api";

const products = Array.from({ length: 16 }, (_, i) => ({
  id: i + 1,
  name: i === 0 ? "ChatGPT <Pro>" : `Produk ${i + 1}`,
  category: ["AI & Chatbot", "Streaming & Hiburan", "Produktivitas & Office", "Desain & Video"][i % 4],
  price: (i + 1) * 1000,
}));

function database(rows: Record<string, unknown>[] = products): DatabaseAccess {
  const databaseRows = rows.map((row) => ({ ...row, promo_price: row.price }));
  let digest: Record<string, unknown> | null = null;
  return {
    d1: null, getD1: () => null, isD1Mode: () => false, canSpend: () => true,
    queryAll: vi.fn(async (query: string) => query.includes("FROM products") ? databaseRows : []),
    queryFirst: vi.fn(async () => digest),
    execRun: vi.fn(async (query: string, ...params: unknown[]) => {
      if (query.includes("INSERT OR IGNORE")) digest ??= { product_ids: params[2], full_message_id: null, short_message_id: null };
      if (query.includes("full_message_id=?") && digest) digest.full_message_id = params[0];
      if (query.includes("short_message_id=?") && digest) digest.short_message_id = params[0];
      return { changes: 1 };
    }),
  };
}

function databaseWithFullSent(): DatabaseAccess {
  const digest: Record<string, unknown> = {
    product_ids: JSON.stringify([1, 2, 3, 4]),
    full_message_id: "10",
    short_message_id: null,
  };
  return {
    d1: null, getD1: () => null, isD1Mode: () => false, canSpend: () => true,
    queryAll: vi.fn(async (query: string) => query.includes("FROM products") ? products.map((row) => ({ ...row, promo_price: row.price })) : [{ business_date: "2026-09-27", slot: "morning", product_ids: digest.product_ids }]),
    queryFirst: vi.fn(async () => digest),
    execRun: vi.fn(async (query: string, ...params: unknown[]) => {
      if (query.includes("short_message_id=?")) digest.short_message_id = params[0];
      return { changes: 1 };
    }),
  };
}

describe("Telegram promo digest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TELEGRAM_PROMO_DIGEST_ENABLED = "true";
    process.env.TELEGRAM_BOT_ENABLED = "true";
    process.env.TELEGRAM_BOT_TOKEN = "test";
    process.env.TELEGRAM_ADMIN_CHAT_ID = "-1001";
  });

  it("uses exact WIB delivery windows", () => {
    expect(promoSlotAt(new Date("2026-09-27T01:59:59Z"))).toBeNull();
    expect(promoSlotAt(new Date("2026-09-27T02:00:00Z"))).toEqual({ businessDate: "2026-09-27", slot: "morning" });
    expect(promoSlotAt(new Date("2026-09-27T04:59:59Z"))?.slot).toBe("morning");
    expect(promoSlotAt(new Date("2026-09-27T05:00:00Z"))).toBeNull();
    expect(promoSlotAt(new Date("2026-09-27T10:00:00Z"))?.slot).toBe("evening");
    expect(promoSlotAt(new Date("2026-09-27T13:00:00Z"))).toBeNull();
  });

  it("pagi = 12 teratas, sore = 12 berikutnya, tanpa tumpang tindih", () => {
    const morning = selectPromoProducts(products, new Set(), new Set(), 0);
    const evening = selectPromoProducts(products, new Set(), new Set(), 1);
    expect(morning.map((product) => product.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(evening.map((product) => product.id)).toEqual([13, 14, 15, 16]);
    // Tidak ada produk yang muncul di dua slot.
    expect(morning.some((product) => evening.some((item) => item.id === product.id))).toBe(false);
  });

  it("hierarki katalog dipertahankan (sort_order, bukan acak/bestseller)", () => {
    const morning = selectPromoProducts(products, new Set(), new Set(), 0);
    expect(morning.map((product) => product.id)).toEqual([...morning.map((product) => product.id)].sort((a, b) => a - b));
  });

  it("renders escaped grouped copy: hook owner, harga tegas, tanpa disclaimer", () => {
    const message = promoMessages("morning", products.slice(0, 3)).full;
    expect(message).toContain("ChatGPT &lt;Pro&gt;");
    expect(message).toContain("Sedia semua kebutuhan aplikasi dan tools premium favorit anda, murah, mudah, cepat, dan bergaransi.");
    // Harga tegas varian termurah — tanpa kata "Mulai".
    expect(message).toContain("Rp1.000");
    expect(message).not.toContain("Mulai Rp");
    expect(message).not.toContain("mulai Rp");
    // Footer disclaimer dihapus.
    expect(message).not.toContain("mengikuti katalog");
    expect(message).not.toContain("mengikuti ketersediaan");
    // Kelompok kategori + CTA final.
    expect(message).toContain("AI &amp; CHATBOT");
    expect(message).toContain("Order melalui Bot Telegram:");
    expect(message).toContain("Order melalui Website:");
    expect(message).toContain("https://axvara.tech");
    expect(message).not.toContain("Katalog lengkap");
  });

  it("short bubble ringkas siap forward tanpa disclaimer", () => {
    const message = promoMessages("evening", products.slice(0, 3)).short;
    expect(message).toContain("Ready sore ini");
    expect(message).not.toContain("Mulai");
    expect(message).not.toContain("mulai");
    expect(message).not.toContain("mengikuti");
  });

  it("sends and persists both bubbles once", async () => {
    vi.mocked(sendMessage)
      .mockResolvedValueOnce({ ok: true, result: { message_id: 10 } as never })
      .mockResolvedValueOnce({ ok: true, result: { message_id: 11 } as never });
    const db = database();
    const result = await sendDueAdminPromoDigest(db, new Date("2026-09-27T02:00:00Z"));
    expect(result).toMatchObject({ fullSent: true, shortSent: true, complete: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessage).mock.calls[0][0].chat_id).toBe("-1001");
  });

  it("does not send with fewer than three ready products", async () => {
    const result = await sendDueAdminPromoDigest(database(products.slice(0, 2)), new Date("2026-09-27T02:00:00Z"));
    expect(result.skipped).toBe("insufficient_products");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("retries only the missing short bubble", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: true, result: { message_id: 11 } as never });
    const result = await sendDueAdminPromoDigest(databaseWithFullSent(), new Date("2026-09-27T02:05:00Z"));
    expect(result).toMatchObject({ fullSent: false, shortSent: true, complete: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain("Ready pagi ini");
  });
});
