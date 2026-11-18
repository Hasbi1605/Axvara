import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireAdmin: vi.fn(async () => ({ email: "admin@axvara.tech", role: "admin" })),
  };
});

let fixture: ReturnType<typeof createD1Fixture>;

function memoryCache() {
  const entries = new Map<string, { response: Response; expiresAt: number }>();
  return {
    entries,
    match: vi.fn(async (request: Request) => {
      const entry = entries.get(request.url);
      return entry && entry.expiresAt > Date.now() ? entry.response.clone() : undefined;
    }),
    put: vi.fn(async (request: Request, response: Response) => {
      const ttl = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 60);
      entries.set(request.url, { response: response.clone(), expiresAt: Date.now() + ttl * 1000 });
    }),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
  };
}

let cache: ReturnType<typeof memoryCache>;

function readRevisionRow(scope: "market" | "pedia" | "games"): string | null {
  const row = fixture.sql
    .prepare("SELECT value FROM store_settings WHERE key=?")
    .get(`catalog_revision_${scope}`) as { value?: string } | undefined;
  return row?.value ?? null;
}

beforeEach(() => {
  fixture = createD1Fixture();
  cache = memoryCache();
  vi.stubGlobal("caches", { default: cache });
  vi.stubEnv("VARIANTS_READ_ENABLED", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE", "true");
  vi.stubEnv("PRODUCT_VARIANTS_WRITE_ENABLED", "true");
  vi.stubEnv("PEDIA_ENABLED", "true");
  vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
  vi.stubEnv("ADMIN_JWT_SECRET", "test-p1-jwt-secret-0123456789");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "wr-key");
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-key");
  vi.stubEnv("SEKALIPAY_SECRET_KEY", "sk-sec");
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "tunvn-key");
});

afterEach(() => {
  fixture.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("R2-2: inventory import/revoke bumps revision only after syncUniqueVariantStock", () => {
  it("import and revoke (single & batch) sync product_variants.stock before catalog_revision_market bumps", async () => {
    fixture.sql.exec(`
      INSERT OR IGNORE INTO categories(id, name, slug, icon, sort_order) VALUES (1, 'AI Tools', 'ai-chatbot', 'bot', 10);
      INSERT INTO products(id, category_id, name, slug, description, price, stock, is_active, sort_order, source, fulfillment_mode)
      VALUES (1, 1, 'Unique App', 'unique-app', 'Desc', 25000, 0, 1, 10, 'manual', 'unique');
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
      VALUES (1, 1, 'UNQ-1', '1 Bulan', 25000, 0, 'unique', 1, 0);
    `);

    const observedStocksAtBump: number[] = [];
    const origPrepare = fixture.db.prepare.bind(fixture.db);
    vi.spyOn(fixture.db, "prepare").mockImplementation((query: string) => {
      const stmt = origPrepare(query);
      if (/INTO store_settings/i.test(query)) {
        const origBind = stmt.bind.bind(stmt);
        stmt.bind = (...params: unknown[]) => {
          const bound = origBind(...params);
          if (params.includes("catalog_revision_market")) {
            const origRun = bound.run.bind(bound);
            bound.run = async () => {
              const row = fixture.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get() as { stock: number };
              observedStocksAtBump.push(Number(row.stock));
              return origRun();
            };
          }
          return bound;
        };
      }
      return stmt;
    });

    const { POST, DELETE } = await import("@/app/api/admin/fulfillment/route");
    const importRes = await POST(new NextRequest("https://axvara.tech/api/admin/fulfillment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "import",
        product_id: 1,
        variant_id: 1,
        secrets: ["user1@a.com:p1", "user2@a.com:p2", "user3@a.com:p3"],
      }),
    }));
    expect(importRes.status).toBe(200);
    expect(observedStocksAtBump[0]).toBe(3);

    const invIds = fixture.sql
      .prepare("SELECT id FROM fulfillment_inventory WHERE product_id=1 ORDER BY id ASC")
      .all() as { id: number }[];

    const delSingle = await DELETE(new NextRequest("https://axvara.tech/api/admin/fulfillment", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory_id: invIds[0].id }),
    }));
    expect(delSingle.status).toBe(200);
    expect(observedStocksAtBump[1]).toBe(2);

    const delBatch = await DELETE(new NextRequest("https://axvara.tech/api/admin/fulfillment", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: 1, variant_id: 1, inventory_ids: [invIds[1].id, invIds[2].id] }),
    }));
    expect(delBatch.status).toBe(200);
    expect(observedStocksAtBump[2]).toBe(0);
    expect(observedStocksAtBump).toHaveLength(3);
  });
});

describe("R2-3: publishTunvnCatalog bumps revision even when buffError occurs after committed mutations", () => {
  it("bumps catalog_revision_market when account mutations commit and /api/buff/check fails", async () => {
    fixture.sql.exec(`
      INSERT OR IGNORE INTO categories(id, name, slug, icon, sort_order) VALUES (1, 'AI Tools', 'ai-chatbot', 'bot', 10);
      INSERT INTO products(id, category_id, name, slug, description, price, stock, is_active, sort_order, source, fulfillment_mode)
      VALUES (10, 1, 'Muse AI', 'muse-ai-1-miliar-token', 'Muse', 20000, -1, 1, 10, 'manual', 'manual');
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt, tunvn_markup_percent, tunvn_fx_idr_per_usdt)
      VALUES (101, 10, 'TUNVN-BUFF-1B', 'Buff Token Muse AI per 1B', 11200, -1, 'manual', 1, 10, 1, 0.5, 40, 16000);
    `);
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/api/buff/check")) {
        return new Response("upstream error", { status: 500 });
      }
      return Response.json({
        success: true,
        usdt_vnd: 25000,
        products: [{ id: 10, name: "ChatGPT Team", description: "Team", price_vnd: 50000, price_usdt: 2, stock: 5 }],
      });
    }));

    const { publishTunvnCatalog } = await import("@/lib/tunvn/catalog");
    const db = createDatabaseAccess(fixture.db);
    const first = await publishTunvnCatalog(db, 16000, { force: true, now: 1_700_000_000_000 });
    expect(first).toEqual({ ok: false, error: "buff_ambiguous:http_500" });
    const revAfterCommit = readRevisionRow("market");
    expect(revAfterCommit).toBeTruthy();

    // Subsequent tick when Buff recovers with identical account & Buff values does not miss invalidation.
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/api/buff/check")) {
        return Response.json({
          success: true,
          fundable: true,
          gross_cost_vnd: 12500,
          sell_price_vnd: 12500,
          sell_price_usdt: 0.5,
          orders_breakdown: [{ invite_code: "AXVARA", quantity_b: 1, valid: true }],
        });
      }
      return Response.json({
        success: true,
        usdt_vnd: 25000,
        products: [{ id: 10, name: "ChatGPT Team", description: "Team", price_vnd: 50000, price_usdt: 2, stock: 5 }],
      });
    }));
    const second = await publishTunvnCatalog(db, 16000, { force: true, now: 1_700_000_060_000 });
    expect(second).toMatchObject({ ok: true });
    expect(readRevisionRow("market")).toBe(revAfterCommit);
  });
});

describe("R2-4: syncProducts (WR) & syncSkProducts (SK) bump market revision on display metadata changes", () => {
  it("WR bumps once when description, label, duration, or warranty changes with unchanged price/stock, and 0 on no-op", async () => {
    const { syncProducts } = await import("@/lib/warung-rebahan/sync");
    const db = createDatabaseAccess(fixture.db);

    const makeProduct = (overrides: {
      description?: string;
      variantName?: string;
      duration?: string;
      warranty?: string;
    } = {}) => [{
      id: "wrp-meta-1",
      name: "Spotify Premium",
      category: "Musik",
      description: overrides.description ?? "Deskripsi v1",
      variants: [{
        id: "wrv-meta-1",
        name: overrides.variantName ?? "Sharing 1B",
        price: 10000,
        duration: overrides.duration ?? "1 Bulan",
        type: "sharing",
        warranty: overrides.warranty ?? "Garansi 7 Hari",
        stock: 5,
        terms: null,
        delivery_terms: null,
      }],
    }];

    await syncProducts(db, async () => makeProduct());
    const revInit = readRevisionRow("market");
    expect(revInit).toBeTruthy();

    // No-op sweep: 0 bumps
    await syncProducts(db, async () => makeProduct());
    expect(readRevisionRow("market")).toBe(revInit);

    // Description change only (count bump writes = 1)
    let bumpWrites = 0;
    fixture.control.fail = (q, p) => {
      if (/INTO store_settings/i.test(q) && p.includes("catalog_revision_market")) bumpWrites++;
      return false;
    };
    await syncProducts(db, async () => makeProduct({ description: "Deskripsi v2" }));
    const revAfterDesc = readRevisionRow("market");
    expect(revAfterDesc).not.toBe(revInit);
    expect(bumpWrites).toBe(1);

    // Label + duration + warranty change with same price/stock -> 1 bump
    bumpWrites = 0;
    await syncProducts(db, async () => makeProduct({
      description: "Deskripsi v2",
      variantName: "Sharing VIP",
      duration: "2 Bulan",
      warranty: "Full 2 Bulan",
    }));
    expect(readRevisionRow("market")).not.toBe(revAfterDesc);
    expect(bumpWrites).toBe(1);

    // No-op after metadata update -> 0 bumps
    bumpWrites = 0;
    const revStable = readRevisionRow("market");
    await syncProducts(db, async () => makeProduct({
      description: "Deskripsi v2",
      variantName: "Sharing VIP",
      duration: "2 Bulan",
      warranty: "Full 2 Bulan",
    }));
    expect(readRevisionRow("market")).toBe(revStable);
    expect(bumpWrites).toBe(0);
  });

  it("SK bumps once when variant label changes or stale compare_price clears with unchanged price/stock, and 0 on no-op", async () => {
    const { syncSkProducts } = await import("@/lib/sekalipay/sync");
    const db = createDatabaseAccess(fixture.db);

    const makeSk = (variantName = "Canva 1 Bulan") => ({
      server_time: "2026-11-18T00:00:00Z",
      data: [{
        id: 1,
        name: "Aplikasi Premium",
        icon: null,
        products: [{
          id: 501,
          name: "Canva Pro SK",
          image: null,
          variants: [{
            id: 9001,
            sku: "SK-9001",
            name: variantName,
            price: 10000,
            stock: 5,
            status: "available",
            order_process: "auto" as const,
            h2h_provider: null,
            provider_meta: null,
            required_fields: null,
            validation: null,
            updated_at: null,
          }],
        }],
      }],
    });

    await syncSkProducts(db, async () => makeSk("Canva 1 Bulan"));
    const revInit = readRevisionRow("market");
    expect(revInit).toBeTruthy();

    // No-op -> 0 bumps
    await syncSkProducts(db, async () => makeSk("Canva 1 Bulan"));
    expect(readRevisionRow("market")).toBe(revInit);

    // Label change only -> 1 bump
    let bumpWrites = 0;
    fixture.control.fail = (q, p) => {
      if (/INTO store_settings/i.test(q) && p.includes("catalog_revision_market")) bumpWrites++;
      return false;
    };
    await syncSkProducts(db, async () => makeSk("Canva 1 Bulan Pro"));
    const revAfterLabel = readRevisionRow("market");
    expect(revAfterLabel).not.toBe(revInit);
    expect(bumpWrites).toBe(1);

    // No-op after label update -> 0 bumps
    bumpWrites = 0;
    await syncSkProducts(db, async () => makeSk("Canva 1 Bulan Pro"));
    expect(readRevisionRow("market")).toBe(revAfterLabel);
    expect(bumpWrites).toBe(0);
  });
});

describe("R2-5: syncJaspayCatalog does not stall silently when a product exceeds remaining budget", () => {
  it("records jaspay_catalog_last_error, advances cursor, returns error, and triggers cron/lite 503", async () => {
    const oversized = {
      product: "oversized-pack",
      name: "Oversized Pack",
      available: true,
      max_quantity: 5,
      packages: Array.from({ length: 16 }, (_, idx) => ({
        id: `pkg-${idx + 1}`,
        name: `Paket ${idx + 1}`,
        price: 10000 + idx * 100,
        available: true,
      })),
    };
    const small = {
      product: "z-small-pack",
      name: "Z Small Pack",
      available: true,
      max_quantity: 5,
      packages: [{ id: "small-1", name: "Paket 1", price: 10000, available: true }],
    };

    const { syncJaspayCatalog } = await import("@/lib/warung-rebahan/sync");
    const budget = createBudgetedDatabase(96, 2, fixture.db);
    const res = await syncJaspayCatalog(budget.access, async () => [oversized, small], { maxProducts: 10 });

    expect(res.errors.length).toBeGreaterThan(0);
    expect(budget.used).toBeLessThanOrEqual(96);

    const errRow = fixture.sql
      .prepare("SELECT value FROM store_settings WHERE key='jaspay_catalog_last_error'")
      .get() as { value?: string } | undefined;
    expect(errRow?.value).toBeTruthy();

    // Cursor must have advanced past oversized-pack so next tick is not stuck forever.
    const cursorRow = fixture.sql
      .prepare("SELECT value FROM wr_sync_state WHERE key='jaspay_catalog_cursor'")
      .get() as { value?: string } | undefined;
    expect(cursorRow?.value).toBeTruthy();

    // Cron endpoint must report 503 instead of silent 200 ok:true when only oversized product exists.
    vi.stubEnv("CRON_SECRET", "cron-secret-p1");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([oversized])));
    const { POST: cronLite } = await import("@/app/api/cron/lite/route");
    const cronRes = await cronLite(new NextRequest("https://axvara.tech/api/cron/lite?job=jaspay_catalog", {
      method: "POST",
      headers: { Authorization: "Bearer cron-secret-p1" },
    }));
    expect(cronRes.status).toBe(503);
  });
});

describe("R4-2: POST /api/pedia/orders bumps catalog_revision_pedia when margin guard disables tier", () => {
  it("invalidates cached /api/pedia/catalog immediately after 410 pedia_guard_margin", async () => {
    const db = createDatabaseAccess(fixture.db);
    await db.execRun(
      `INSERT INTO pedia_products (slug, platform, metric, target_kind, name, packages_json, step, is_active)
       VALUES ('followers-ig','instagram','followers','profile','Followers IG','[700]',10,1)`,
    );
    const p = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug='followers-ig'`);
    const pid = Number(p?.id);
    await db.execRun(
      `INSERT INTO pedia_tiers (product_id, tier, supplier, supplier_service_id, price_group,
         markup_pct, min_profit_rp, refill_days, package_prices_json, is_active)
       VALUES (?, 'standar', 'indosmm', 86, 'G3', 0, 500, 30, '{}', 1)`,
      pid,
    );
    const tier = await db.queryFirst(`SELECT id FROM pedia_tiers WHERE product_id=?`, pid);
    const tierId = Number(tier?.id);

    const { applyPediaDiff } = await import("@/lib/pedia/sync");
    // Rate that produces 5000 / 7 = 714.2857... -> IEEE-754 margin 499.99999999999994 < 500 at qty=700.
    await applyPediaDiff(db, "indosmm", [{
      service_id: 86, name: "IG Followers", type: "Default", category: "IG",
      rate: 5000 / 7, min_qty: 100, max_qty: 1000,
      api_refill: 0, api_cancel: 0, api_dripfeed: 1,
    }], [], "IDR");

    const { GET: pediaCatalog } = await import("@/app/api/pedia/catalog/route");
    const cat1 = await pediaCatalog();
    expect(cat1.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await cat1.json()).products[0].tiers).toHaveLength(1);
    expect((await pediaCatalog()).headers.get("X-Axvara-Cache")).toBe("HIT");

    const { POST: quotePost } = await import("@/app/api/pedia/quote/route");
    const q = await quotePost(new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_id: pid,
        tier_id: tierId,
        quantity: 700,
        target: "https://www.instagram.com/namakamu",
      }),
    }) as never);
    expect(q.status).toBe(200);
    const { quote_token } = await q.json();
    const revBefore = readRevisionRow("pedia");

    const { POST: orderPost } = await import("@/app/api/pedia/orders/route");
    const orderRes = await orderPost(new Request("http://x/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_wa: "081234567890",
        customer_email: "buyer@example.com",
        quote_token,
      }),
    }) as never);
    expect(orderRes.status).toBe(410);
    expect((await orderRes.json()).error).toBe("pedia_guard_margin");
    expect(readRevisionRow("pedia")).not.toBe(revBefore);

    const cat2 = await pediaCatalog();
    expect(cat2.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await cat2.json()).products).toEqual([]);
  });
});
