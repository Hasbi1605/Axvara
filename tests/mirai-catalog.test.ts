import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { projectMiraiCatalog, publishMiraiCatalog } from "@/lib/mirai/catalog";
import { MIRAI_COPY } from "@/lib/mirai/copy";
import { miraiDefaultDescription } from "@/lib/mirai/families";
import { createD1Fixture } from "./helpers/d1-fixture";

let f: ReturnType<typeof createD1Fixture>;

const pkg = (overrides: Record<string, unknown> = {}) => ({
  code: "GPT_10M",
  group: "gpt",
  name: "GPT 10M tokens · 1D",
  quota_tokens: 10_000_000,
  duration_seconds: 86400,
  reseller_price_vnd: 6650,
  retail_price_vnd: 7000,
  discount_bps: 500,
  min_quantity: 1,
  max_quantity: 10000,
  preset_quantities: [1, 2, 3, 5, 10],
  models: ["gpt-5.6-luna"],
  unlimited: true,
  remaining_today: 0,
  custom_quantity: true,
  ...overrides,
});

beforeEach(() => {
  f = createD1Fixture();
  vi.stubEnv("MIRAI_ENABLED", "true");
  vi.stubEnv("MIRAI_SYNC_ENABLED", "true");
  vi.stubEnv("MIRAI_API_KEY", "mr-fixture");
  vi.stubEnv("MIRAI_BASE_URL", "https://mirai.test/api/reseller/v1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ success: true, data: [pkg()] })),
  );
});

afterEach(() => {
  f.close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("creates inactive products/variants, copies image once, and never overwrites admin copy/state", async () => {
  f.sql.exec(
    "INSERT INTO products(name,slug,price,image_url,is_active) VALUES('Ref GPT','chatgpt-plus-1-bulan',10000,'/r2/gpt.webp',0)",
  );
  const budget = createBudgetedDatabase(40, 2, f.db);
  expect(await publishMiraiCatalog(budget.access, 16000, { force: true })).toMatchObject({ ok: true });
  expect(budget.used).toBeLessThanOrEqual(38);

  expect(
    f.sql
      .prepare("SELECT name,slug,image_url,is_active,source,fulfillment_mode,telegram_enabled,category_id FROM products WHERE mirai_family='gpt'")
      .get(),
  ).toEqual({
    name: "API GPT Token",
    slug: "api-gpt-token-mr",
    image_url: "/r2/gpt.webp",
    is_active: 0,
    source: "manual",
    fulfillment_mode: "manual",
    telegram_enabled: 1,
    category_id: 1,
  });

  // Unlimited stock is represented as -1; price = ceil100(0.255769 * 16000 * 1.35) = 5600
  expect(
    f.sql
      .prepare("SELECT sku,label,is_active,price,stock,max_qty,mirai_cost_usdt,mirai_fx_idr_per_usdt FROM product_variants WHERE mirai_package_code='GPT_10M'")
      .get(),
  ).toEqual({
    sku: "MR-GPT_10M",
    label: "10M Token · 1 Hari",
    is_active: 0,
    price: 5600,
    stock: -1,
    max_qty: 100,
    mirai_cost_usdt: 0.255769,
    mirai_fx_idr_per_usdt: 16000,
  });

  // Admin edits copy, image, activation, and manual price override
  f.sql.exec(
    "UPDATE products SET name='Admin GPT',description='Admin copy',category_id=6,image_url='/r2/admin.webp',is_active=1 WHERE mirai_family='gpt'; UPDATE product_variants SET label='Admin 10M',is_active=1,mirai_admin_price_idr=7700 WHERE mirai_package_code='GPT_10M'",
  );

  await publishMiraiCatalog(createDatabaseAccess(f.db), 18000, { force: true });
  expect(
    f.sql
      .prepare("SELECT name,description,category_id,image_url,is_active,price,stock FROM products WHERE mirai_family='gpt'")
      .get(),
  ).toEqual({
    name: "Admin GPT",
    description: "Admin copy",
    category_id: 6,
    image_url: "/r2/admin.webp",
    is_active: 1,
    price: 7700,
    stock: -1,
  });
  expect(
    f.sql
      .prepare("SELECT label,is_active,price,mirai_fx_idr_per_usdt FROM product_variants WHERE mirai_package_code='GPT_10M'")
      .get(),
  ).toEqual({
    label: "Admin 10M",
    is_active: 1,
    price: 7700,
    mirai_fx_idr_per_usdt: 18000,
  });
});

it("never reactivates deactivated products/variants and supports idempotent resync", async () => {
  const db = createDatabaseAccess(f.db);
  await publishMiraiCatalog(db, 16000, { force: true });
  f.sql.exec("UPDATE products SET is_active=1 WHERE mirai_family='gpt'; UPDATE product_variants SET is_active=0 WHERE mirai_package_code='GPT_10M'");

  // Re-sync with identical data does not activate the variant
  await publishMiraiCatalog(db, 16000, { force: true });
  expect(f.sql.prepare("SELECT is_active FROM product_variants WHERE mirai_package_code='GPT_10M'").get()).toEqual({ is_active: 0 });
  expect(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE mirai_family='gpt'").get()).toEqual({ n: 1 });
  expect(f.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE mirai_package_code='GPT_10M'").get()).toEqual({ n: 1 });
});

it("respects archived parents: no writes and no duplicate parent created", async () => {
  const db = createDatabaseAccess(f.db);
  await publishMiraiCatalog(db, 16000, { force: true });
  f.sql.exec(
    "UPDATE products SET is_active=0, archived_at=datetime('now') WHERE mirai_family='gpt'; UPDATE product_variants SET price=5000, stock=2 WHERE mirai_package_code='GPT_10M'",
  );

  // Add second package in same archived family
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      success: true,
      data: [
        pkg(),
        pkg({ code: "GPT_50M", name: "GPT 50M tokens · 2D", quota_tokens: 50_000_000, duration_seconds: 172800, reseller_price_vnd: 33250 }),
      ],
    }),
  );

  await publishMiraiCatalog(db, 18000, { force: true });
  // No duplicate parent created
  expect(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE mirai_family='gpt'").get()).toEqual({ n: 1 });
  // Existing variant on archived parent untouched
  expect(f.sql.prepare("SELECT price, stock FROM product_variants WHERE mirai_package_code='GPT_10M'").get()).toEqual({
    price: 5000,
    stock: 2,
  });
  // No new variant inserted onto archived parent
  expect(f.sql.prepare("SELECT product_variants.id FROM product_variants WHERE mirai_package_code='GPT_50M'").get()).toBeUndefined();
});

it("sets disappeared packages to stock 0 without deleting variants and uses remaining_today when unlimited=false", async () => {
  const db = createDatabaseAccess(f.db);
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      success: true,
      data: [
        pkg(),
        pkg({ code: "GPT_LIMITED", name: "GPT Limited", quota_tokens: 20_000_000, unlimited: false, remaining_today: 7 }),
      ],
    }),
  );
  await publishMiraiCatalog(db, 16000, { force: true });
  expect(f.sql.prepare("SELECT stock FROM product_variants WHERE mirai_package_code='GPT_LIMITED'").get()).toEqual({ stock: 7 });

  // Now GPT_LIMITED disappears from upstream
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, data: [pkg()] }));
  await publishMiraiCatalog(db, 16000, { force: true });

  expect(f.sql.prepare("SELECT is_active, unlimited, remaining_today FROM mirai_packages WHERE package_code='GPT_LIMITED'").get()).toEqual({
    is_active: 0,
    unlimited: 0,
    remaining_today: 0,
  });
  expect(f.sql.prepare("SELECT stock, is_active FROM product_variants WHERE mirai_package_code='GPT_LIMITED'").get()).toEqual({
    stock: 0,
    is_active: 0,
  });
});

it("uses a constant statement count regardless of package/family count", async () => {
  const used: number[] = [];
  for (const n of [1, 25]) {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        success: true,
        data: Array.from({ length: n }, (_, i) =>
          pkg({
            code: `PKG_${n}_${i}`,
            group: i % 2 === 0 ? "gpt" : `custom_${i}`,
            name: `Pkg ${n} ${i}`,
          }),
        ),
      }),
    );
    const b = createBudgetedDatabase(40, 2, f.db);
    expect(await publishMiraiCatalog(b.access, 16000, { force: true })).toMatchObject({ ok: true });
    used.push(b.used);
  }
  expect(used[1]).toBe(used[0]);
});

it.each(["manual", "variant_markup", "mirror_markup"])("CAS protects concurrent %s price edits", async (field) => {
  const db = createDatabaseAccess(f.db);
  await publishMiraiCatalog(db, 16000, { force: true });
  let raced = false;
  f.control.beforeRun = async (query) => {
    if (!raced && query.includes("UPDATE product_variants")) {
      raced = true;
      if (field === "manual") {
        f.sql.exec("UPDATE product_variants SET mirai_admin_price_idr=9900, price=9900 WHERE mirai_package_code='GPT_10M'");
      } else if (field === "variant_markup") {
        f.sql.exec("UPDATE product_variants SET mirai_markup_percent=50, price=6200 WHERE mirai_package_code='GPT_10M'");
      } else {
        f.sql.exec("UPDATE mirai_packages SET markup_percent=60; UPDATE product_variants SET price=6600 WHERE mirai_package_code='GPT_10M'");
      }
    }
  };
  await projectMiraiCatalog(db, 20000);
  const expected = field === "manual" ? 9900 : field === "variant_markup" ? 6200 : 6600;
  expect(f.sql.prepare("SELECT price FROM product_variants WHERE mirai_package_code='GPT_10M'").get()?.price).toBe(expected);
});

it("fails closed without FX, honors 45s throttle/lease, and records success/error markers", async () => {
  const db = createDatabaseAccess(f.db);
  const now = Date.now();
  expect(await publishMiraiCatalog(db, 0, { force: true, now })).toEqual({ ok: false, error: "fx_unavailable" });
  expect(fetch).not.toHaveBeenCalled();

  await publishMiraiCatalog(db, 16000, { now });
  vi.mocked(fetch).mockClear();
  expect(await publishMiraiCatalog(db, 16000, { now: now + 44_999 })).toEqual({ skipped: "throttled" });
  expect(fetch).not.toHaveBeenCalled();

  // Active 45s lease blocks concurrent runs
  f.sql
    .prepare("INSERT INTO store_settings(key,value) VALUES('mirai_catalog_lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ owner: "other", until: now + 44_000 }));
  expect(await publishMiraiCatalog(db, 16000, { now: now + 43_999, force: true })).toEqual({ skipped: "claimed_elsewhere" });

  // Expired lease succeeds at 45s
  expect(await publishMiraiCatalog(db, 16000, { now: now + 45_000 })).toMatchObject({ ok: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='mirai_catalog_success_at'").get()).toEqual({
    value: String(now + 45_000),
  });

  // Malformed/empty catalog records error without clearing success timestamp or zeroing stock
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, data: [] }));
  expect(await publishMiraiCatalog(db, 16000, { now: now + 90_000 })).toMatchObject({ ok: false });
  expect(f.sql.prepare("SELECT unlimited FROM mirai_packages WHERE package_code='GPT_10M'").get()).toEqual({ unlimited: 1 });
  const errRow = f.sql.prepare("SELECT value FROM store_settings WHERE key='mirai_catalog_last_error'").get() as { value: string };
  expect(JSON.parse(errRow.value).error).toBe("invalid_or_empty_catalog");

  // Subsequent success clears mirai_catalog_last_error
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, data: [pkg()] }));
  expect(await publishMiraiCatalog(db, 16000, { now: now + 135_000 })).toMatchObject({ ok: true });
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='mirai_catalog_last_error'").get()).toEqual({ value: "" });
});

it("does not appropriate an unrelated slug owned by another product", async () => {
  f.sql.exec("INSERT INTO products(name,slug,price) VALUES('Owner Manual','api-gpt-token-mr',5000)");
  const db = createDatabaseAccess(f.db);
  await publishMiraiCatalog(db, 16000, { force: true });
  expect(f.sql.prepare("SELECT COUNT(*) n FROM product_variants WHERE mirai_package_code IS NOT NULL").get()).toEqual({ n: 0 });
});

it("writes curated copy, category, and candidate/R2 image once on insert, preserves admin edits, and inserts new sibling variant copy", async () => {
  f.sql.exec(
    "INSERT INTO products(name,slug,price,image_url,is_active) VALUES('Ref GPT','chatgpt-plus-1-bulan',10000,'/r2/gpt.webp',0),('Ref Claude','claude-pro',10000,'/r2/claude.webp',0)",
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      success: true,
      data: [
        pkg({ code: "GPT_10M", group: "gpt" }),
        pkg({ code: "CLAUDE_10M", group: "claude", name: "Claude 10M" }),
        pkg({ code: "FULL_10M", group: "full", name: "Full 10M" }),
        pkg({ code: "TAU_50M", group: "tau", name: "Tau 50M", quota_tokens: 50_000_000, duration_seconds: 172800 }),
        pkg({ code: "NEW_10M", group: "unknown_group", name: "Uncurated 10M" }),
      ],
    }),
  );

  const db = createDatabaseAccess(f.db);
  expect(await publishMiraiCatalog(db, 16000, { force: true })).toMatchObject({ ok: true, mirrored: 5 });

  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE mirai_family='gpt'").get()).toEqual({
    category_id: 1,
    description: MIRAI_COPY.gpt.description,
    description_en: MIRAI_COPY.gpt.description_en,
    image_url: "/r2/gpt.webp",
  });
  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE mirai_family='claude'").get()).toEqual({
    category_id: 1,
    description: MIRAI_COPY.claude.description,
    description_en: MIRAI_COPY.claude.description_en,
    image_url: "/r2/claude.webp",
  });
  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE mirai_family='full'").get()).toEqual({
    category_id: 1,
    description: MIRAI_COPY.full.description,
    description_en: MIRAI_COPY.full.description_en,
    image_url: "/r2/products/d09170bb829405d48d95ed9c7b9ea613.webp",
  });
  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE mirai_family='tau'").get()).toEqual({
    category_id: 1,
    description: MIRAI_COPY.tau.description,
    description_en: MIRAI_COPY.tau.description_en,
    image_url: "/r2/products/293b85da8d371b02c13c4ad854df2220.webp",
  });

  for (const [group, sku] of [
    ["gpt", "MR-GPT_10M"],
    ["claude", "MR-CLAUDE_10M"],
    ["full", "MR-FULL_10M"],
    ["tau", "MR-TAU_50M"],
  ] as const) {
    expect(
      f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku=?").get(sku),
    ).toEqual(MIRAI_COPY[group].variants[sku]);
  }

  expect(f.sql.prepare("SELECT description,description_en,image_url FROM products WHERE mirai_family='package:NEW_10M'").get()).toEqual({
    description: miraiDefaultDescription("Uncurated 10M"),
    description_en: null,
    image_url: null,
  });
  expect(
    f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='MR-NEW_10M'").get(),
  ).toEqual({ admin_terms: null, admin_terms_en: null, admin_activation: null, admin_activation_en: null });

  // Admin edits parent + variant copy, then resync adds GPT_50M
  f.sql.exec(
    "UPDATE products SET description='Admin MR Desc',description_en='Admin MR Desc EN',category_id=6,image_url='/r2/admin-mr.webp' WHERE mirai_family='gpt'",
  );
  f.sql.exec(
    "UPDATE product_variants SET admin_terms='Admin MR Terms',admin_terms_en='Admin MR Terms EN',admin_activation='Admin MR Act',admin_activation_en='Admin MR Act EN' WHERE sku='MR-GPT_10M'",
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      success: true,
      data: [
        pkg({ code: "GPT_10M", group: "gpt" }),
        pkg({ code: "GPT_50M", group: "gpt", name: "GPT 50M", quota_tokens: 50_000_000, duration_seconds: 172800 }),
      ],
    }),
  );
  await publishMiraiCatalog(db, 17000, { force: true });

  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE mirai_family='gpt'").get()).toEqual({
    category_id: 6,
    description: "Admin MR Desc",
    description_en: "Admin MR Desc EN",
    image_url: "/r2/admin-mr.webp",
  });
  expect(
    f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='MR-GPT_10M'").get(),
  ).toEqual({
    admin_terms: "Admin MR Terms",
    admin_terms_en: "Admin MR Terms EN",
    admin_activation: "Admin MR Act",
    admin_activation_en: "Admin MR Act EN",
  });
  expect(
    f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='MR-GPT_50M'").get(),
  ).toEqual(MIRAI_COPY.gpt.variants["MR-GPT_50M"]);
});
