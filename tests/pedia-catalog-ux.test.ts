import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { GET } from "@/app/api/pedia/catalog/route";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function seed() {
  const fixture = createD1Fixture();
  vi.stubEnv("PEDIA_ENABLED", "true");
  const db = createDatabaseAccess(fixture.db);
  await db.execRun(`INSERT INTO pedia_products (slug, platform, metric, target_kind, name, packages_json, step, is_active) VALUES ('ig','instagram','followers','profile','IG','[500,100,250,100,105]',10,1)`);
  const product = await db.queryFirst("SELECT id FROM pedia_products WHERE slug='ig'");
  for (const [tier, service, min, max, prices] of [
    ["premium", 3, 250, 500, '{"100":1000,"250":5000,"500":8000}'],
    ["standar", 2, 100, 250, '{"100":3000,"105":3500,"250":6000,"500":9000}'],
    ["hemat", 1, 100, 500, '{"100":2000,"250":0,"500":-1,"750":10000}'],
  ] as const) {
    await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,type,category,rate_idr_per_1k,min_qty,max_qty,present) VALUES ('providersmm',?,'private-name','Default','IG',500,?,?,1)`, service, min, max);
    await db.execRun(`INSERT INTO pedia_tiers (product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,package_prices_json,is_active) VALUES (?,?,'providersmm',?,'G3',20,1000,?,1)`, Number(product?.id), tier, service, prices);
  }
  return db;
}
describe("public catalog safe tier packages", () => {
  it("filters each tier by its own bounds, positive prices and configured steps; sorts deterministically", async () => {
    await seed();
    const data = await (await GET()).json();
    const p = data.products[0];
    expect(p.packages).toEqual([100, 250, 500]);
    expect(p.tiers.map((t: { tier: string }) => t.tier)).toEqual(["hemat", "standar", "premium"]);
    expect(p.tiers.map((t: { prices: unknown }) => t.prices)).toEqual([{ "100": 2000 }, { "100": 3000, "250": 6000 }, { "250": 5000, "500": 8000 }]);
    expect(p.tiers[1]).toMatchObject({ min_qty: 100, max_qty: 250 });
    expect(p.min_price).toBe(2000);
    expect(JSON.stringify(data)).not.toMatch(/supplier|rate_idr|private-name|markup/);
  });
  it("does not offer tiers with absent service bounds or no valid prices", async () => {
    const db = await seed();
    await db.execRun("UPDATE pedia_supplier_services SET present=0 WHERE service_id=2");
    await db.execRun("UPDATE pedia_tiers SET package_prices_json='{}' WHERE tier='premium'");
    const data = await (await GET()).json();
    expect(data.products[0].tiers.map((t: { tier: string }) => t.tier)).toEqual(["hemat"]);
    expect(data.products[0].packages).toEqual([100]);
  });
  it("omits a product rather than displaying a missing or nonpositive price", async () => {
    const db = await seed();
    await db.execRun("UPDATE pedia_tiers SET package_prices_json='{\"100\":0,\"250\":-1,\"500\":null}'");
    expect((await (await GET()).json()).products).toEqual([]);
  });
  it("excludes incompatible service types while retaining supported Default tiers", async () => {
    const db = await seed();
    await db.execRun("UPDATE pedia_supplier_services SET type='Custom Comments' WHERE service_id=1");
    const response = await GET();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.products[0].tiers.map((t: { tier: string }) => t.tier)).toEqual(["standar", "premium"]);
    expect(data.products[0].min_price).toBe(3000);
    await db.execRun("UPDATE pedia_supplier_services SET type='Custom Comments'");
    expect((await (await GET()).json()).products).toEqual([]);
  });
  it.each(["null", "[]", "123", "true", '"price"', "not-json", '{"100":null,"250":{},"500":[8000]}', '{"100":true,"250":"6000","500":false}'])("omits malformed price data %s without crashing", async (prices) => {
    const db = await seed();
    await db.execRun("UPDATE pedia_tiers SET package_prices_json=?", prices);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).products).toEqual([]);
  });
  it("retains valid numeric prices when neighboring values are malformed", async () => {
    const db = await seed();
    await db.execRun("UPDATE pedia_tiers SET package_prices_json='{\"100\":3000,\"250\":{},\"500\":null}'");
    const data = await (await GET()).json();
    expect(data.products[0].packages).toEqual([100]);
    expect(data.products[0].tiers.map((t: { prices: unknown }) => t.prices)).toEqual([{ "100": 3000 }, { "100": 3000 }]);
  });
});
