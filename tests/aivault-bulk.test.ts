import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import {
  deriveAivaultBulkTiers,
  parseAivaultBulkMarkup,
  scaleAivaultBulkMarkup,
  validateAivaultBulkAgainstBase,
} from "@/lib/aivault/bulk";
import { validateBulkPricing } from "@/lib/bulk-pricing";

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })),
}));

describe("src/lib/aivault/bulk.ts", () => {
  it("parses valid JSON strings and arrays with 1..5 strictly ordered tiers", () => {
    const valid = [
      { min_qty: 5, markup_percent: 58 },
      { min_qty: 10, markup_percent: 47 },
      { min_qty: 50, markup_percent: 36 },
    ];
    expect(parseAivaultBulkMarkup(valid)).toEqual(valid);
    expect(parseAivaultBulkMarkup(JSON.stringify(valid))).toEqual(valid);
    expect(parseAivaultBulkMarkup([{ min_qty: 2, markup_percent: 1000 }, { min_qty: 100, markup_percent: 0 }])).toEqual([
      { min_qty: 2, markup_percent: 1000 },
      { min_qty: 100, markup_percent: 0 },
    ]);
    expect(parseAivaultBulkMarkup([
      { min_qty: 2, markup_percent: 50 },
      { min_qty: 3, markup_percent: 40 },
      { min_qty: 4, markup_percent: 30 },
      { min_qty: 5, markup_percent: 20 },
      { min_qty: 6, markup_percent: 10.5 },
    ])).toHaveLength(5);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["bad json", "{bad"],
    ["non-array json", '{"min_qty":5,"markup_percent":58}'],
    ["empty array", []],
    ["6 items", Array.from({ length: 6 }, (_, i) => ({ min_qty: i + 2, markup_percent: 50 - i }))],
    ["min_qty < 2", [{ min_qty: 1, markup_percent: 50 }]],
    ["min_qty > 100", [{ min_qty: 101, markup_percent: 50 }]],
    ["float min_qty", [{ min_qty: 2.5, markup_percent: 50 }]],
    ["duplicate min_qty", [{ min_qty: 5, markup_percent: 50 }, { min_qty: 5, markup_percent: 40 }]],
    ["decreasing min_qty", [{ min_qty: 10, markup_percent: 50 }, { min_qty: 5, markup_percent: 40 }]],
    ["negative markup", [{ min_qty: 5, markup_percent: -0.1 }]],
    ["markup > 1000", [{ min_qty: 5, markup_percent: 1000.1 }]],
    ["NaN markup", [{ min_qty: 5, markup_percent: Number.NaN }]],
    ["equal markup", [{ min_qty: 5, markup_percent: 40 }, { min_qty: 10, markup_percent: 40 }]],
    ["increasing markup", [{ min_qty: 5, markup_percent: 40 }, { min_qty: 10, markup_percent: 50 }]],
    ["extra key", [{ min_qty: 5, markup_percent: 40, extra: 1 }]],
    ["missing key", [{ min_qty: 5 }]],
    ["wrong types", [{ min_qty: "5", markup_percent: "40" }]],
  ])("rejects invalid input: %s", (_label, input) => {
    expect(parseAivaultBulkMarkup(input)).toBeNull();
  });

  it("derives Gemini production reference prices (0.5 USD, FX 18272.9, base 80% -> 16500)", () => {
    const tiers = [
      { min_qty: 5, markup_percent: 58 },
      { min_qty: 10, markup_percent: 47 },
      { min_qty: 50, markup_percent: 36 },
    ];
    const derived = deriveAivaultBulkTiers(0.5, 18272.9, 16500, tiers);
    expect(derived).toEqual([
      { min_qty: 5, unit_price: 14500 },
      { min_qty: 10, unit_price: 13500 },
      { min_qty: 50, unit_price: 12500 },
    ]);
    expect(validateBulkPricing({ enabled: true, tiers: derived }, 16500)).toEqual({ enabled: true, tiers: derived });
  });

  it("raises derived bulk prices when supplier cost USD or FX increases", () => {
    const tiers = [
      { min_qty: 5, markup_percent: 58 },
      { min_qty: 10, markup_percent: 47 },
    ];
    const before = deriveAivaultBulkTiers(0.5, 18272.9, 16500, tiers);
    const higherCost = deriveAivaultBulkTiers(0.6, 18272.9, 19800, tiers);
    const higherFx = deriveAivaultBulkTiers(0.5, 20000, 18000, tiers);
    expect(higherCost[0].unit_price).toBeGreaterThan(before[0].unit_price);
    expect(higherCost[1].unit_price).toBeGreaterThan(before[1].unit_price);
    expect(higherFx[0].unit_price).toBeGreaterThan(before[0].unit_price);
    expect(higherFx[1].unit_price).toBeGreaterThan(before[1].unit_price);
  });

  it("drops tiers >= basePrice, clamps non-increasing, and returns [] when none qualify", () => {
    const tiers = [
      { min_qty: 5, markup_percent: 58 },  // 14500
      { min_qty: 10, markup_percent: 47 }, // 13500
      { min_qty: 50, markup_percent: 36 }, // 12500
    ];
    // Manual override 14000 drops 5+ (14500 >= 14000), keeps 10+ and 50+
    expect(deriveAivaultBulkTiers(0.5, 18272.9, 14000, tiers)).toEqual([
      { min_qty: 10, unit_price: 13500 },
      { min_qty: 50, unit_price: 12500 },
    ]);
    // Manual override 12500 drops all
    expect(deriveAivaultBulkTiers(0.5, 18272.9, 12500, tiers)).toEqual([]);
    // Non-monotonic direct input gets clamped to non-increasing
    const clamped = deriveAivaultBulkTiers(0.5, 20000, 18000, [
      { min_qty: 5, markup_percent: 40 },  // 14000
      { min_qty: 10, markup_percent: 50 }, // 15000 -> clamped to 14000
    ]);
    expect(clamped).toEqual([
      { min_qty: 5, unit_price: 14000 },
      { min_qty: 10, unit_price: 14000 },
    ]);
    expect(validateBulkPricing({ enabled: true, tiers: clamped }, 18000)).not.toBeNull();
    // Invalid cost / fx / base
    expect(deriveAivaultBulkTiers(0, 20000, 18000, tiers)).toEqual([]);
    expect(deriveAivaultBulkTiers(0.5, 0, 18000, tiers)).toEqual([]);
    expect(deriveAivaultBulkTiers(0.5, 20000, 0, tiers)).toEqual([]);
  });

  it("validates tier markup strictly below baseMarkup only when manualPrice is null", () => {
    const tiers = [
      { min_qty: 5, markup_percent: 58 },
      { min_qty: 10, markup_percent: 47 },
    ];
    expect(validateAivaultBulkAgainstBase(tiers, 80, null)).toBe("ok");
    expect(validateAivaultBulkAgainstBase(tiers, 58, null)).toBe("bulk_markup_not_below_base");
    expect(validateAivaultBulkAgainstBase(tiers, 50, null)).toBe("bulk_markup_not_below_base");
    expect(validateAivaultBulkAgainstBase(tiers, 50, 14000)).toBe("ok");
  });

  it("separates rounding collisions by 0.01, keeps tiers below base, and drops those that cannot fit", () => {
    const tiers = [99.99, 99.98, 99.97].map((markup_percent, index) => ({ min_qty: index + 2, markup_percent }));
    expect(scaleAivaultBulkMarkup(tiers, 100, 0.07).map(t => t.markup_percent)).toEqual([0.06, 0.05, 0.04]);
    expect(scaleAivaultBulkMarkup(tiers, 100, 0.02).map(t => t.markup_percent)).toEqual([0.01, 0]);
    expect(scaleAivaultBulkMarkup(tiers, 100, 0)).toEqual([]);
  });

  it("keeps units at or above the rounded modal floor under a manual base", () => {
    const tiers = [{ min_qty: 5, markup_percent: 1 }, { min_qty: 10, markup_percent: 0 }];
    const fx = 18272.9; // Modal 9136.45, rounded up to 9200.
    expect(deriveAivaultBulkTiers(0.5, fx, 9100, tiers)).toEqual([]);
    expect(deriveAivaultBulkTiers(0.5, fx, 9200, tiers)).toEqual([]);
    expect(deriveAivaultBulkTiers(0.5, fx, 9201, tiers)).toEqual([{ min_qty: 10, unit_price: 9200 }]);
  });
});

describe("AIVault admin GET/PATCH bulk markup routes", () => {
  let fx: ReturnType<typeof createD1Fixture>;
  const sid = "service_gemini_plus_6m";
  const tiers = [
    { min_qty: 5, markup_percent: 58 },
    { min_qty: 10, markup_percent: 47 },
    { min_qty: 50, markup_percent: 36 },
  ];
  const stored = () => fx.sql.prepare("SELECT markup_percent, bulk_markup_tiers_json FROM aivault_products WHERE service_id=?").get(sid);

  const patch = async (body: unknown, id = sid) => {
    const { PATCH } = await import("@/app/api/admin/aivault/products/[id]/route");
    return PATCH(
      new NextRequest(`https://fixture.test/api/admin/aivault/products/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  };

  const getList = async () => {
    const { GET } = await import("@/app/api/admin/aivault/products/route");
    return GET(new NextRequest("https://fixture.test/api/admin/aivault/products"));
  };

  beforeEach(() => {
    fx = createD1Fixture();
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,is_active,aivault_family)
      VALUES(1,'Google AI / Gemini Plus','gemini-plus-av',16500,10,1,'gemini');
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,is_active,aivault_service_id)
      VALUES(1,1,'AV-${sid}','Gemini Plus 6 Bulan',16500,10,'manual',1,'${sid}');
      INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,markup_percent,axvara_product_id,sell_price_idr,fx_idr_per_usd)
      VALUES('${sid}','Gemini Plus',10,0.5,'[]',80,1,16500,18272.9);
    `);
  });

  afterEach(() => {
    fx.close();
    vi.clearAllMocks();
  });

  it("PATCH saves valid bulk_markup_tiers, derives variant bulk + max_qty=100, and exposes GET preview", async () => {
    const res = await patch({ bulk_markup_tiers: tiers });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(fx.sql.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id=?").get(sid)).toEqual({
      bulk_markup_tiers_json: JSON.stringify(tiers),
    });
    expect(
      fx.sql.prepare("SELECT price, bulk_pricing_enabled, bulk_pricing_tiers, max_qty FROM product_variants WHERE id=1").get(),
    ).toEqual({
      price: 16500,
      bulk_pricing_enabled: 1,
      bulk_pricing_tiers: JSON.stringify([
        { min_qty: 5, unit_price: 14500 },
        { min_qty: 10, unit_price: 13500 },
        { min_qty: 50, unit_price: 12500 },
      ]),
      max_qty: 100,
    });

    const listRes = await getList();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: {
        service_id: string;
        bulk_markup_tiers: unknown;
        bulk_tiers_preview: unknown;
        unit_price_usd: number;
        fx_idr_per_usd: number;
        markup_percent: number;
        aivault_admin_price_idr: number | null;
      }[];
    };
    expect(listBody.items[0]).toMatchObject({
      service_id: sid,
      unit_price_usd: 0.5,
      fx_idr_per_usd: 18272.9,
      markup_percent: 80,
      aivault_admin_price_idr: null,
      bulk_markup_tiers: tiers,
      bulk_tiers_preview: [
        { min_qty: 5, unit_price: 14500 },
        { min_qty: 10, unit_price: 13500 },
        { min_qty: 50, unit_price: 12500 },
      ],
    });
  });

  it("PATCH rejects invalid_bulk_markup (400) and bulk_markup_not_below_base (400) without writing", async () => {
    const bad1 = await patch({ bulk_markup_tiers: [{ min_qty: 1, markup_percent: 50 }] });
    expect(bad1.status).toBe(400);
    expect(await bad1.json()).toEqual({ error: "invalid_bulk_markup" });

    const bad2 = await patch({ bulk_markup_tiers: "not-an-array" });
    expect(bad2.status).toBe(400);
    expect(await bad2.json()).toEqual({ error: "invalid_bulk_markup" });

    const bad3 = await patch({ markup_percent: 35, bulk_markup_tiers: tiers });
    expect(bad3.status).toBe(400);
    expect(await bad3.json()).toEqual({ error: "bulk_markup_not_below_base" });

    expect(fx.sql.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id=?").get(sid)).toEqual({
      bulk_markup_tiers_json: null,
    });
    expect(fx.sql.prepare("SELECT bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get()).toEqual({
      bulk_pricing_enabled: 0,
      bulk_pricing_tiers: "[]",
    });
  });

  it("PATCH scales tiers and re-derives prices 80→35, then approximately restores tiers on 35→80", async () => {
    expect((await patch({ bulk_markup_tiers: tiers })).status).toBe(200);
    expect((await patch({ markup_percent: 35 })).status).toBe(200);
    expect(stored()).toEqual({
      markup_percent: 35,
      bulk_markup_tiers_json: JSON.stringify(tiers.map((tier, i) => ({ ...tier, markup_percent: [25.38, 20.56, 15.75][i] }))),
    });
    expect(fx.sql.prepare("SELECT price, bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get()).toEqual({
      price: 12400,
      bulk_pricing_enabled: 1,
      bulk_pricing_tiers: JSON.stringify([
        { min_qty: 5, unit_price: 11500 },
        { min_qty: 10, unit_price: 11100 },
        { min_qty: 50, unit_price: 10600 },
      ]),
    });
    expect((await patch({ markup_percent: 80 })).status).toBe(200);
    expect(stored()).toEqual({
      markup_percent: 80,
      bulk_markup_tiers_json: JSON.stringify(tiers.map((tier, i) => ({ ...tier, markup_percent: [58.01, 46.99, 36][i] }))),
    });
  });

  it("PATCH does not scale with explicit tier input and keeps the exact submitted markups", async () => {
    const submitted = [{ min_qty: 15, markup_percent: 29.123 }];
    expect((await patch({ bulk_markup_tiers: tiers })).status).toBe(200);
    expect((await patch({ markup_percent: 35, bulk_markup_tiers: submitted })).status).toBe(200);
    expect(stored()).toEqual({ markup_percent: 35, bulk_markup_tiers_json: JSON.stringify(submitted) });
  });

  it("PATCH handles absent tiers and old base zero without scaling", async () => {
    expect((await patch({ markup_percent: 0 })).status).toBe(200);
    expect(stored()).toEqual({ markup_percent: 0, bulk_markup_tiers_json: null });
    expect((await patch({ markup_percent: 35 })).status).toBe(200);
    expect(stored()).toEqual({ markup_percent: 35, bulk_markup_tiers_json: null });

    // An old zero base with stored tiers is invalid under formula pricing; retain normal validation.
    fx.sql.prepare("UPDATE aivault_products SET markup_percent=0, bulk_markup_tiers_json=? WHERE service_id=?").run(JSON.stringify(tiers), sid);
    const bad = await patch({ markup_percent: 35 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bulk_markup_not_below_base" });
    expect((await patch({ markup_percent: 80 })).status).toBe(200);
    expect(stored()).toEqual({ markup_percent: 80, bulk_markup_tiers_json: JSON.stringify(tiers) });
  });

  it("PATCH at new formula base zero clears tiers that cannot be below zero", async () => {
    expect((await patch({ bulk_markup_tiers: tiers })).status).toBe(200);
    expect((await patch({ markup_percent: 0 })).status).toBe(200);
    expect(stored()).toEqual({ markup_percent: 0, bulk_markup_tiers_json: null });
    expect(fx.sql.prepare("SELECT price, bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get()).toEqual({
      price: 9200,
      bulk_pricing_enabled: 0,
      bulk_pricing_tiers: "[]",
    });
  });

  it("PATCH preserves stored markups under manual pricing, re-derives safely, and allows explicit disable", async () => {
    expect((await patch({ bulk_markup_tiers: tiers })).status).toBe(200);
    expect((await patch({ admin_price_idr: 14000 })).status).toBe(200);
    expect((await patch({ markup_percent: 35 })).status).toBe(200);
    expect(stored()).toEqual({ markup_percent: 35, bulk_markup_tiers_json: JSON.stringify(tiers) });
    expect(fx.sql.prepare("SELECT price, bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get()).toEqual({
      price: 14000,
      bulk_pricing_enabled: 1,
      bulk_pricing_tiers: JSON.stringify([
        { min_qty: 10, unit_price: 13500 },
        { min_qty: 50, unit_price: 12500 },
      ]),
    });

    // The manual base is below modal; no tier may be enabled even at 0% markup.
    expect((await patch({ admin_price_idr: 9100, bulk_markup_tiers: [{ min_qty: 5, markup_percent: 0 }] })).status).toBe(200);
    expect(fx.sql.prepare("SELECT price, bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get()).toEqual({
      price: 9100,
      bulk_pricing_enabled: 0,
      bulk_pricing_tiers: "[]",
    });

    // Null disables and clears stored bulk_markup_tiers_json
    expect((await patch({ bulk_markup_tiers: null, admin_price_idr: null })).status).toBe(200);
    expect(fx.sql.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id=?").get(sid)).toEqual({
      bulk_markup_tiers_json: null,
    });
    expect(fx.sql.prepare("SELECT bulk_pricing_enabled, bulk_pricing_tiers FROM product_variants WHERE id=1").get()).toEqual({
      bulk_pricing_enabled: 0,
      bulk_pricing_tiers: "[]",
    });

    const afterDisable = await (await getList()).json() as { items: { bulk_markup_tiers: unknown; bulk_tiers_preview: unknown }[] };
    expect(afterDisable.items[0]).toMatchObject({ bulk_markup_tiers: null, bulk_tiers_preview: [] });
  });

  it("PATCH CAS blocks stale bulk_markup_tiers_json", async () => {
    const tiers = [{ min_qty: 5, markup_percent: 58 }];
    const origBatch = fx.db.batch.bind(fx.db);
    let raced = false;
    fx.db.batch = async (statements) => {
      if (!raced) {
        raced = true;
        fx.sql.exec(`UPDATE aivault_products SET bulk_markup_tiers_json='[{"min_qty":4,"markup_percent":60}]' WHERE service_id='${sid}'`);
      }
      return origBatch(statements);
    };
    const res = await patch({ bulk_markup_tiers: tiers });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "save_failed_or_stale" });
    expect(fx.sql.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id=?").get(sid)).toEqual({
      bulk_markup_tiers_json: '[{"min_qty":4,"markup_percent":60}]',
    });
  });

  it("migration 0131 adds bulk_markup_tiers_json and seeds only service_gemini_plus_6m", () => {
    const migration = readFileSync("drizzle/migrations/0131_aivault_bulk_markup.sql", "utf8");
    expect(migration).toContain("ALTER TABLE aivault_products ADD COLUMN bulk_markup_tiers_json TEXT");
    expect(migration).toContain("WHERE service_id='service_gemini_plus_6m'");
  });
});
