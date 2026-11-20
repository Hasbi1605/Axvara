import { afterEach, describe, expect, it, vi } from "vitest";
import { applyButtonStyles } from "@/lib/telegram/button-style";
import type { AnyReplyMarkup, InlineKeyboardMarkup, ReplyKeyboardMarkup } from "@/lib/telegram/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("applyButtonStyles", () => {
  it("applies danger style to destructive callbacks and texts", () => {
    const markup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "A", callback_data: "cancel:AXV-1" },
          { text: "B", callback_data: "cancelok:AXV-1" },
          { text: "C", callback_data: "cclear" },
          { text: "D", callback_data: "crm:9" },
        ],
        [
          { text: "❌ Batal", callback_data: "prd:1" },
          { text: "Batalkan Pesanan", callback_data: "noop" },
          { text: "Hapus item", callback_data: "noop" },
          { text: "🧹 Kosongkan", callback_data: "noop" },
        ],
        [
          { text: "Cancel Order", callback_data: "noop" },
          { text: "Remove Canva", callback_data: "noop" },
          { text: "Clear", callback_data: "noop" },
        ],
      ],
    };
    const styled = applyButtonStyles(markup);
    for (const btn of styled.inline_keyboard.flat()) {
      expect(btn.style).toBe("danger");
    }
  });

  it("applies success style to purchase/product/variant/confirm/payment callbacks and texts", () => {
    const markup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "Canva Pro · Rp15.000", callback_data: "prd:3" },
          { text: "Pilih Varian", callback_data: "buy:3" },
          { text: "Ganti Varian", callback_data: "vars:3" },
          { text: "1 Bulan · Rp15.000 · stok 5", callback_data: "var:7" },
        ],
        [
          { text: "A", callback_data: "pay:1:2:1" },
          { text: "B", callback_data: "epay:1:2:1:tag:n" },
          { text: "C", callback_data: "cconfirm:tag" },
          { text: "D", callback_data: "ccheckout" },
          { text: "E", callback_data: "pmentry" },
          { text: "F", callback_data: "pmentry:1:2:1:tag" },
        ],
        [
          { text: "G", callback_data: "pm:nonce:0" },
          { text: "H", callback_data: "pmc:nonce" },
          { text: "I", callback_data: "pmb:nonce" },
          { text: "J", callback_data: "pgo:nonce" },
          { text: "K", callback_data: "gconsent:AXV-1:100:ab" },
          { text: "L", callback_data: "cadd:1:2:1" },
          { text: "M", callback_data: "claimstart:AXV-1" },
          { text: "N", callback_data: "confirm:1" },
          { text: "O", callback_data: "cfv:1:7" },
        ],
        [
          { text: "Bayar Sekarang", callback_data: "noop" },
          { text: "Pay Now", callback_data: "noop" },
          { text: "Checkout", callback_data: "noop" },
          { text: "🔁 Beli Lagi", callback_data: "reorder:5" },
          { text: "Konfirmasi", callback_data: "noop" },
          { text: "Lanjut ke pembayaran", callback_data: "noop" },
          { text: "🔄 QRIS Baru", callback_data: "qrenew:AXV-1" },
          { text: "Crypto (USD)", callback_data: "noop" },
          { text: "Tambah ke Keranjang", callback_data: "noop" },
          { text: "Ajukan Klaim", callback_data: "noop" },
        ],
      ],
    };
    const styled = applyButtonStyles(markup);
    for (const btn of styled.inline_keyboard.flat()) {
      expect(btn.style).toBe("success");
    }
  });

  it("applies primary style to navigation, catalog, qty steppers, presets, restock, terms, URLs, and keeps soldout danger explicit", () => {
    const markup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "🛍 Katalog", callback_data: "catalog:0" },
          { text: "📂 Kategori", callback_data: "cats:0" },
          { text: "AI", callback_data: "cat:1:0" },
          { text: "➖ Kurangi", callback_data: "q:1:7:1" },
          { text: "10", callback_data: "q:1:7:10" },
        ],
        [
          { text: "🏠 Menu", callback_data: "home" },
          { text: "◀️ Kembali", callback_data: "q:1:7:2" },
          { text: "💬 Bantuan", callback_data: "help" },
          { text: "🛡 Garansi", callback_data: "warranty" },
          { text: "🌐 Bahasa", callback_data: "langmenu" },
          { text: "💱 Mata Uang", callback_data: "curmenu" },
        ],
        [
          { text: "🔔 Kabari saat restok", callback_data: "rst:3" },
          { text: "📋 Ketentuan", callback_data: "terms:3:0" },
          { text: "📦 Pesanan", callback_data: "myorders" },
          { text: "🔎 Cari", callback_data: "search" },
          { text: "🛒 Keranjang", callback_data: "cart" },
          { text: "1/3", callback_data: "noop" },
        ],
        [
          { text: "💬 WhatsApp Admin", url: "https://axvara.tech/wa" },
          { text: "👁 Lihat pesanan pembeli", url: "https://axvara.tech/lacak-pesanan?code=AXV-1" },
          { text: "💬 WA Pembeli", url: "https://wa.me/628123456789" },
          { text: "🔄 Buka detail pembayaran", callback_data: "refresh:AXV-1" },
          { text: "Open payment page", url: "https://pay.example.test/1" },
        ],
      ],
    };
    const styled = applyButtonStyles(markup);
    for (const btn of styled.inline_keyboard.flat()) {
      expect(btn.style).toBe("primary");
    }

    const soldoutMarkup = applyButtonStyles<InlineKeyboardMarkup>({
      inline_keyboard: [[
        { text: "1 Bulan · Rp15.000 · stok 5", callback_data: "var:7" },
        { text: "❌ 3 Bulan · Habis", callback_data: "soldout", style: "danger" },
      ]],
    });
    expect(soldoutMarkup.inline_keyboard[0][0].style).toBe("success");
    expect(soldoutMarkup.inline_keyboard[0][1].style).toBe("danger");
  });

  it("preserves explicit style already set on buttons without mutating input", () => {
    const markup: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "🛒 Tambah ke Keranjang", callback_data: "cadd:1:2:1", style: "primary" },
          { text: "⬅ Kembali", callback_data: "pmb:nonce", style: "primary" },
          { text: "Custom Red Info", callback_data: "home", style: "danger" },
          { text: "Default Nav", callback_data: "home" },
        ],
      ],
    };
    const snapshot = JSON.stringify(markup);
    const styled = applyButtonStyles(markup);
    expect(JSON.stringify(markup)).toBe(snapshot);
    expect(styled).not.toBe(markup);
    expect(styled.inline_keyboard[0][0].style).toBe("primary");
    expect(styled.inline_keyboard[0][1].style).toBe("primary");
    expect(styled.inline_keyboard[0][2].style).toBe("danger");
    expect(styled.inline_keyboard[0][3].style).toBe("primary");
  });

  it("styles ReplyKeyboardMarkup buttons (Bot API 9.4) and preserves explicit styles", () => {
    const reply: ReplyKeyboardMarkup = {
      keyboard: [
        [{ text: "🛍 Katalog" }, { text: "🔎 Cari" }],
        [{ text: "💳 Bayar" }, { text: "Batal", style: "danger" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
    const styled = applyButtonStyles(reply);
    expect(styled.keyboard[0][0].style).toBe("primary");
    expect(styled.keyboard[0][1].style).toBe("primary");
    expect(styled.keyboard[1][0].style).toBe("success");
    expect(styled.keyboard[1][1].style).toBe("danger");
  });

  it("leaves force_reply and remove_keyboard markups untouched", () => {
    const forceReply: AnyReplyMarkup = { force_reply: true, input_field_placeholder: "email" };
    const removeKb: AnyReplyMarkup = { remove_keyboard: true, selective: true };
    expect(applyButtonStyles(forceReply)).toEqual({ force_reply: true, input_field_placeholder: "email" });
    expect(applyButtonStyles(removeKb)).toEqual({ remove_keyboard: true, selective: true });
    expect("style" in applyButtonStyles(forceReply)).toBe(false);
    expect("style" in applyButtonStyles(removeKb)).toBe(false);
  });
});

describe("api.ts outgoing reply_markup styling", () => {
  it("applies button styles across sendMessage, sendPhoto, editMessageText, and editMessageMedia", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { sendMessage, sendPhoto, editMessageText, editMessageMedia } = await import("@/lib/telegram/api");

    await sendMessage({
      chat_id: 1,
      text: "hi",
      reply_markup: { inline_keyboard: [[{ text: "🛍 Katalog", callback_data: "catalog:0" }, { text: "Cancel", callback_data: "cancel:AXV-1" }]] },
    });
    await sendPhoto({
      chat_id: 1,
      photo: "https://axvara.tech/banner.jpg",
      reply_markup: { keyboard: [[{ text: "🛍 Katalog" }]], resize_keyboard: true },
    });
    await editMessageText({
      chat_id: 1,
      message_id: 2,
      text: "edit",
      reply_markup: { inline_keyboard: [[{ text: "💳 Pay", callback_data: "pay:1:2:1" }]] },
    });
    await editMessageMedia({
      chat_id: 1,
      message_id: 2,
      media: { type: "photo", media: "https://axvara.tech/p.jpg" },
      reply_markup: { inline_keyboard: [[{ text: "🏠 Menu", callback_data: "home" }]] },
    });
    await sendMessage({
      chat_id: 1,
      text: "reply",
      reply_markup: { force_reply: true, input_field_placeholder: "Type" },
    });

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies[0].reply_markup.inline_keyboard[0]).toEqual([
      { text: "🛍 Katalog", callback_data: "catalog:0", style: "primary" },
      { text: "Cancel", callback_data: "cancel:AXV-1", style: "danger" },
    ]);
    expect(bodies[1].reply_markup.keyboard[0]).toEqual([{ text: "🛍 Katalog", style: "primary" }]);
    expect(bodies[2].reply_markup.inline_keyboard[0]).toEqual([{ text: "💳 Pay", callback_data: "pay:1:2:1", style: "success" }]);
    expect(bodies[3].reply_markup.inline_keyboard[0]).toEqual([{ text: "🏠 Menu", callback_data: "home", style: "primary" }]);
    expect(bodies[4].reply_markup).toEqual({ force_reply: true, input_field_placeholder: "Type" });
  });
});
