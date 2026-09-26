import { beforeEach, describe, expect, it, vi } from "vitest";
import { promoMessages, promoSlotAt, selectPromoProducts, sendDueAdminPromoDigest } from "@/lib/telegram/promo-digest";
import type { DatabaseAccess } from "@/lib/db-access";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn() }));
import { sendMessage } from "@/lib/telegram/api";

const products = [
  { id: 1, name: "ChatGPT <Pro>", category: "AI", price: 10000 },
  { id: 2, name: "Canva", category: "Kreator", price: 5000 },
  { id: 3, name: "Netflix", category: "Hiburan", price: 26000 },
  { id: 4, name: "Office", category: "Produktivitas", price: 15000 },
  { id: 5, name: "Spotify", category: "Hiburan", price: 9000 },
];

function database(rows: Record<string, unknown>[] = products): DatabaseAccess {
  let digest: Record<string, unknown> | null = null;
  return {
    d1: null, getD1: () => null, isD1Mode: () => false, canSpend: () => true,
    queryAll: vi.fn(async (query: string) => query.includes("FROM products") ? rows : []),
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
    queryAll: vi.fn(async (query: string) => query.includes("FROM products") ? products : [{ business_date: "2026-09-27", slot: "morning", product_ids: digest.product_ids }]),
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

  it("prefers fresh products and avoids the other daily slot", () => {
    const selected = selectPromoProducts(products, new Set([1]), new Set([2]), 0);
    expect(selected).toHaveLength(4);
    expect(selected.map((product) => product.id)).not.toContain(1);
    expect(selected.map((product) => product.id)).toContain(2);
  });

  it("renders escaped copy with the final order CTAs", () => {
    const message = promoMessages("morning", products.slice(0, 3)).full;
    expect(message).toContain("ChatGPT &lt;Pro&gt;");
    expect(message).toContain("Order melalui Bot Telegram:");
    expect(message).toContain("Order melalui Website:");
    expect(message).toContain("https://axvara.tech");
    expect(message).not.toContain("Katalog lengkap");
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
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain("Produk premium ready pagi ini");
  });
});
