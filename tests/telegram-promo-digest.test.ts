import { beforeEach, describe, expect, it, vi } from "vitest";
import { promoMessages, promoSlotAt, selectPromoProducts, sendDueAdminPromoDigest } from "@/lib/telegram/promo-digest";
import type { DatabaseAccess } from "@/lib/db-access";

vi.mock("@/lib/telegram/api", () => ({ sendMessage: vi.fn() }));
import { sendMessage } from "@/lib/telegram/api";

// Kontrak 2026-10-01 (keputusan owner — koreksi: contoh ceklisnya saja
// dari WR/SEKUDIL, TANPA meniru seksi instan/MBO): format Axvara yang sudah
// ada dipertahankan (judul + hook + kelompok kategori + CTA), hanya +
// emoji ✅ per baris produk + SEMUA produk ready masuk pesan (bukan paruh).
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

  it("SEMUA ready masuk pesan (bukan paruh 12): pagi = sore = seluruh katalog", () => {
    const morning = selectPromoProducts(products, new Set(), new Set(), 0);
    const evening = selectPromoProducts(products, new Set(), new Set(), 1);
    expect(morning.map((product) => product.id)).toEqual(products.map((product) => product.id));
    expect(evening.map((product) => product.id)).toEqual(products.map((product) => product.id));
  });

  it("renders format Axvara + ceklis per baris + hook + CTA", () => {
    const message = promoMessages("morning", products.slice(0, 3)).full;
    // Judul: emoji api + PRODUK AXVARA READY (tanpa hitungan — keputusan
    // owner 2026-10-01).
    expect(message).toContain("🔥 <b>PRODUK AXVARA READY PAGI INI</b>");
    expect(message).not.toContain("PRODUK AXVARA\n");
    // Garis pemisah + intro dua baris (contoh manual owner 2026-10-03).
    expect(message).toContain("------------------------------------------------------------------");
    expect(message).toContain("Sedia semua kebutuhan aplikasi dan tools premium favorit anda.\nMurah, mudah, cepat, dan bergaransi.");
    expect(message).toContain("ChatGPT &lt;Pro&gt;");
    // Emoji ceklis per baris produk ready (contoh WR/SEKUDIL).
    expect(message).toContain("✅ Produk 2");
    // Harga tegas varian termurah — tanpa kata "Mulai".
    expect(message).toContain("Rp1.000");
    expect(message).not.toContain("Mulai Rp");
    expect(message).not.toContain("mulai Rp");
    // Footer disclaimer dihapus.
    expect(message).not.toContain("mengikuti katalog");
    expect(message).not.toContain("mengikuti ketersediaan");
    // Kelompok kategori + CTA final (format Axvara dipertahankan).
    expect(message).toContain("AI &amp; CHATBOT");
    expect(message).toContain("Order melalui Bot Telegram:");
    expect(message).toContain("Order melalui Website:");
    expect(message).toContain("https://axvara.tech");
    expect(message).not.toContain("Katalog lengkap");
    // CTA: website dulu, baru bot (contoh manual owner 2026-10-03).
    expect(message.indexOf("Order melalui Website:")).toBeLessThan(message.indexOf("Order melalui Bot Telegram:"));
    // Deep-link langsung buka bot dengan payload beli (keputusan owner
    // 2026-10-01): tap link → chat pribadi langsung siap order.
    expect(message).toContain("https://t.me/Axvara_bot?start=beli");
  });

  it("ikon Desain & Video = palet, bukan robot (insiden owner 2026-10-03: 'desain' mengandung 'ai')", () => {
    const message = promoMessages("morning", products.slice(0, 4)).full;
    expect(message).toContain("🎨 <b>DESAIN &amp; VIDEO</b>");
    expect(message).not.toContain("🤖 <b>DESAIN");
    expect(message).toContain("🤖 <b>AI &amp; CHATBOT</b>");
  });

  it("judul sore: api + PRODUK AXVARA READY SORE INI", () => {
    const message = promoMessages("evening", products.slice(0, 3)).full;
    expect(message).toContain("🔥 <b>PRODUK AXVARA READY SORE INI</b>");
    expect(message).not.toContain("PRODUK AXVARA\n");
  });

  it("short = versi WA siap copy-paste: sama persis dengan full, bold pakai *", () => {
    const { full, short } = promoMessages("evening", products.slice(0, 4));
    // Judul + header kategori + CTA memakai * literal ala WA, bukan <b>.
    expect(short).toContain("🔥 *PRODUK AXVARA READY SORE INI*");
    expect(short).not.toContain("<b>");
    expect(short).not.toContain("</b>");
    expect(short).toContain("*DESAIN & VIDEO*");
    expect(short).toContain("🎨 *DESAIN & VIDEO*");
    expect(short).toContain("*Order melalui Website:*");
    expect(short).toContain("*Order melalui Bot Telegram:*");
    // Garis pemisah + intro dua baris persis seperti full.
    expect(short).toContain("------------------------------------------------------------------");
    expect(short).toContain("Sedia semua kebutuhan aplikasi dan tools premium favorit anda.\nMurah, mudah, cepat, dan bergaransi.");
    // Header kategori tanpa escape HTML (teks polos untuk WA).
    expect(short).toContain("AI & CHATBOT");
    // Nama produk mentah (tanpa &lt;) — dikirim tanpa parse_mode HTML.
    expect(short).toContain("ChatGPT <Pro>");
    expect(short).toContain("✅ Produk 2");
    expect(short).toContain("https://t.me/Axvara_bot?start=beli");
    expect(short).toContain("https://axvara.tech");
    expect(short).not.toContain("Mulai");
    expect(short).not.toContain("mulai");
    expect(short).not.toContain("mengikuti");
    // Body sama persis selain markup bold (full=<b>, short=*) agar owner
    // bisa copy dari Telegram lalu paste ke WA tanpa edit manual.
    // Full di-escape HTML (&amp;/&lt;), short teks polos — samakan dulu.
    const unescape = (text: string) => text
      .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");
    const normalize = (text: string) => unescape(text).replaceAll(/<\/?b>/g, "*");
    const stripUrls = (text: string) => text.replaceAll("https://t.me/Axvara_bot?start=beli", "BOT").replaceAll("https://axvara.tech", "WEB");
    expect(stripUrls(short)).toBe(stripUrls(normalize(full)));
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
    // Bubble kedua = versi WA siap copy-paste (bold * literal).
    expect(vi.mocked(sendMessage).mock.calls[0][0].text).toContain("🔥 *PRODUK AXVARA READY PAGI INI*");
  });

  it("short bubble dikirim tanpa parse_mode HTML (copy *-WA aman)", async () => {
    vi.mocked(sendMessage)
      .mockResolvedValueOnce({ ok: true, result: { message_id: 10 } as never })
      .mockResolvedValueOnce({ ok: true, result: { message_id: 11 } as never });
    const db = database();
    await sendDueAdminPromoDigest(db, new Date("2026-09-27T02:00:00Z"));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendMessage).mock.calls[0][0].parse_mode).toBe("HTML");
    expect(vi.mocked(sendMessage).mock.calls[1][0].parse_mode).toBeUndefined();
  });
});
