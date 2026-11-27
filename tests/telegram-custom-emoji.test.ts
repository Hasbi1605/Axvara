import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telegram/custom-emoji-map", () => ({
  CUSTOM_EMOJI_MAP: {
    "🏠": "1001",
    "🛍": "1002",
    "✅": "1003",
    "⚠": "1004",
    "🇮🇩": "1005",
  },
}));

import {
  MAX_CUSTOM_EMOJI_PER_TEXT,
  applyCustomEmoji,
  customEmojiEnabled,
  decorateButton,
  decorateHtmlText,
} from "@/lib/telegram/custom-emoji";

beforeEach(() => {
  // tests/setup mematikan fitur secara default; nyalakan untuk file ini.
  vi.stubEnv("TELEGRAM_CUSTOM_EMOJI", "on");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tg = (id: string, e: string) => `<tg-emoji emoji-id="${id}">${e}</tg-emoji>`;

describe("decorateHtmlText", () => {
  it("wraps mapped emoji, with or without U+FE0F, and leaves unmapped emoji alone", () => {
    expect(decorateHtmlText("🏠 Menu ✅ ⚠️ 🎮")).toBe(`${tg("1001", "🏠")} Menu ${tg("1003", "✅")} ${tg("1004", "⚠️")} 🎮`);
  });

  it("handles multi-codepoint flags", () => {
    expect(decorateHtmlText("Bahasa 🇮🇩")).toBe(`Bahasa ${tg("1005", "🇮🇩")}`);
  });

  it("does not touch tags, code/pre blocks or existing tg-emoji", () => {
    const input = `<a href="https://x.y/🏠">🏠</a> <code>✅</code> <pre>🛍</pre> ${tg("9", "✅")} <b>✅</b>`;
    expect(decorateHtmlText(input)).toBe(
      `<a href="https://x.y/🏠">${tg("1001", "🏠")}</a> <code>✅</code> <pre>🛍</pre> ${tg("9", "✅")} <b>${tg("1003", "✅")}</b>`,
    );
  });

  it("caps the number of custom emoji per text", () => {
    const out = decorateHtmlText("✅".repeat(MAX_CUSTOM_EMOJI_PER_TEXT + 5));
    expect(out.match(/<tg-emoji/g)?.length).toBe(MAX_CUSTOM_EMOJI_PER_TEXT);
  });
});

describe("decorateButton", () => {
  it("moves a leading mapped emoji into icon_custom_emoji_id", () => {
    expect(decorateButton({ text: "🏠 Menu Utama", callback_data: "home" })).toEqual({
      text: "Menu Utama",
      callback_data: "home",
      icon_custom_emoji_id: "1001",
    });
  });

  it("keeps buttons without a leading mapped emoji, emoji-only buttons and explicit icons", () => {
    const plain = { text: "Menu 🏠" };
    const only = { text: "🏠" };
    const explicit = { text: "🏠 Menu", icon_custom_emoji_id: "77" };
    const unmapped = { text: "🎮 Games" };
    expect(decorateButton(plain)).toBe(plain);
    expect(decorateButton(only)).toBe(only);
    expect(decorateButton(explicit)).toBe(explicit);
    expect(decorateButton(unmapped)).toBe(unmapped);
  });
});

describe("applyCustomEmoji", () => {
  it("decorates HTML text, captions, media captions and keyboards", () => {
    const out = applyCustomEmoji({
      chat_id: 1,
      text: "✅ Lunas",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🛍 Katalog", callback_data: "catalog:0", style: "primary" }]] },
    });
    expect(out.text).toBe(`${tg("1003", "✅")} Lunas`);
    expect(out.reply_markup).toEqual({
      inline_keyboard: [[{ text: "Katalog", callback_data: "catalog:0", style: "primary", icon_custom_emoji_id: "1002" }]],
    });

    const media = applyCustomEmoji({ media: { type: "photo", media: "u", caption: "🏠", parse_mode: "HTML" } });
    expect((media.media as { caption: string }).caption).toBe(tg("1001", "🏠"));
  });

  it("leaves non-HTML text untouched and returns the same object when nothing changes", () => {
    const body = { chat_id: 1, text: "✅ plain" };
    expect(applyCustomEmoji(body)).toBe(body);
  });

  it("is disabled by TELEGRAM_CUSTOM_EMOJI=off", () => {
    vi.stubEnv("TELEGRAM_CUSTOM_EMOJI", "off");
    expect(customEmojiEnabled()).toBe(false);
    const body = { chat_id: 1, text: "✅", parse_mode: "HTML" };
    expect(applyCustomEmoji(body)).toBe(body);
  });

  it("is a no-op with an empty map", () => {
    const body = { chat_id: 1, text: "✅", parse_mode: "HTML" };
    expect(customEmojiEnabled({})).toBe(false);
    expect(applyCustomEmoji(body, {})).toBe(body);
  });
});

describe("callApi custom emoji integration", () => {
  it("sends decorated payload and falls back to standard emoji once on 400", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const ok = bodies.length > 1;
      return new Response(
        JSON.stringify(ok ? { ok: true, result: { message_id: 1 } } : { ok: false, error_code: 400, description: "Bad Request: DOCUMENT_INVALID" }),
        { status: ok ? 200 : 400 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { sendMessage } = await import("@/lib/telegram/api");

    const res = await sendMessage({
      chat_id: 1,
      text: "✅ Lunas",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "🏠 Menu", callback_data: "home" }]] },
    });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies[0].text).toBe(`${tg("1003", "✅")} Lunas`);
    expect((bodies[0].reply_markup as { inline_keyboard: { icon_custom_emoji_id?: string }[][] }).inline_keyboard[0][0].icon_custom_emoji_id).toBe("1001");
    expect(bodies[1].text).toBe("✅ Lunas");
    const fallbackBtn = (bodies[1].reply_markup as { inline_keyboard: { text: string; icon_custom_emoji_id?: string; style?: string }[][] }).inline_keyboard[0][0];
    expect(fallbackBtn.text).toBe("🏠 Menu");
    expect(fallbackBtn.icon_custom_emoji_id).toBeUndefined();
    expect(fallbackBtn.style).toBe("primary");
  });

  it("does not retry on 'message is not modified' or non-400 errors", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message is not modified" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { editMessageText, sendMessage } = await import("@/lib/telegram/api");
    await editMessageText({ chat_id: 1, message_id: 2, text: "✅", parse_mode: "HTML" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests" }), { status: 429 }));
    await sendMessage({ chat_id: 1, text: "✅", parse_mode: "HTML" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("app logos and stripping", () => {
  it("maps product names to app logos, most specific rule first", async () => {
    const { appLogoEmojiId, appLogoHtml, appLogoIcon } = await import("@/lib/telegram/app-logo-emoji");
    expect(appLogoEmojiId("ChatGPT Plus Private")).toBe("5310259124817134249");
    expect(appLogoEmojiId("YouTube Music Premium")).toBe("5335036005168728789");
    expect(appLogoEmojiId("YouTube Premium")).toBe("5321505140199418151");
    expect(appLogoEmojiId("Adobe Express 12M")).toBe("5278668274555436578");
    expect(appLogoEmojiId("Disney+ Hotstar")).toBe("5884437729067932014");
    expect(appLogoEmojiId("iLovePDF Premium")).toBe("6206155660283879718");
    expect(appLogoEmojiId("Surfshark VPN")).toBe("5879507561878654934");
    // Owner 27 Nov: logo yang dulu kosong/kembar kini terpetakan & berbeda.
    expect(appLogoEmojiId("Grok + Cursor Premium")).toBe("5319288443153445517");
    expect(appLogoEmojiId("Muse AI")).toBe("5891219692881714411");
    expect(appLogoEmojiId("ElevenReader Ultra")).toBe("5949555742582251295");
    expect(appLogoEmojiId("ElevenLabs")).toBe("5987854309558066066");
    expect(appLogoEmojiId("Gamma AI")).toBe("5988084597114543318");
    // Vision+ punya logo sendiri, bukan logo Microsoft Visio.
    expect(appLogoEmojiId("Vision Plus")).toBeDefined();
    expect(appLogoEmojiId("Vision Plus")).not.toBe(appLogoEmojiId("Microsoft Visio"));
    for (const name of ["Loklok", "Fizzo Novel", "Drakor ID", "Dramabox", "Getcontact Premium", "Wink VIP"]) {
      expect(appLogoEmojiId(name), name).toBeDefined();
    }
    const ms = ["Office365 Lifetime", "Microsoft 365", "Microsoft Visio", "Microsoft Project", "Windows 10 / 11 Pro", "Microsoft Copilot Premium", "GitHub Copilot"]
      .map((name) => appLogoEmojiId(name));
    expect(ms.every(Boolean)).toBe(true);
    expect(new Set(ms).size).toBe(ms.length);
    expect(appLogoEmojiId("Password Manager")).toBeUndefined();
    expect(appLogoEmojiId("Produk Misterius")).toBeUndefined();
    expect(appLogoHtml("Netflix", "✅")).toBe('<tg-emoji emoji-id="5366477429223209600">✅</tg-emoji>');
    expect(appLogoHtml("Produk Misterius", "✅")).toBe("✅");
    expect(appLogoIcon("Produk Misterius")).toEqual({});
    vi.stubEnv("TELEGRAM_CUSTOM_EMOJI", "off");
    expect(appLogoEmojiId("Netflix")).toBeUndefined();
  });

  it("gives Pedia platforms, coins and QRIS their brand logos", async () => {
    const { brandIcon } = await import("@/lib/telegram/app-logo-emoji");
    expect(brandIcon("instagram")).toEqual({ icon_custom_emoji_id: "5364310996179503764" });
    expect(brandIcon("USDT")).toEqual({ icon_custom_emoji_id: "5413589900450625318" });
    expect(brandIcon("qris")).toEqual({ icon_custom_emoji_id: "6339136888674192137" });
    expect(brandIcon("unknown")).toEqual({});
    const { paymentMethodOfferKeyboard, cryptoCoinKeyboard } = await import("@/lib/telegram/keyboards");
    const methods = [
      { id: "qris", kind: "qris", label: "QRIS" },
      { id: "usdtbsc", kind: "crypto", pay_currency: "usdtbsc", amount_text: "2.61" },
    ] as never;
    const offer = paymentMethodOfferKeyboard({ nonce: "n", methods, idrSubtotal: 20000 });
    const qris = offer.inline_keyboard.flat().find((b) => b.text.includes("QRIS"));
    expect(qris).toMatchObject({ text: "QRIS · Rp20.000", icon_custom_emoji_id: "6339136888674192137" });
    const coins = cryptoCoinKeyboard({ nonce: "n", methods });
    expect(coins?.inline_keyboard[0][0]).toMatchObject({ text: "USDT", icon_custom_emoji_id: "5413589900450625318" });
    vi.stubEnv("TELEGRAM_CUSTOM_EMOJI", "off");
    expect(brandIcon("instagram")).toEqual({});
  });

  it("strips every custom emoji for the standard-emoji fallback", async () => {
    const { stripCustomEmoji, hasCustomEmoji } = await import("@/lib/telegram/custom-emoji");
    const body = {
      text: `${tg("1", "✅")} Netflix <b>x</b>`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Netflix", callback_data: "prd:1", icon_custom_emoji_id: "1" }]] },
    };
    expect(hasCustomEmoji(body)).toBe(true);
    const plain = stripCustomEmoji(body);
    expect(plain.text).toBe("✅ Netflix <b>x</b>");
    expect(plain.reply_markup).toEqual({ inline_keyboard: [[{ text: "Netflix", callback_data: "prd:1" }]] });
    expect(hasCustomEmoji(plain)).toBe(false);
  });
});

describe("reply-menu label canonicalization", () => {
  it("maps emoji-less menu taps back to the full label", async () => {
    const { canonicalMenuLabel, MENU_LABEL_CATALOG, MENU_LABEL_EN, MENU_LABEL_SETTINGS } = await import("@/lib/telegram/keyboards");
    expect(canonicalMenuLabel("Katalog")).toBe(MENU_LABEL_CATALOG);
    expect(canonicalMenuLabel(MENU_LABEL_CATALOG)).toBe(MENU_LABEL_CATALOG);
    expect(canonicalMenuLabel("Catalog")).toBe(MENU_LABEL_EN.catalog);
    expect(canonicalMenuLabel("Bahasa")).toBe(MENU_LABEL_SETTINGS);
    expect(canonicalMenuLabel("netflix premium")).toBe("netflix premium");
  });
});

describe("logo placement in catalog and promo", () => {
  it("prefixes product detail title and promo lines with app logos", async () => {
    const { productDetailMessage } = await import("@/lib/telegram/messages/catalog");
    expect(productDetailMessage({ name: "Netflix Premium", price: 20000, stock: 3 })).toMatch(
      /^<tg-emoji emoji-id="5366477429223209600">📱<\/tg-emoji> <b>Netflix Premium<\/b>/,
    );
    expect(productDetailMessage({ name: "Produk Misterius", price: 1, stock: 1 })).toMatch(/^<b>Produk Misterius<\/b>/);

    const { promoTelegramMessages, promoMessages } = await import("@/lib/telegram/promo-digest");
    const products = [
      { id: 1, name: "Netflix", category: "Streaming & Hiburan", price: 20500 },
      { id: 2, name: "Produk Misterius", category: "Streaming & Hiburan", price: 1000 },
    ];
    const [msg] = promoTelegramMessages("evening", products);
    expect(msg).toContain('<tg-emoji emoji-id="5366477429223209600">✅</tg-emoji> Netflix');
    expect(msg).toContain("✅ Produk Misterius");
    // Versi WhatsApp tidak pernah memuat custom emoji.
    expect(promoMessages("evening", products).short).not.toContain("tg-emoji");
  });
});
