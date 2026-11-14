import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fx = createD1Fixture(); });
afterEach(() => { fx.close(); });

const insert = (sku: string, over: Record<string, unknown>) => {
  const row: Record<string, unknown> = { buyer_sku_code: sku, product_name: "Diamond", ...over };
  const keys = Object.keys(row);
  fx.sql.prepare(`INSERT INTO games_products(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`)
    .run(...keys.map((key) => row[key]));
};

describe("Games sitemap", () => {
  it("lists every enabled SK game slug (not a four-game registry) plus legacy history", async () => {
    for (let i = 0; i < 14; i++) {
      insert(`sk:${1000 + i}`, {
        supplier: "sekalipay", supplier_active: 1, sk_variant_id: 1000 + i, sk_product_id: 200 + i,
        sk_product_name: `Game ${i}`, game_slug: `game-${i}`, sell_price: 1000 + i, enabled: 1,
      });
    }
    insert("sk:1999", { supplier: "sekalipay", supplier_active: 1, sk_variant_id: 1999, sk_product_id: 999, sk_product_name: "Disabled", game_slug: "disabled-game", sell_price: 1000, enabled: 0 });
    insert("sk:1998", { supplier: "sekalipay", supplier_active: 0, sk_variant_id: 1998, sk_product_id: 998, sk_product_name: "Utility", game_slug: "utility-game", product_name: "Cek Username", sell_price: 1000, enabled: 1 });
    insert("ml86", { supplier: "digiflazz", game_brand: "MOBILE LEGENDS", sell_price: 11000, enabled: 1 });
    const { default: sitemap } = await import("@/app/games/sitemap");
    const entries = await sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain("https://games.axvara.tech/");
    for (let i = 0; i < 14; i++) expect(urls).toContain(`https://games.axvara.tech/game-${i}`);
    // DGF legacy tidak pernah masuk sitemap publik, termasuk slug registry lama.
    expect(urls).not.toContain("https://games.axvara.tech/mobile-legends");
    expect(urls).not.toContain("https://games.axvara.tech/disabled-game");
    expect(urls).not.toContain("https://games.axvara.tech/utility-game");
    expect(urls).toHaveLength(15);
  });

  it("excludes games hidden by admin (games_meta.hidden=1)", async () => {
    insert("sk:3001", {
      supplier: "sekalipay", supplier_active: 1, sk_variant_id: 3001, sk_product_id: 3001,
      sk_product_name: "Visible", game_slug: "visible-game", sell_price: 1000, enabled: 1,
    });
    insert("sk:3002", {
      supplier: "sekalipay", supplier_active: 1, sk_variant_id: 3002, sk_product_id: 3002,
      sk_product_name: "Hidden", game_slug: "hidden-game", sell_price: 1000, enabled: 1,
    });
    fx.sql.exec("INSERT INTO games_meta(slug,hidden) VALUES('hidden-game',1),('visible-game',0)");
    const { default: sitemap } = await import("@/app/games/sitemap");
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain("https://games.axvara.tech/visible-game");
    expect(urls).not.toContain("https://games.axvara.tech/hidden-game");
  });
});
