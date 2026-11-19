import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPromoProducts,
  promoBannerCaption,
  promoMessages,
  promoSlotAt,
  promoTelegramMessages,
  TELEGRAM_PROMO_FOOTER,
} from "@/lib/telegram/promo-digest";
import { createDatabaseAccess } from "@/lib/db-access";
import { createD1Fixture } from "./helpers/d1-fixture";

const products = Array.from({ length: 16 }, (_, i) => ({
  id: i + 1,
  name: i === 0 ? "ChatGPT <Pro>" : `Produk ${i + 1}`,
  category: ["AI & Chatbot", "Streaming & Hiburan", "Produktivitas & Office", "Desain & Video"][i % 4],
  price: (i + 1) * 1000,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Telegram promo digest helpers", () => {
  it("uses exact WIB delivery windows", () => {
    expect(promoSlotAt(new Date("2026-09-27T01:59:59Z"))).toBeNull();
    expect(promoSlotAt(new Date("2026-09-27T02:00:00Z"))).toEqual({ businessDate: "2026-09-27", slot: "morning" });
    expect(promoSlotAt(new Date("2026-09-27T04:59:59Z"))?.slot).toBe("morning");
    expect(promoSlotAt(new Date("2026-09-27T05:00:00Z"))).toBeNull();
    expect(promoSlotAt(new Date("2026-09-27T10:00:00Z"))?.slot).toBe("evening");
    expect(promoSlotAt(new Date("2026-09-27T13:00:00Z"))).toBeNull();
  });

  it("renders format Axvara + ceklis per baris + hook + CTA", () => {
    const message = promoMessages("morning", products.slice(0, 3)).full;
    expect(message).toContain("🔥 <b>PRODUK AXVARA READY PAGI INI</b>");
    expect(message).not.toContain("PRODUK AXVARA\n");
    expect(message).toContain("------------------------------------------------------------------");
    expect(message).toContain("Sedia semua kebutuhan aplikasi dan tools premium favorit anda.\nMurah, mudah, cepat, dan bergaransi.");
    expect(message).toContain("ChatGPT &lt;Pro&gt;");
    expect(message).toContain("✅ Produk 2");
    expect(message).toContain("Rp1.000");
    expect(message).not.toContain("Mulai Rp");
    expect(message).not.toContain("mulai Rp");
    expect(message).not.toContain("mengikuti katalog");
    expect(message).not.toContain("mengikuti ketersediaan");
    expect(message).toContain("AI &amp; CHATBOT");
    expect(message).toContain("Order melalui Bot Telegram:");
    expect(message).toContain("Order melalui Website:");
    expect(message).toContain("https://axvara.tech");
    expect(message).not.toContain("Katalog lengkap");
    expect(message.indexOf("Order melalui Website:")).toBeLessThan(message.indexOf("Order melalui Bot Telegram:"));
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
    expect(promoBannerCaption("morning")).toBe("🔥 <b>PRODUK AXVARA READY PAGI INI</b>");
    expect(promoBannerCaption("evening")).toBe("🔥 <b>PRODUK AXVARA READY SORE INI</b>");
  });

  it("short = versi WA siap copy-paste: sama persis dengan full, bold pakai *", () => {
    const { full, short } = promoMessages("evening", products.slice(0, 4));
    expect(short).toContain("🔥 *PRODUK AXVARA READY SORE INI*");
    expect(short).not.toContain("<b>");
    expect(short).not.toContain("</b>");
    expect(short).toContain("*DESAIN & VIDEO*");
    expect(short).toContain("🎨 *DESAIN & VIDEO*");
    expect(short).toContain("*Order melalui Website:*");
    expect(short).toContain("*Order melalui Bot Telegram:*");
    expect(short.split("\n").filter(line => /^-+$/.test(line))).toEqual(["-".repeat(52), "-".repeat(52)]);
    expect(full).toContain("-".repeat(66));
    expect(short).toContain("Sedia semua kebutuhan aplikasi dan tools premium favorit anda.\nMurah, mudah, cepat, dan bergaransi.");
    expect(short).toContain("AI & CHATBOT");
    expect(short).toContain("ChatGPT <Pro>");
    expect(short).toContain("✅ Produk 2");
    expect(short).toContain("https://t.me/Axvara_bot?start=beli");
    expect(short).toContain("https://axvara.tech");
    expect(short).not.toContain("Mulai");
    expect(short).not.toContain("mulai");
    expect(short).not.toContain("mengikuti");
    const unescape = (text: string) => text
      .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&");
    const normalize = (text: string) => unescape(text).replaceAll(/<\/?b>/g, "*");
    const stripUrls = (text: string) => text.replaceAll("https://t.me/Axvara_bot?start=beli", "BOT").replaceAll("https://axvara.tech", "WEB");
    expect(stripUrls(short)).toBe(stripUrls(normalize(full)).replaceAll("-".repeat(66), "-".repeat(52)));
  });

  it("promoTelegramMessages appends /stop footer and splits >4096 chars at category boundaries without breaking HTML or lines", () => {
    const shortList = promoTelegramMessages("morning", products.slice(0, 4));
    expect(shortList).toHaveLength(1);
    expect(shortList[0]).toBe(`${promoMessages("morning", products.slice(0, 4)).full}\n\n${TELEGRAM_PROMO_FOOTER}`);
    expect(shortList[0].length).toBeLessThanOrEqual(4096);

    const manyProducts = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      name: `Aplikasi Premium Panjang Banget Nomor ${i + 1} <Special>`,
      category: `Kategori ${Math.floor(i / 15) + 1}`,
      price: (i + 1) * 1500,
    }));
    const chunks = promoTelegramMessages("evening", manyProducts);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
      const opens = (chunk.match(/<b>/g) || []).length;
      const closes = (chunk.match(/<\/b>/g) || []).length;
      expect(opens).toBe(closes);
      // Every product line stays intact (never cut mid-line)
      for (const line of chunk.split("\n")) {
        if (line.startsWith("✅")) expect(line).toMatch(/^✅ .+ — Rp[\d.]+$/);
      }
    }
    // Category boundary check: Kategori headers are never orphaned from their first item
    for (let idx = 0; idx < chunks.length; idx++) {
      expect(chunks[idx].trim().endsWith("</b>")).toBe(false);
    }
    expect(chunks[chunks.length - 1]).toContain(TELEGRAM_PROMO_FOOTER);
    expect(chunks[chunks.length - 1]).toContain("Order melalui Website:");
  });

  it("loadPromoProducts mengurutkan kategori sesuai categories.sort_order (lalu nama/id), produk urut sort_order lalu id, tanpa kategori terakhir", async () => {
    const f = createD1Fixture();
    try {
      f.sql.exec(`
        DELETE FROM categories;
        INSERT INTO categories(id,name,slug,sort_order) VALUES
          (1,'AI & Chatbot','ai-chatbot',1),
          (5,'Desain & Video','desain-video',4),
          (6,'Developer & Tools','developer-tools',5),
          (9,'Zeta SameOrder','zeta',2),
          (8,'Alpha SameOrder','alpha',2);
        INSERT INTO products(id,category_id,name,slug,price,is_active,sort_order) VALUES
          (416,6,'JetBrains Edu','jetbrains-edu',25000,1,0),
          (102,1,'Claude Pro','claude-pro',95000,1,20),
          (103,1,'ChatGPT Plus','chatgpt-plus',89000,1,10),
          (101,1,'AI TieBreak','ai-tiebreak',75000,1,10),
          (200,5,'Canva Pro','canva-pro',45000,1,5),
          (301,9,'Zeta Tool','zeta-tool',15000,1,1),
          (302,8,'Alpha Tool','alpha-tool',12000,1,2),
          (999,NULL,'Uncategorized Tool','uncat',5000,1,0);
        INSERT INTO product_variants(product_id,sku,label,price,stock,is_active) VALUES
          (416,'JB','1Y',25000,-1,1),
          (102,'CL','1M',95000,5,1),
          (103,'CG','1M',89000,5,1),
          (101,'AT','1M',75000,5,1),
          (200,'CV','1Y',45000,5,1),
          (301,'ZT','1M',15000,5,1),
          (302,'AL','1M',12000,5,1),
          (999,'UC','1M',5000,5,1);
      `);
      const loaded = await loadPromoProducts(createDatabaseAccess(f.db));
      expect(loaded.map((p) => p.id)).toEqual([101, 103, 102, 302, 301, 200, 416, 999]);
      const { full, short } = promoMessages("evening", loaded);
      for (const body of [full, short]) {
        const aiPos = body.indexOf("AI");
        const alphaPos = body.indexOf("ALPHA SAMEORDER");
        const zetaPos = body.indexOf("ZETA SAMEORDER");
        const desainPos = body.indexOf("DESAIN");
        const devPos = body.indexOf("DEVELOPER");
        const uncatPos = body.indexOf("PRODUK PREMIUM");
        expect(aiPos).toBeGreaterThan(-1);
        expect(aiPos).toBeLessThan(alphaPos);
        expect(alphaPos).toBeLessThan(zetaPos);
        expect(zetaPos).toBeLessThan(desainPos);
        expect(desainPos).toBeLessThan(devPos);
        expect(devPos).toBeLessThan(uncatPos);
        // Inside AI & Chatbot: sort_order 10 (id 101 then id 103), then sort_order 20 (id 102)
        expect(body.indexOf("AI TieBreak")).toBeLessThan(body.indexOf("ChatGPT Plus"));
        expect(body.indexOf("ChatGPT Plus")).toBeLessThan(body.indexOf("Claude Pro"));
      }
    } finally {
      f.close();
    }
  });
});
