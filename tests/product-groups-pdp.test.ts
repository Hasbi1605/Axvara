import { afterEach, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/app/(shop)/produk/[slug]/product-detail-client", () => ({ default: () => null }));
afterEach(() => vi.restoreAllMocks());

it("PDP redirect exception escapes the database fallback catch", async () => {
  const f = createD1Fixture();
  try {
    f.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Losing supplier','loser',1,1),(2,'Manual winner','manual-winner',1,1);
      INSERT INTO product_groups(id,name,winner_product_id) VALUES(1,'Same product',2);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1);
    `);
    const { default: page } = await import("@/app/(shop)/produk/[slug]/page");
    await expect(page({ params: Promise.resolve({ slug: "loser" }) })).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/produk/manual-winner;307;" });
  } finally { f.close(); }
});
