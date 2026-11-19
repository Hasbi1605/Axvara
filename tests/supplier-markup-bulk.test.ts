import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { ARCHIVED_MESSAGE } from "@/lib/product-archive";
import { createD1Fixture } from "./helpers/d1-fixture";

const authMock = vi.hoisted(() => ({ requireAdmin: vi.fn(async () => true) }));
vi.mock("@/lib/auth", () => ({ requireAdmin: authMock.requireAdmin }));

import { POST as aivaultBulk } from "@/app/api/admin/aivault/markup/bulk/route";
import { POST as tunvnBulk } from "@/app/api/admin/tunvn/markup/bulk/route";
import { POST as storebatBulk } from "@/app/api/admin/storebat/markup/bulk/route";
import { POST as miraiBulk } from "@/app/api/admin/mirai/markup/bulk/route";

let fx: ReturnType<typeof createD1Fixture>;

function post(path: string, body: unknown) {
  return new NextRequest(`https://fixture.test/api/admin/${path}/markup/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.10" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function marketRevision(): string | null {
  const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='catalog_revision_market'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

beforeEach(() => {
  fx = createD1Fixture();
  clearRateLimitBucketsForTest();
  authMock.requireAdmin.mockResolvedValue(true);
});

afterEach(() => {
  fx.close();
  vi.restoreAllMocks();
});

describe("Shared auth, rate limit, and body validation across 4 new /markup/bulk routes", () => {
  it.each([
    { name: "aivault", route: aivaultBulk, id: "svc_1" },
    { name: "tunvn", route: tunvnBulk, id: "86" },
    { name: "storebat", route: storebatBulk, id: "12" },
    { name: "mirai", route: miraiBulk, id: "GPT_10M" },
  ])("$name enforces 401 auth, 400 strict/step validation, 413 body limit, and 429 rate limit", async ({ name, route, id }) => {
    authMock.requireAdmin.mockResolvedValueOnce(false as never);
    const unauth = await route(post(name, { variant_ids: [id], markup_percent: 40 }));
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("Cache-Control")).toBe("private, no-store");

    expect((await route(post(name, { variant_ids: [], markup_percent: 40 }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: [123], markup_percent: 40 }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: Array.from({ length: 201 }, (_, i) => `${id}-${i}`), markup_percent: 40 }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: [id], markup_percent: 35.3 }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: [id], markup_percent: 1000.5 }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: [id], markup_percent: -0.5 }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: [id], markup_percent: 40, extra: true }))).status).toBe(400);
    expect((await route(post(name, { variant_ids: [id], markup_percent: 40, reset_manual: "yes" }))).status).toBe(400);

    const oversized = JSON.stringify({ variant_ids: [id], markup_percent: 40, pad: "x".repeat(17000) });
    expect((await route(post(name, oversized))).status).toBe(413);

    for (let i = 0; i < 20; i++) {
      await route(post(name, { variant_ids: [id], markup_percent: 40 }));
    }
    const limited = await route(post(name, { variant_ids: [id], markup_percent: 40 }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
  });
});

describe("AIVault POST /api/admin/aivault/markup/bulk", () => {
  beforeEach(() => {
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,is_active,aivault_family) VALUES
        (1,'Gemini Plus','gemini-plus-av',15000,10,1,'gemini'),
        (2,'Gemini Inactive','gemini-inact-av',15000,10,0,'chatgpt-plus'),
        (3,'Gemini Archived','gemini-arch-av',15000,10,0,'adobe-express'),
        (4,'WR Foreign','wr-foreign',15000,10,1,NULL);
      UPDATE products SET archived_at=datetime('now') WHERE id=3;
      UPDATE products SET wr_product_id='WP-1' WHERE id=4;
      INSERT INTO product_groups(id,name,winner_product_id) VALUES(1,'Group AV',1);
      INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1);

      INSERT INTO aivault_products(service_id,name,stock,unit_price_usd,pricing_tiers_json,markup_percent,fx_idr_per_usd,axvara_product_id,bulk_markup_tiers_json) VALUES
        ('svc_formula','Formula',10,1.0,'[]',35,16000,1,NULL),
        ('svc_manual','Manual',10,1.0,'[]',35,16000,1,NULL),
        ('svc_wholesale','Wholesale',10,1.0,'[]',60,16000,2,'[{"min_qty":5,"markup_percent":45},{"min_qty":10,"markup_percent":35}]'),
        ('svc_arch','Archived',10,1.0,'[]',35,16000,3,NULL),
        ('svc_nofx','NoFX',10,1.0,'[]',35,NULL,1,NULL),
        ('svc_wr','Foreign',10,1.0,'[]',35,16000,4,NULL);

      INSERT INTO product_variants(id,product_id,sku,label,price,compare_price,stock,fulfillment_mode,is_active,aivault_service_id,aivault_admin_price_idr) VALUES
        (11,1,'AV-svc_formula','Formula',21600,23000,10,'manual',1,'svc_formula',NULL),
        (12,1,'AV-svc_manual','Manual',99000,NULL,10,'manual',0,'svc_manual',99000),
        (13,2,'AV-svc_wholesale','Wholesale',25600,NULL,10,'manual',0,'svc_wholesale',NULL),
        (14,3,'AV-svc_arch','Archived',21600,NULL,10,'manual',0,'svc_arch',NULL),
        (15,1,'AV-svc_nofx','NoFX',30000,NULL,10,'manual',1,'svc_nofx',NULL),
        (16,4,'AV-svc_wr','Foreign',21600,NULL,10,'manual',1,'svc_wr',NULL);
    `);
  });

  it("handles dedup, 0.5% pricing, compare_price clearing, manual preservation, wholesale scaling, partial failures, and revision bump", async () => {
    const rev0 = marketRevision();
    const res = await aivaultBulk(
      post("aivault", {
        variant_ids: [
          "svc_formula",
          "svc_formula", // duplicate -> deduped
          "svc_manual",
          "svc_wholesale", // scales the stored 45% tier below the new base
          "svc_arch",
          "svc_nofx",
          "svc_wr",
          "1", // group/product id, not a service_id
          "bad id!",
        ],
        markup_percent: 40.5,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(3);
    expect(body.failed).toEqual([
      { id: "svc_arch", error: ARCHIVED_MESSAGE },
      { id: "svc_nofx", error: "fx_unavailable" },
      { id: "svc_wr", error: "not_mapped" },
      { id: "1", error: "not_mapped" },
      { id: "bad id!", error: "invalid_id" },
    ]);

    // 1.0 * 16000 * 1.405 = 22480 -> ceil 100 = 22500; compare_price 23000 > 22500 stays, let's verify next with higher markup
    const vFormula = fx.sql.prepare("SELECT price,compare_price,stock,is_active FROM product_variants WHERE id=11").get() as Record<string, unknown>;
    expect(vFormula).toEqual({ price: 22500, compare_price: 23000, stock: 10, is_active: 1 });

    // Manual override 99000 preserved, inactive stays inactive (no activation!) and stock untouched
    const vManual = fx.sql.prepare("SELECT price,aivault_admin_price_idr,stock,is_active FROM product_variants WHERE id=12").get() as Record<string, unknown>;
    expect(vManual).toEqual({ price: 99000, aivault_admin_price_idr: 99000, stock: 10, is_active: 0 });
    expect(fx.sql.prepare("SELECT markup_percent FROM aivault_products WHERE service_id='svc_manual'").get()).toEqual({ markup_percent: 40.5 });

    expect(fx.sql.prepare("SELECT bulk_markup_tiers_json FROM aivault_products WHERE service_id='svc_wholesale'").get()).toEqual({
      bulk_markup_tiers_json: JSON.stringify([{ min_qty: 5, markup_percent: 30.38 }, { min_qty: 10, markup_percent: 23.63 }]),
    });
    expect(fx.sql.prepare("SELECT price,bulk_pricing_enabled,bulk_pricing_tiers FROM product_variants WHERE id=13").get()).toEqual({
      price: 22500,
      bulk_pricing_enabled: 1,
      bulk_pricing_tiers: JSON.stringify([{ min_qty: 5, unit_price: 20900 }, { min_qty: 10, unit_price: 19800 }]),
    });

    // Group winner untouched
    expect(fx.sql.prepare("SELECT winner_product_id FROM product_groups WHERE id=1").get()).toEqual({ winner_product_id: 1 });
    // Parent stock untouched
    expect(fx.sql.prepare("SELECT price,stock FROM products WHERE id=1").get()).toEqual({ price: 22500, stock: 10 });
    expect(marketRevision()).not.toBe(rev0);

    // Now test wholesale tier recomputation + reset_manual + compare_price clearing
    const rev1 = marketRevision();
    const res2 = await aivaultBulk(
      post("aivault", {
        variant_ids: ["svc_formula", "svc_manual", "svc_wholesale"],
        markup_percent: 50,
        reset_manual: true,
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual({ ok: true, updated: 3, failed: [] });
    // 1.0 * 16000 * 1.50 = 24000 -> compare_price 23000 <= 24000 cleared to NULL
    expect(fx.sql.prepare("SELECT price,compare_price FROM product_variants WHERE id=11").get()).toEqual({
      price: 24000,
      compare_price: null,
    });
    expect(fx.sql.prepare("SELECT price,aivault_admin_price_idr,is_active FROM product_variants WHERE id=12").get()).toEqual({
      price: 24000,
      aivault_admin_price_idr: null,
      is_active: 0,
    });
    // Wholesale tiers scale up again from the rounded 40.5% base.
    const vWholesale = fx.sql.prepare("SELECT price,bulk_pricing_enabled,bulk_pricing_tiers,is_active FROM product_variants WHERE id=13").get() as Record<string, unknown>;
    expect(vWholesale.price).toBe(24000);
    expect(vWholesale.bulk_pricing_enabled).toBe(1);
    expect(vWholesale.is_active).toBe(0);
    expect(JSON.parse(String(vWholesale.bulk_pricing_tiers))).toEqual([
      { min_qty: 5, unit_price: 22100 },
      { min_qty: 10, unit_price: 20700 },
    ]);
    expect(marketRevision()).not.toBe(rev1);
  });

  it("handles CAS stale write without partial corruption and does not bump revision when 0 items update", async () => {
    const rev0 = marketRevision();
    const origBatch = fx.db.batch;
    let count = 0;
    fx.db.batch = async (statements) => {
      count++;
      if (count === 1) {
        fx.sql.exec("UPDATE aivault_products SET fx_idr_per_usd=17000 WHERE service_id='svc_formula'");
      }
      return origBatch(statements);
    };

    const res = await aivaultBulk(post("aivault", { variant_ids: ["svc_formula", "svc_manual"], markup_percent: 45 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      updated: 1,
      failed: [{ id: "svc_formula", error: "save_failed_or_stale" }],
    });
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE id=11").get()).toEqual({ price: 21600 });
    expect(fx.sql.prepare("SELECT markup_percent FROM aivault_products WHERE service_id='svc_manual'").get()).toEqual({ markup_percent: 45 });

    // All failed -> no revision bump
    const rev1 = marketRevision();
    const resFail = await aivaultBulk(post("aivault", { variant_ids: ["svc_arch"], markup_percent: 45 }));
    expect(await resFail.json()).toEqual({ ok: true, updated: 0, failed: [{ id: "svc_arch", error: ARCHIVED_MESSAGE }] });
    expect(marketRevision()).toBe(rev1);
    expect(rev1).not.toBe(rev0);
  });

  it("rejects a supplier mapping change between prefetch and the pricing batch", async () => {
    const rev0 = marketRevision();
    const originalBatch = fx.db.batch;
    fx.db.batch = async (statements) => {
      fx.sql.exec("UPDATE aivault_products SET axvara_product_id=2 WHERE service_id='svc_formula'");
      return originalBatch(statements);
    };
    const res = await aivaultBulk(post("aivault", { variant_ids: ["svc_formula"], markup_percent: 45 }));
    expect(await res.json()).toEqual({ ok: true, updated: 0, failed: [{ id: "svc_formula", error: "save_failed_or_stale" }] });
    expect(fx.sql.prepare("SELECT price FROM product_variants WHERE id=11").get()).toEqual({ price: 21600 });
    expect(marketRevision()).toBe(rev0);
  });

  it("handles 150-id batch safely under D1 100-param limit", async () => {
    const ids = ["svc_formula", ...Array.from({ length: 149 }, (_, i) => `missing_${i}`)];
    const res = await aivaultBulk(post("aivault", { variant_ids: ids, markup_percent: 42 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updated).toBe(1);
    expect(body.failed).toHaveLength(149);
  });
});

describe("TUNVN POST /api/admin/tunvn/markup/bulk", () => {
  beforeEach(() => {
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,is_active,tunvn_family) VALUES
        (1,'ChatGPT Private','chatgpt-tunvn',112400,5,1,'chatgpt'),
        (2,'Muse AI 1 Miliar Token','muse-ai-1-miliar-token',1500,-1,1,NULL),
        (3,'Archived TUNVN','arch-tunvn',10000,5,0,'other');
      UPDATE products SET archived_at=datetime('now') WHERE id=3;

      INSERT INTO tunvn_products(supplier_product_id,name,price_usdt,stock,axvara_product_id,markup_percent,fx_idr_per_usdt) VALUES
        (86,'Business',4.6,5,1,35,18086),
        (83,'GPay',4.96,5,1,35,18086),
        (60,'API TEST',1,5,NULL,35,18086),
        (90,'Archived',1,5,3,35,18086),
        (91,'Unmapped',1,5,NULL,35,18086),
        (92,'NoFX',1,5,1,35,NULL);

      INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,tunvn_source_product_id,tunvn_admin_price_idr,tunvn_buff_quantity_b,tunvn_cost_usdt,tunvn_markup_percent,tunvn_fx_idr_per_usdt) VALUES
        (21,1,'TUNVN-86','Business 1B',112400,5,1,86,NULL,NULL,NULL,NULL,NULL),
        (22,1,'TUNVN-83','GPay 1B',150000,5,0,83,150000,NULL,NULL,NULL,NULL),
        (23,3,'TUNVN-90','Arch',15000,5,0,90,NULL,NULL,NULL,NULL,NULL),
        (24,1,'TUNVN-92','NoFX',15000,5,0,92,NULL,NULL,NULL,NULL,NULL),
        (25,2,'TUNVN-BUFF-1B','Buff 1B',1500,-1,1,NULL,NULL,1,0.0588,40,18086);
    `);
  });

  it("updates account and TUNVN-BUFF-1B together, preserves manual overrides, supports reset_manual, and rejects #60/retired Buff/archived/missing FX/stale CAS", async () => {
    const rev0 = marketRevision();
    const res = await tunvnBulk(
      post("tunvn", {
        variant_ids: ["86", "83", "TUNVN-BUFF-1B", "60", "TUNVN-BUFF-5B", "90", "91", "92", "9999"],
        markup_percent: 45.5,
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      updated: 4,
      failed: [
        { id: "60", error: "excluded_product" },
        { id: "TUNVN-BUFF-5B", error: "invalid_id" },
        { id: "90", error: ARCHIVED_MESSAGE },
        { id: "92", error: "fx_unavailable" },
        { id: "9999", error: "not_found" },
      ],
    });
    // 86: ceil100(4.6 * 18086 * 1.455) = ceil100(121050.618) = 121100
    expect(fx.sql.prepare("SELECT price,is_active FROM product_variants WHERE id=21").get()).toEqual({ price: 121100, is_active: 1 });
    // 83: manual 150000 preserved, stays inactive
    expect(fx.sql.prepare("SELECT price,tunvn_admin_price_idr,is_active FROM product_variants WHERE id=22").get()).toEqual({
      price: 150000,
      tunvn_admin_price_idr: 150000,
      is_active: 0,
    });
    // Buff: ceil100(0.0588 * 18086 * 1.455) = ceil100(1547.33...) = 1600
    expect(fx.sql.prepare("SELECT price,tunvn_markup_percent,stock FROM product_variants WHERE id=25").get()).toEqual({
      price: 1600,
      tunvn_markup_percent: 45.5,
      stock: -1,
    });
    expect(marketRevision()).not.toBe(rev0);

    // reset_manual on 83 + unmapped 91 (variant_missing) + CAS stale on 86
    const origBatch = fx.db.batch;
    fx.db.batch = async (statements) => {
      fx.sql.exec("UPDATE tunvn_products SET fx_idr_per_usdt=19000 WHERE supplier_product_id=86");
      fx.db.batch = origBatch;
      return origBatch(statements);
    };
    const res2 = await tunvnBulk(
      post("tunvn", { variant_ids: ["86", "83", "91"], markup_percent: 50, reset_manual: true }),
    );
    expect(await res2.json()).toEqual({
      ok: true,
      updated: 1,
      failed: [
        { id: "86", error: "save_failed_or_stale" },
        { id: "91", error: "variant_missing" },
      ],
    });
    // 83 reset: ceil100(4.96 * 18086 * 1.50) = ceil100(134559.84) = 134600
    expect(fx.sql.prepare("SELECT price,tunvn_admin_price_idr FROM product_variants WHERE id=22").get()).toEqual({
      price: 134600,
      tunvn_admin_price_idr: null,
    });
  });
});

describe("StoreBat POST /api/admin/storebat/markup/bulk", () => {
  beforeEach(() => {
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,is_active,storebat_family) VALUES
        (1,'Claude SB','claude-sb',20000,5,1,'claude-api'),
        (2,'Muse SB','muse-sb',1500,-1,1,'muse-buff'),
        (3,'Arch SB','arch-sb',20000,5,0,'codex-api'),
        (4,'Mirai Foreign','mirai-f',20000,5,1,NULL);
      UPDATE products SET archived_at=datetime('now') WHERE id=3;
      UPDATE products SET mirai_family='gpt' WHERE id=4;

      INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,storebat_product_id,storebat_markup_percent,storebat_cost_usd,storebat_fx_idr_per_usd,storebat_admin_price_idr) VALUES
        (31,1,'SB-31','30 Hari',16200,5,1,31,35,0.6,18000,NULL),
        (32,1,'SB-32','Manual',50000,5,0,32,35,0.6,18000,50000),
        (33,2,'SB-BUFF','Buff 1B',1500,-1,1,124,40,0.0588,18086,NULL),
        (34,3,'SB-34','Arch',16200,5,0,34,35,0.6,18000,NULL),
        (35,4,'SB-35','Foreign',16200,5,1,35,35,0.6,18000,NULL);
    `);
  });

  it("updates SB-31, SB-32 (preserving manual), and SB-BUFF (124); rejects test IDs, wrong supplier, archived, and CAS stale writes", async () => {
    const res = await storebatBulk(
      post("storebat", {
        variant_ids: ["31", "32", "124", "34", "35", "129", "2147483000", "abc"],
        markup_percent: 45,
      }),
    );
    expect(await res.json()).toEqual({
      ok: true,
      updated: 3,
      failed: [
        { id: "34", error: ARCHIVED_MESSAGE },
        { id: "35", error: "not_mapped" },
        { id: "129", error: "invalid_id" },
        { id: "2147483000", error: "invalid_id" },
        { id: "abc", error: "invalid_id" },
      ],
    });
    // 0.6 * 18000 * 1.45 = 15660 -> ceil100 = 15700
    expect(fx.sql.prepare("SELECT price,storebat_markup_percent FROM product_variants WHERE id=31").get()).toEqual({
      price: 15700,
      storebat_markup_percent: 45,
    });
    expect(fx.sql.prepare("SELECT price,storebat_admin_price_idr,is_active FROM product_variants WHERE id=32").get()).toEqual({
      price: 50000,
      storebat_admin_price_idr: 50000,
      is_active: 0,
    });
    // 0.0588 * 18086 * 1.45 = 1542.01 -> ceil100 = 1600
    expect(fx.sql.prepare("SELECT price,storebat_markup_percent FROM product_variants WHERE id=33").get()).toEqual({
      price: 1600,
      storebat_markup_percent: 45,
    });

    // reset_manual + CAS failure
    const origBatch = fx.db.batch;
    fx.db.batch = async (statements) => {
      fx.sql.exec("UPDATE product_variants SET storebat_cost_usd=0.8 WHERE id=31");
      fx.db.batch = origBatch;
      return origBatch(statements);
    };
    const res2 = await storebatBulk(
      post("storebat", { variant_ids: ["31", "32"], markup_percent: 50, reset_manual: true }),
    );
    expect(await res2.json()).toEqual({
      ok: true,
      updated: 1,
      failed: [{ id: "31", error: "save_failed_or_stale" }],
    });
    expect(fx.sql.prepare("SELECT price,storebat_admin_price_idr FROM product_variants WHERE id=32").get()).toEqual({
      price: 16200,
      storebat_admin_price_idr: null,
    });
  });
});

describe("Mirai POST /api/admin/mirai/markup/bulk", () => {
  beforeEach(() => {
    fx.sql.exec(`
      INSERT INTO products(id,name,slug,price,stock,is_active,mirai_family) VALUES
        (1,'Mirai GPT','mirai-gpt',20000,5,1,'gpt'),
        (2,'Mirai Arch','mirai-arch',20000,5,0,'claude'),
        (3,'SB Foreign','sb-f',20000,5,1,NULL);
      UPDATE products SET archived_at=datetime('now') WHERE id=2;
      UPDATE products SET storebat_family='gpt' WHERE id=3;

      INSERT INTO mirai_packages(package_code,group_key,name,quota_tokens,duration_seconds,reseller_price_vnd,cost_usdt,markup_percent,fx_idr_per_usdt) VALUES
        ('GPT_10M','gpt','GPT 10M',10000000,86400,13000,0.5,35,16000),
        ('GPT_20M','gpt','GPT 20M',20000000,86400,26000,1.0,35,16000),
        ('GPT_ARCH','gpt','GPT Arch',10000000,86400,13000,0.5,35,16000);

      INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,mirai_package_code,mirai_markup_percent,mirai_cost_usdt,mirai_fx_idr_per_usdt,mirai_admin_price_idr) VALUES
        (41,1,'MR-GPT_10M','10M',10800,5,1,'GPT_10M',35,0.5,16000,NULL),
        (42,1,'MR-GPT_20M','20M',35000,5,0,'GPT_20M',35,1.0,16000,35000),
        (43,2,'MR-GPT_ARCH','Arch',10800,5,0,'GPT_ARCH',35,0.5,16000,NULL),
        (44,3,'MR-SB_PKG','Foreign',10800,5,1,'SB_PKG',35,0.5,16000,NULL);
    `);
  });

  it("updates package_code rows, syncs mirai_packages, preserves/resets manual override, and rejects archived, wrong supplier, and CAS stale writes", async () => {
    const rev0 = marketRevision();
    const res = await miraiBulk(
      post("mirai", {
        variant_ids: ["GPT_10M", "GPT_20M", "GPT_ARCH", "SB_PKG", "bad code!"],
        markup_percent: 42.5,
      }),
    );
    expect(await res.json()).toEqual({
      ok: true,
      updated: 2,
      failed: [
        { id: "GPT_ARCH", error: ARCHIVED_MESSAGE },
        { id: "SB_PKG", error: "not_mapped" },
        { id: "bad code!", error: "invalid_id" },
      ],
    });
    // 0.5 * 16000 * 1.425 = 11400
    expect(fx.sql.prepare("SELECT price,mirai_markup_percent FROM product_variants WHERE id=41").get()).toEqual({
      price: 11400,
      mirai_markup_percent: 42.5,
    });
    expect(fx.sql.prepare("SELECT markup_percent,sell_price_idr FROM mirai_packages WHERE package_code='GPT_10M'").get()).toEqual({
      markup_percent: 42.5,
      sell_price_idr: 11400,
    });
    expect(fx.sql.prepare("SELECT price,mirai_admin_price_idr,is_active FROM product_variants WHERE id=42").get()).toEqual({
      price: 35000,
      mirai_admin_price_idr: 35000,
      is_active: 0,
    });
    expect(marketRevision()).not.toBe(rev0);

    // reset_manual + CAS stale write
    const origBatch = fx.db.batch;
    fx.db.batch = async (statements) => {
      fx.sql.exec("UPDATE product_variants SET mirai_cost_usdt=0.7 WHERE id=41");
      fx.db.batch = origBatch;
      return origBatch(statements);
    };
    const res2 = await miraiBulk(
      post("mirai", { variant_ids: ["GPT_10M", "GPT_20M"], markup_percent: 50, reset_manual: true }),
    );
    expect(await res2.json()).toEqual({
      ok: true,
      updated: 1,
      failed: [{ id: "GPT_10M", error: "save_failed_or_stale" }],
    });
    // 1.0 * 16000 * 1.50 = 24000
    expect(fx.sql.prepare("SELECT price,mirai_admin_price_idr FROM product_variants WHERE id=42").get()).toEqual({
      price: 24000,
      mirai_admin_price_idr: null,
    });
  });
});
