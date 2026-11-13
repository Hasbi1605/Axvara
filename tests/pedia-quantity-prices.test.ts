import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { GET } from "@/app/api/pedia/prices/route";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

const previous = process.env.PEDIA_ENABLED;
let fixture: ReturnType<typeof createD1Fixture> | undefined;
afterEach(() => { fixture?.close(); fixture = undefined; if (previous === undefined) delete process.env.PEDIA_ENABLED; else process.env.PEDIA_ENABLED = previous; clearRateLimitBucketsForTest(); });

describe("Pedia comparison prices", () => {
  it("uses true minimum-profit and rounding rules at arbitrary quantities, without exposing cost", async () => {
    process.env.PEDIA_ENABLED = "true";
    fixture = createD1Fixture();
    await fixture.db.prepare("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name,packages_json,step,is_active) VALUES(1,'followers-github','github','followers','profile','Followers GitHub','[100]',1,1)").run();
    await fixture.db.prepare("INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty) VALUES('indosmm',123,'private upstream name','GitHub','Default',1000,5,1000)").run();
    await fixture.db.prepare("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,package_prices_json,is_active) VALUES(1,1,'standar','indosmm',123,'G3',20,2000,'{\"100\":2100}',1)").run();
    const r = await GET(new NextRequest("http://localhost/api/pedia/prices?product_slug=followers-github&quantity=75"));
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data).toMatchObject({ quantity: 75, prices: [{ tier_id: 1, total: 2100 }] });
    expect(JSON.stringify(data)).not.toMatch(/indosmm|private upstream|supplier|markup|rate_idr/);
    expect((await (await GET(new NextRequest("http://localhost/api/pedia/prices?product_slug=followers-github&quantity=2"))).json()).prices).toEqual([]);
  });
  it.each(["quantity=0", "quantity=1.5", "quantity=Infinity", "quantity=100000001"]) ("rejects invalid comparison input %s", async (q) => {
    process.env.PEDIA_ENABLED = "true";
    expect((await GET(new NextRequest(`http://localhost/api/pedia/prices?product_slug=followers-github&${q}`))).status).toBe(400);
  });
  it("rejects malformed product slugs", async () => {
    process.env.PEDIA_ENABLED = "true";
    expect((await GET(new NextRequest("http://localhost/api/pedia/prices?product_slug=invalid%27&quantity=20"))).status).toBe(400);
  });
});
