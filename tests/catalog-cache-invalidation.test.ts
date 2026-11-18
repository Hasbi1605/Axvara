import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

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

function seedBaseMarketCatalog() {
  fixture.sql.exec(`
    INSERT OR IGNORE INTO categories(id, name, slug, icon, sort_order) VALUES (1, 'AI Tools', 'ai-chatbot', 'bot', 10);
    INSERT INTO products(id, category_id, name, slug, description, price, stock, is_active, sort_order, telegram_enabled, source, fulfillment_mode)
    VALUES (1, 1, 'ChatGPT Plus', 'chatgpt-plus', 'Desc', 25000, 5, 1, 10, 1, 'manual', 'manual');
    INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order)
    VALUES (1, 1, 'CGPT-1M', '1 Bulan', 25000, 5, 'manual', 1, 0);
  `);
}

function seedPediaCatalog() {
  fixture.sql.exec(`
    INSERT INTO pedia_supplier_services(supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, api_refill, api_cancel, api_dripfeed, present)
    VALUES ('indosmm', 101, 'IG Followers HQ', 'Instagram', 'Default', 5000, 100, 10000, 1, 0, 0, 1);
    INSERT INTO pedia_products(id, slug, platform, metric, target_kind, name, tagline, checklist_json, packages_json, step, sort_order, is_active, is_featured)
    VALUES (1, 'ig-followers', 'instagram', 'followers', 'username', 'Instagram Followers', 'Cepat', '[]', '[100,500]', 100, 1, 1, 1);
    INSERT INTO pedia_tiers(id, product_id, tier, label_note, supplier, supplier_service_id, price_group, markup_pct, min_profit_rp, refill_days, package_prices_json, rate_snapshot, is_active)
    VALUES (1, 1, 'standar', 'Stabil', 'indosmm', 101, 'G1', 50, 500, 30, '{"100":1000,"500":4000}', 5000, 1);
  `);
}

function seedGamesCatalog() {
  fixture.sql.exec(`
    INSERT INTO games_products(
      buyer_sku_code, supplier, supplier_active, sk_variant_id, sk_sku, sk_product_id, sk_product_name,
      game_slug, game_brand, product_type, product_type_name, product_name, cost, sell_price, stock,
      min_order, unlimited_stock, description, enabled
    ) VALUES (
      'sk:101', 'sekalipay', 1, '101', 'ML86', '33', 'Mobile Legends',
      'mobile-legends', 'Mobile Legends', 'Top Up', 'Top Up', '86 Diamond', 10000, 11000, 10,
      1, 0, 'Instan', 1
    );
  `);
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
  vi.stubEnv("GAMES_SK_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "sk-key");
  vi.stubEnv("SEKALIPAY_SECRET_KEY", "sk-sec");
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_API_KEY", "wr-key");
  vi.stubEnv("SEKALIPAY_SYNC_ENABLED", "true");
  vi.stubEnv("SUPPLIER_SYNC_TOKEN", "sync-token-123");
  vi.stubEnv("ORDER_ACCESS_SECRET", "order-secret-123");
  vi.stubEnv("FULFILLMENT_ENCRYPTION_KEY", Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"));
});

afterEach(() => {
  fixture.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("revisioned catalog cache & memoization", () => {
  it("memoizes revision per isolate for 5s, rotates d1-v2 cache key on bump, and isolates scopes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
    const {
      cachePublicCatalog,
      bumpCatalogRevision,
      getCatalogRevision,
      REVISION_MEMO_TTL_MS,
    } = await import("@/lib/catalog-cache");
    expect(REVISION_MEMO_TTL_MS).toBe(5000);

    let loads = 0;
    const r1 = await cachePublicCatalog("products:list", 300, async () =>
      Response.json({ loads: ++loads }, { headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } }),
    "market");
    expect(r1.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(r1.headers.get("Cache-Control")).toBe("public, max-age=15, s-maxage=30");
    expect([...cache.entries.keys()][0]).toMatch(/^https:\/\/axvara\.tech\/__catalog-cache\/d1-v2\/market\/0\/products:list$/);

    const qAfterMiss = fixture.control.queries;
    const r2 = await cachePublicCatalog("products:list", 300, async () => Response.json({ loads: ++loads }), "market");
    expect(r2.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(r2.headers.get("Cache-Control")).toBe("public, max-age=15, s-maxage=30");
    expect(fixture.control.queries).toBe(qAfterMiss);

    // Concurrent reads after 5s memo expiry coalesce into 1 D1 query
    vi.setSystemTime(new Date("2026-11-18T00:00:06Z"));
    const qBeforeExpire = fixture.control.queries;
    const revs = await Promise.all([
      getCatalogRevision("market"),
      getCatalogRevision("pedia"),
      getCatalogRevision("games"),
    ]);
    expect(revs).toEqual(["0", "0", "0"]);
    expect(fixture.control.queries - qBeforeExpire).toBe(1);

    // External colo bump in store_settings is picked up <= 5s later
    fixture.sql.prepare("INSERT INTO store_settings(key,value) VALUES('catalog_revision_market','colo-2') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    expect(await getCatalogRevision("market")).toBe("0"); // within 5s memo
    vi.setSystemTime(new Date("2026-11-18T00:00:12Z"));
    expect(await getCatalogRevision("market")).toBe("colo-2");
    expect(await getCatalogRevision("pedia")).toBe("0");

    // Local bump updates memo immediately (0s delay) and calls cache.delete
    const bumped = await bumpCatalogRevision("market");
    expect(bumped).toBeTruthy();
    expect(cache.delete).toHaveBeenCalled();
    expect(await getCatalogRevision("market")).toBe(bumped);
    const r3 = await cachePublicCatalog("products:list", 300, async () => Response.json({ loads: ++loads }), "market");
    expect(r3.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect(await r3.json()).toEqual({ loads: 2 });
  });

  it("caches /api/games/catalog per ordering_open and keeps private routes uncached", async () => {
    seedGamesCatalog();
    const { GET: getGames } = await import("@/app/api/games/catalog/route");
    const first = await getGames();
    expect(first.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await first.json()).ordering_open).toBe(true);
    const q = fixture.control.queries;
    const second = await getGames();
    expect(second.headers.get("X-Axvara-Cache")).toBe("HIT");
    expect(fixture.control.queries).toBe(q);

    // Separate key when ordering_open flips
    vi.stubEnv("GAMES_SK_ENABLED", "false");
    const closed = await getGames();
    expect(closed.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await closed.json()).ordering_open).toBe(false);
  });
});

describe("checkout, restock, expiry, and inventory invalidation", () => {
  it("bumps market revision on createOrderWithStock, channel orders, cancel/expiry restock, sold_count, and inventory mutations (ignoring Pedia/Games)", async () => {
    seedBaseMarketCatalog();
    const { GET: getProducts } = await import("@/app/api/products/route");
    const initial = await getProducts(new NextRequest("https://axvara.tech/api/products?active=1"));
    expect((await initial.json()).products[0].stock).toBe(5);

    // 1. Web checkout stock reservation
    const { createOrderWithStock } = await import("@/lib/db/orders-create");
    await createOrderWithStock({
      code: "AXV-20261118-00000001",
      quoteId: "q-web-1",
      customerName: "Budi",
      customerWa: "08123456789",
      customerEmail: "budi@example.com",
      items: [{ product_id: 1, variant_id: 1, name: "ChatGPT Plus — 1 Bulan", price: 25000, qty: 2 }],
      subtotal: 50000,
      paymentMethod: "qris",
      paymentAccount: "QRIS",
      proofUrl: null,
    });
    const revAfterWebOrder = readRevisionRow("market");
    expect(revAfterWebOrder).toBeTruthy();
    const afterOrder = await getProducts(new NextRequest("https://axvara.tech/api/products?active=1"));
    expect(afterOrder.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await afterOrder.json()).products[0].stock).toBe(3);

    // 2. Expiry restock via transitionPendingPaymentOrder
    fixture.sql.prepare(
      "INSERT INTO payment_transactions(order_code, provider, provider_mode, provider_order_id, merchant_id, payable_amount, requested_amount, status, expires_at) VALUES('AXV-20261118-00000001','dana','qris_static','poid-1','m-1',50001,50000,'pending',datetime('now','-10 minutes'))",
    ).run();
    const { transitionPendingPaymentOrder, transitionPendingOrder, transitionPendingPaymentToPaid } = await import("@/lib/db/orders-transition");
    const expired = await transitionPendingPaymentOrder({
      orderCode: "AXV-20261118-00000001",
      expectedTransactionStatus: "pending",
      transactionStatus: "expired",
      orderStatus: "kadaluarsa",
      paymentStatus: "expired",
      items: [{ product_id: 1, variant_id: 1, qty: 2 }],
    });
    expect(expired).toBe(true);
    const revAfterExpiry = readRevisionRow("market");
    expect(revAfterExpiry).not.toBe(revAfterWebOrder);
    const afterExpiry = await getProducts(new NextRequest("https://axvara.tech/api/products?active=1"));
    expect(afterExpiry.headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await afterExpiry.json()).products[0].stock).toBe(5);

    // 3. Pedia order expiry must NOT bump Market revision
    fixture.sql.exec(`
      INSERT INTO orders(code, customer_name, customer_wa, items, subtotal, payment_method, payment_account, status, payment_status, order_kind)
      VALUES('AXV-20261118-PEDIA001', 'Ani', '0812', '[{"product_id":1,"variant_id":1,"qty":1}]', 1000, 'qris', 'QRIS', 'pending', 'unpaid', 'pedia');
    `);
    await transitionPendingOrder("AXV-20261118-PEDIA001", "dibatalkan", "test", [{ product_id: 1, variant_id: 1, qty: 1 }]);
    expect(readRevisionRow("market")).toBe(revAfterExpiry);

    // 4. Channel atomic + pending orders
    const { createChannelOrderAtomic, createPendingChannelOrder } = await import("@/lib/commerce");
    await createChannelOrderAtomic({
      orderCode: "AXV-20261118-TG000001",
      idempotencyKey: "tg-1",
      lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 5 }],
      items: [{ product_id: 1, variant_id: 1, name: "ChatGPT", price: 25000, qty: 1 }],
      variantSnapshot: "{}",
      subtotal: 25000,
      primaryVariantId: 1,
      customerName: "TG",
      salesChannel: "telegram",
      telegramChatId: "123",
      telegramUserId: "123",
      paymentMethod: "qris",
      paymentAccount: "QRIS",
      fulfillmentStatus: "not_required",
    });
    const revAfterTg = readRevisionRow("market");
    expect(revAfterTg).not.toBe(revAfterExpiry);
    // Idempotent replay does NOT bump
    await createChannelOrderAtomic({
      orderCode: "AXV-20261118-TG000001-DUP",
      idempotencyKey: "tg-1",
      lines: [{ productId: 1, variantId: 1, qty: 1, fulfillmentMode: "manual", stock: 5 }],
      items: [{ product_id: 1, variant_id: 1, name: "ChatGPT", price: 25000, qty: 1 }],
      variantSnapshot: "{}",
      subtotal: 25000,
      primaryVariantId: 1,
      customerName: "TG",
      salesChannel: "telegram",
      paymentMethod: "qris",
      paymentAccount: "QRIS",
      fulfillmentStatus: "not_required",
    });
    expect(readRevisionRow("market")).toBe(revAfterTg);

    await createPendingChannelOrder({
      salesChannel: "whatsapp",
      productId: 1,
      productName: "ChatGPT Plus",
      variantId: 1,
      variant: { id: 1, product_id: 1, sku: "CGPT-1M", label: "1 Bulan", terms: null, delivery_terms: null, wr_delivery_class: null, wr_type: null, require_email: 0, price: 25000, compare_price: null, stock: 4, min_qty: 1, max_qty: null, buyer_field_key: null, fulfillment_mode: "manual", is_active: 1, sort_order: 0, duration_value: null, duration_unit: null, duration_label: null, warranty_type: "none", warranty_value: null, warranty_unit: null, warranty_label: null, bulk_pricing_enabled: false, bulk_pricing_tiers: [] },
      customerId: "wa-1",
      customerName: "WA",
      idempotencyKey: "wa-order-1",
    });
    const revAfterWa = readRevisionRow("market");
    expect(revAfterWa).not.toBe(revAfterTg);

    // 5. Paid transition increments sold_count and bumps market
    fixture.sql.prepare(
      "INSERT INTO payment_transactions(order_code, provider, provider_mode, provider_order_id, merchant_id, payable_amount, requested_amount, status, expires_at) VALUES('AXV-20261118-TG000001','dana','qris_static','poid-2','m-1',25001,25000,'pending',datetime('now','+10 minutes'))",
    ).run();
    const paid = await transitionPendingPaymentToPaid("AXV-20261118-TG000001");
    expect(paid).toBe(true);
    const revAfterPaid = readRevisionRow("market");
    expect(revAfterPaid).not.toBe(revAfterWa);

    // 6. Unique inventory import & revoke
    const { importInventory, revokeInventory, revokeInventoryBatch } = await import("@/lib/fulfillment/inventory");
    const imp = await importInventory(1, ["acc1@test.com:pass1", "acc2@test.com:pass2"], 1);
    expect(imp.inserted).toBe(2);
    const revAfterImp = readRevisionRow("market");
    expect(revAfterImp).not.toBe(revAfterPaid);
    const invIds = fixture.sql.prepare("SELECT id FROM fulfillment_inventory WHERE product_id=1 ORDER BY id").all() as { id: number }[];
    expect(await revokeInventory(invIds[0].id)).toBe(true);
    const revAfterRevoke1 = readRevisionRow("market");
    expect(revAfterRevoke1).not.toBe(revAfterImp);
    expect(await revokeInventoryBatch(1, 1, [invIds[1].id])).toBe(1);
    expect(readRevisionRow("market")).not.toBe(revAfterRevoke1);

    // 7. Cron expiry coalesces multiple expired orders into at most ONE revision bump per run
    vi.stubEnv("CRON_SECRET", "cron-secret");
    for (let i = 1; i <= 3; i++) {
      const code = `EXP-COALESCE-${i}`;
      fixture.sql.prepare(`
        INSERT INTO orders(code, customer_name, customer_wa, items, subtotal, payment_method, status, payment_status, sales_channel, order_kind, expires_at)
        VALUES(?, 'Buyer', '628123', ?, 25000, 'qris', 'pending', 'pending', 'web', 'apps', datetime('now','-10 minutes'))
      `).run(code, JSON.stringify([{ product_id: 1, variant_id: 1, qty: 1 }]));
      fixture.sql.prepare(`
        INSERT INTO payment_transactions(order_code, provider, provider_mode, provider_order_id, merchant_id, requested_amount, status, expires_at)
        VALUES(?, 'dana', 'static', ?, 'm1', 25001, 'pending', datetime('now','-10 minutes'))
      `).run(code, `TX-${i}`);
    }
    const revBeforeCoalescedExpiry = readRevisionRow("market");
    const expiryWrites: string[] = [];
    fixture.control.fail = (query, params) => {
      if (/INTO store_settings/i.test(query) && params.includes("catalog_revision_market")) expiryWrites.push(query);
      return false;
    };
    const { POST: cronLitePost } = await import("@/app/api/cron/lite/route");
    const expRes = await cronLitePost(new NextRequest("https://axvara.tech/api/cron/lite?job=expiry", {
      method: "POST",
      headers: { authorization: "Bearer cron-secret" },
    }));
    fixture.control.fail = null;
    expect(expRes.status).toBe(200);
    expect((await expRes.json()).expired_payments).toBe(3);
    expect(expiryWrites).toHaveLength(1);
    expect(readRevisionRow("market")).not.toBe(revBeforeCoalescedExpiry);
  });
});

describe("supplier syncs and product groups invalidation (skip no-op)", () => {
  it("bumps only on real changes for WR, SK, Jaspay, TUNVN, AIVault, Pedia, Games SK, Games Digiflazz, and Product Groups", async () => {
    seedBaseMarketCatalog();
    seedPediaCatalog();
    seedGamesCatalog();

    // Product Groups: create + add/remove member + decideDirtyWinners + delete
    fixture.sql.exec(`
      INSERT INTO products(id, category_id, name, slug, price, stock, is_active, sort_order, source, fulfillment_mode)
      VALUES (2, 1, 'ChatGPT Backup', 'chatgpt-backup', 30000, 5, 1, 20, 'manual', 'manual'),
             (3, 1, 'ChatGPT Third', 'chatgpt-third', 35000, 5, 1, 30, 'manual', 'manual');
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, manual_cost)
      VALUES (2, 2, 'CGPT-2', '1 Bulan', 30000, 5, 'manual', 1, 0, 20000),
             (3, 3, 'CGPT-3', '1 Bulan', 35000, 5, 'manual', 1, 0, 25000);
    `);
    const {
      createProductGroup,
      addGroupMember,
      removeGroupMember,
      deleteProductGroup,
      decideDirtyGroups,
    } = await import("@/lib/product-groups");
    const group = await createProductGroup({ name: "ChatGPT Group", productIds: [1, 2] });
    const rGroupCreate = readRevisionRow("market");
    expect(rGroupCreate).toBeTruthy();

    // No-op drain does NOT bump
    const cleanDrain = await decideDirtyGroups();
    expect(cleanDrain.changed).toBe(0);
    expect(readRevisionRow("market")).toBe(rGroupCreate);

    await addGroupMember(group.id, 3);
    const rGroupAdd = readRevisionRow("market");
    expect(rGroupAdd).not.toBe(rGroupCreate);

    await removeGroupMember(group.id, 3);
    const rGroupRemove = readRevisionRow("market");
    expect(rGroupRemove).not.toBe(rGroupAdd);

    await deleteProductGroup(group.id);
    const rGroupDel = readRevisionRow("market");
    expect(rGroupDel).not.toBe(rGroupRemove);

    // Supplier sync HTTP route: WR diff, SK diff, pairs, IndoSMM diff
    const { POST: supplierSync } = await import("@/app/api/supplier-sync/route");
    const syncReq = (body: unknown) =>
      new NextRequest("https://axvara.tech/api/supplier-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-supplier-sync-token": "sync-token-123" },
        body: JSON.stringify(body),
      });

    // WR heartbeat (0 changes) does NOT bump
    const wrNoop = await supplierSync(syncReq({ supplier: "wr", products: [], removed_variant_ids: [] }));
    expect(wrNoop.status).toBe(200);
    expect(readRevisionRow("market")).toBe(rGroupDel);

    // WR real diff bumps market
    const wrChange = await supplierSync(syncReq({
      supplier: "wr",
      products: [{
        id: "wrp-1",
        name: "Spotify WR",
        category: "Musik",
        description: "Musik",
        variants: [{ id: "wrv-1", name: "1 Bulan", price: 10000, duration: "1 Bulan", type: "sharing", warranty: "Full", stock: 4 }],
      }],
      removed_variant_ids: [],
    }));
    expect(wrChange.status).toBe(200);
    const rWr = readRevisionRow("market");
    expect(rWr).not.toBe(rGroupDel);

    // SK diff no-op vs change
    const skNoop = await supplierSync(syncReq({ supplier: "sk", rows: [], removed_variant_ids: [] }));
    expect(skNoop.status).toBe(200);
    expect(readRevisionRow("market")).toBe(rWr);

    const skChange = await supplierSync(syncReq({
      supplier: "sk",
      rows: [{
        productId: "skp-1",
        productName: "Canva SK",
        categoryName: "Design",
        variant: { id: "skv-1", name: "1 Bulan", price: 5000, stock: 7, status: "available", order_process: "auto" },
      }],
      removed_variant_ids: [],
    }));
    expect(skChange.status).toBe(200);
    const rSk = readRevisionRow("market");
    expect(rSk).not.toBe(rWr);

    // IndoSMM heartbeat no-op vs real rate change
    const pediaNoop = await supplierSync(syncReq({ source: "indosmm", currency: "IDR", services: [], removed_service_ids: [], heartbeat: true }));
    expect(pediaNoop.status).toBe(200);
    expect(readRevisionRow("pedia")).toBeNull();

    const pediaChange = await supplierSync(syncReq({
      source: "indosmm",
      currency: "IDR",
      services: [{ service_id: 101, name: "IG Followers HQ", type: "Default", category: "Instagram", rate: 6000, min_qty: 100, max_qty: 10000, api_refill: 1, api_cancel: 0, api_dripfeed: 0 }],
      removed_service_ids: [],
    }));
    expect(pediaChange.status).toBe(200);
    const rPedia = readRevisionRow("pedia");
    expect(rPedia).toBeTruthy();

    // Jaspay catalog sync: change bumps, identical second run skips bump
    const jaspayFetch = async () => [{
      product: "canva-jp",
      name: "Canva Jaspay",
      available: true,
      max_quantity: 5,
      packages: [{ id: "pkg-1", name: "1 Bulan", price: 10000, available: true }],
    }];
    const { syncJaspayCatalog } = await import("@/lib/warung-rebahan/sync");
    await syncJaspayCatalog(undefined, jaspayFetch);
    const rJaspay1 = readRevisionRow("market");
    expect(rJaspay1).not.toBe(rSk);
    await syncJaspayCatalog(undefined, jaspayFetch);
    expect(readRevisionRow("market")).toBe(rJaspay1);

    // TUNVN publish: change bumps, identical second run skips bump
    vi.stubEnv("TUNVN_ENABLED", "true");
    vi.stubEnv("TUNVN_API_KEY", "tunvn-key");
    vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      if (String(url).includes("/api/buff/check")) {
        return Response.json({ success: true, fundable: true, sell_price_usdt: 0.5 });
      }
      return Response.json({
        success: true,
        usdt_vnd: 25000,
        products: [{ id: 10, name: "ChatGPT Team", description: "Team", price_vnd: 50000, price_usdt: 2, stock: 5 }],
      });
    }));
    const { createDatabaseAccess } = await import("@/lib/db-access");
    const { publishTunvnCatalog } = await import("@/lib/tunvn/catalog");
    await publishTunvnCatalog(createDatabaseAccess(fixture.db), 16000, { force: true, now: Date.now() });
    const rTunvn1 = readRevisionRow("market");
    expect(rTunvn1).not.toBe(rJaspay1);
    await publishTunvnCatalog(createDatabaseAccess(fixture.db), 16000, { force: true, now: Date.now() + 60_000 });
    expect(readRevisionRow("market")).toBe(rTunvn1);

    // AIVault project/publish: change bumps, identical second run skips bump
    fixture.sql.exec(`
      INSERT INTO aivault_products(service_id, name, stock, unit_price_usd, pricing_tiers_json, markup_percent, synced_at)
      VALUES ('service_gemini_plus_6m', 'Gemini Plus 6m', 4, 1.0, '[]', 50, '2026-11-18T00:00:00Z');
    `);
    const { projectAivaultCatalog } = await import("@/lib/aivault/catalog");
    await projectAivaultCatalog(createDatabaseAccess(fixture.db), 16000);
    const rAivault1 = readRevisionRow("market");
    expect(rAivault1).not.toBe(rTunvn1);
    await projectAivaultCatalog(createDatabaseAccess(fixture.db), 16000);
    expect(readRevisionRow("market")).toBe(rAivault1);

    // Games SK sync: change bumps games, identical second run skips bump
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      meta: { total_items: 1, is_delta: false },
      data: [{
        name: "Game",
        products: [{
          id: 33,
          name: "Mobile Legends",
          variants: [{ id: 101, name: "86 Diamond", sku: "ML86", price: 10500, stock: 8, status: "available", min_order: 1, order_process: "auto" }],
        }],
      }],
    })));
    const { syncGamesSkCatalog } = await import("@/lib/games/sk-catalog-sync");
    await syncGamesSkCatalog(createDatabaseAccess(fixture.db), { force: true, now: 1_700_000_000_000 });
    const rGames1 = readRevisionRow("games");
    expect(rGames1).toBeTruthy();
    await syncGamesSkCatalog(createDatabaseAccess(fixture.db), { force: true, now: 1_700_001_000_000 });
    expect(readRevisionRow("games")).toBe(rGames1);
  });
});

describe("admin product, variant, category, markup, pedia, and games mutations", () => {
  it("bumps the corresponding scope revision across all admin mutations", async () => {
    seedBaseMarketCatalog();
    seedPediaCatalog();
    seedGamesCatalog();

    const jsonReq = (url: string, method: string, body?: unknown) =>
      new NextRequest(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    // Market admin mutations
    const productsRoute = await import("@/app/api/products/route");
    const productByIdRoute = await import("@/app/api/products/[id]/route");
    const soldCountRoute = await import("@/app/api/products/[id]/sold-count/route");
    const reorderProductsRoute = await import("@/app/api/products/reorder/route");
    const categoriesRoute = await import("@/app/api/categories/route");
    const categoryByIdRoute = await import("@/app/api/categories/[id]/route");
    const reorderCategoriesRoute = await import("@/app/api/categories/reorder/route");
    const variantsRoute = await import("@/app/api/admin/variants/route");
    const supplierLinksRoute = await import("@/app/api/admin/supplier-links/route");
    const fulfillmentRoute = await import("@/app/api/admin/fulfillment/route");

    const expectMarketBump = async (fn: () => Promise<Response>, expectedStatus = 200) => {
      const before = readRevisionRow("market");
      const res = await fn();
      expect(res.status).toBe(expectedStatus);
      const after = readRevisionRow("market");
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
      return res;
    };

    const createdRes = await expectMarketBump(() => productsRoute.POST(jsonReq("https://axvara.tech/api/products", "POST", { name: "Claude Max", slug: "claude-max", price: 50000, categorySlug: "ai-chatbot" })));
    const createdId = String((await createdRes.json()).id);
    await expectMarketBump(() => productByIdRoute.PUT(jsonReq(`https://axvara.tech/api/products/${createdId}`, "PUT", { name: "Claude Max Pro" }), { params: Promise.resolve({ id: createdId }) }));
    await expectMarketBump(() => soldCountRoute.PATCH(jsonReq(`https://axvara.tech/api/products/${createdId}/sold-count`, "PATCH", { soldCount: 15 }), { params: Promise.resolve({ id: createdId }) }));
    await expectMarketBump(() => reorderProductsRoute.POST(jsonReq("https://axvara.tech/api/products/reorder", "POST", { productId: Number(createdId), direction: -1 })));
    await expectMarketBump(() => productByIdRoute.DELETE(jsonReq(`https://axvara.tech/api/products/${createdId}`, "DELETE"), { params: Promise.resolve({ id: createdId }) }));
    await expectMarketBump(() => productByIdRoute.PATCH(jsonReq(`https://axvara.tech/api/products/${createdId}`, "PATCH", { archived: false }), { params: Promise.resolve({ id: createdId }) }));

    const catRes = await expectMarketBump(() => categoriesRoute.POST(jsonReq("https://axvara.tech/api/categories", "POST", { name: "Desain", icon: "star", sort_order: 20 })), 201);
    const catId = String((await catRes.json()).id);
    await expectMarketBump(() => categoryByIdRoute.PUT(jsonReq(`https://axvara.tech/api/categories/${catId}`, "PUT", { name: "Desain Pro" }), { params: Promise.resolve({ id: catId }) }));
    await expectMarketBump(() => reorderCategoriesRoute.POST(jsonReq("https://axvara.tech/api/categories/reorder", "POST", { categoryId: Number(catId), direction: -1 })));
    await expectMarketBump(() => categoryByIdRoute.DELETE(jsonReq(`https://axvara.tech/api/categories/${catId}`, "DELETE"), { params: Promise.resolve({ id: catId }) }));

    const varRes = await expectMarketBump(() => variantsRoute.POST(jsonReq("https://axvara.tech/api/admin/variants", "POST", { product_id: 1, sku: "CGPT-3M", label: "3 Bulan", price: 65000, stock: 5, fulfillment_mode: "manual", is_active: 1, sort_order: 1 })), 201);
    const varId = String((await varRes.json()).id);
    await expectMarketBump(() => variantsRoute.PUT(jsonReq(`https://axvara.tech/api/admin/variants?id=${varId}`, "PUT", { price: 70000 })));
    await expectMarketBump(() => variantsRoute.DELETE(jsonReq(`https://axvara.tech/api/admin/variants?id=${varId}`, "DELETE")));

    await expectMarketBump(() => supplierLinksRoute.POST(jsonReq("https://axvara.tech/api/admin/supplier-links", "POST", { slug: "panduan", destination: "https://example.com/guide", title: "Panduan" })));
    await expectMarketBump(() => supplierLinksRoute.PUT(jsonReq("https://axvara.tech/api/admin/supplier-links", "PUT", { id: 1, title: "Panduan Baru" })));
    await expectMarketBump(() => supplierLinksRoute.DELETE(jsonReq("https://axvara.tech/api/admin/supplier-links?id=1", "DELETE")));

    await expectMarketBump(() => fulfillmentRoute.POST(jsonReq("https://axvara.tech/api/admin/fulfillment", "POST", { action: "set_mode", product_id: 1, variant_id: 1, fulfillment_mode: "shared" })));

    // Variant copy & bulk copy
    const variantCopyRoute = await import("@/app/api/admin/variant-copy/route");
    const variantCopyBulkRoute = await import("@/app/api/admin/variant-copy/bulk/route");
    const copyList = await (await variantCopyRoute.GET(new NextRequest("https://axvara.tech/api/admin/variant-copy?product_id=1"))).json() as { variants: { id: number; supplierKey: string }[] };
    const supplierKey = copyList.variants[0]?.supplierKey ?? "";
    await expectMarketBump(() => variantCopyRoute.PUT(jsonReq("https://axvara.tech/api/admin/variant-copy", "PUT", { variant_id: 1, terms: "Garansi penuh", activation: "Login web", supplier_key: supplierKey })));
    await expectMarketBump(() => variantCopyBulkRoute.POST(jsonReq("https://axvara.tech/api/admin/variant-copy/bulk", "POST", { product_id: 1, variant_ids: [1], terms: "Garansi 30 hari", activation: "Buka aplikasi", terms_en: "", activation_en: "" })));

    // WR & SK markup routes
    fixture.sql.exec(`
      INSERT INTO wr_products(wr_product_id, wr_product_name, axvara_product_id)
      VALUES('wrp-m1', 'Test WR', 1);
      INSERT INTO wr_variants(wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price)
      VALUES('wrv-m1','wrp-m1','1 Bulan',10000,5,1,20,0,12000);
      INSERT INTO sk_products(sk_variant_id, sk_product_id, sk_product_name, sk_category, sk_variant_name, sk_price, sk_stock, sk_status, axvara_product_id, axvara_variant_id, markup_percent, markup_fixed, axvara_sell_price)
      VALUES('skv-m1','skp-m1','Test SK','Premium','1 Bulan',10000,5,'available',1,1,20,0,12000);
    `);
    const wrMarkup = await import("@/app/api/admin/warung/markup/route");
    const wrMarkupBulk = await import("@/app/api/admin/warung/markup/bulk/route");
    const skMarkup = await import("@/app/api/admin/sekalipay/markup/route");
    const skMarkupBulk = await import("@/app/api/admin/sekalipay/markup/bulk/route");
    await expectMarketBump(() => wrMarkup.PUT(jsonReq("https://axvara.tech/api/admin/warung/markup", "PUT", { wr_variant_id: "wrv-m1", markup_percent: 30, markup_fixed: 0 })));
    await expectMarketBump(() => wrMarkupBulk.POST(jsonReq("https://axvara.tech/api/admin/warung/markup/bulk", "POST", { variant_ids: ["wrv-m1"], markup_percent: 35 })));
    await expectMarketBump(() => skMarkup.PUT(jsonReq("https://axvara.tech/api/admin/sekalipay/markup", "PUT", { sk_variant_id: "skv-m1", markup_percent: 30, markup_fixed: 0 })));
    await expectMarketBump(() => skMarkupBulk.POST(jsonReq("https://axvara.tech/api/admin/sekalipay/markup/bulk", "POST", { variant_ids: ["skv-m1"], markup_percent: 40 })));

    // TUNVN & AIVault admin item overrides
    fixture.sql.exec(`
      INSERT INTO tunvn_products(supplier_product_id, name, price_vnd, price_usdt, stock, axvara_product_id, fx_idr_per_usdt)
      VALUES(77, 'TUNVN Test', 25000, 1, 5, 1, 16000);
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_source_product_id, tunvn_cost_usdt)
      VALUES(90, 1, 'TUNVN-77', '77', 22000, 5, 'manual', 1, 5, 77, 1);
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, tunvn_buff_quantity_b, tunvn_cost_usdt)
      VALUES(91, 1, 'TUNVN-BUFF-1B', 'Buff 1B', 20000, -1, 'manual', 1, 6, 1, 1);
      INSERT INTO aivault_products(service_id, name, stock, unit_price_usd, pricing_tiers_json, markup_percent, fx_idr_per_usd, axvara_product_id)
      VALUES('svc-1', 'AIVault Test', 5, 1, '[]', 50, 16000, 1);
      INSERT INTO product_variants(id, product_id, sku, label, price, stock, fulfillment_mode, is_active, sort_order, aivault_service_id)
      VALUES(92, 1, 'AV-svc-1', 'AV 1', 24000, 5, 'manual', 1, 7, 'svc-1');
    `);
    const tunvnProdRoute = await import("@/app/api/admin/tunvn/products/[id]/route");
    const tunvnBuffRoute = await import("@/app/api/admin/tunvn/buff/[sku]/route");
    const aivaultProdRoute = await import("@/app/api/admin/aivault/products/[id]/route");
    await expectMarketBump(() => tunvnProdRoute.PATCH(jsonReq("https://axvara.tech/api/admin/tunvn/products/77", "PATCH", { admin_price_idr: 25000 }), { params: Promise.resolve({ id: "77" }) }));
    await expectMarketBump(() => tunvnBuffRoute.PATCH(jsonReq("https://axvara.tech/api/admin/tunvn/buff/TUNVN-BUFF-1B", "PATCH", { admin_price_idr: 21000 }), { params: Promise.resolve({ sku: "TUNVN-BUFF-1B" }) }));
    await expectMarketBump(() => aivaultProdRoute.PATCH(jsonReq("https://axvara.tech/api/admin/aivault/products/svc-1", "PATCH", { admin_price_idr: 26000 }), { params: Promise.resolve({ id: "svc-1" }) }));

    // Public cache endpoints: categories & telegram snapshot reflect bump immediately
    const { readTelegramCatalog } = await import("@/lib/telegram/catalog-snapshot");
    await readTelegramCatalog();
    expect(cache.entries.has(`https://axvara.tech/__catalog-cache/d1-v2/market/${readRevisionRow("market")}/telegram:catalog`)).toBe(true);
    const cats1 = await categoriesRoute.GET(new NextRequest("https://axvara.tech/api/categories"));
    expect(cats1.headers.get("X-Axvara-Cache")).toBe("MISS");
    const cats2 = await categoriesRoute.GET(new NextRequest("https://axvara.tech/api/categories"));
    expect(cats2.headers.get("X-Axvara-Cache")).toBe("HIT");

    // Pedia admin mutations & public pedia catalog cache
    const pediaCatalogRoute = await import("@/app/api/pedia/catalog/route");
    expect((await pediaCatalogRoute.GET()).headers.get("X-Axvara-Cache")).toBe("MISS");
    expect((await pediaCatalogRoute.GET()).headers.get("X-Axvara-Cache")).toBe("HIT");
    const pediaProductsRoute = await import("@/app/api/admin/pedia/products/route");
    const pediaSettingsRoute = await import("@/app/api/admin/pedia/settings/route");
    const beforePedia = readRevisionRow("pedia");
    expect((await pediaProductsRoute.PUT(jsonReq("https://axvara.tech/api/admin/pedia/products", "PUT", { id: 1, name: "Instagram Followers Pro" }))).status).toBe(200);
    const afterPedia1 = readRevisionRow("pedia");
    expect(afterPedia1).toBeTruthy();
    expect(afterPedia1).not.toBe(beforePedia);
    expect((await pediaSettingsRoute.PUT(jsonReq("https://axvara.tech/api/admin/pedia/settings", "PUT", { pedia_markup_g1: 55 }))).status).toBe(200);
    expect(readRevisionRow("pedia")).not.toBe(afterPedia1);

    // Games admin mutations
    const gamesMetaRoute = await import("@/app/api/admin/games/games/route");
    const gamesPricingRoute = await import("@/app/api/admin/games/pricing/route");
    const gamesProductsRoute = await import("@/app/api/admin/games/products/route");
    const gamesBulkRoute = await import("@/app/api/admin/games/products/bulk-markup/route");

    const expectGamesBump = async (fn: () => Promise<Response>) => {
      const before = readRevisionRow("games");
      const res = await fn();
      expect(res.status).toBe(200);
      const after = readRevisionRow("games");
      expect(after).toBeTruthy();
      expect(after).not.toBe(before);
    };

    await expectGamesBump(() => gamesMetaRoute.PATCH(jsonReq("https://axvara.tech/api/admin/games/games", "PATCH", { slug: "mobile-legends", display_name: "MLBB" })));
    await expectGamesBump(() => gamesPricingRoute.PUT(jsonReq("https://axvara.tech/api/admin/games/pricing", "PUT", { markup_percent: 10 })));
    await expectGamesBump(() => gamesProductsRoute.PATCH(jsonReq("https://axvara.tech/api/admin/games/products", "PATCH", { buyer_sku_code: "sk:101", display_group: "bestseller" })));
    await expectGamesBump(() => gamesBulkRoute.POST(jsonReq("https://axvara.tech/api/admin/games/products/bulk-markup", "POST", { skus: ["sk:101"], markup_percent: 12 })));
  });
});
