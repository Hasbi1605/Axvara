import fs from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  fetchTunvnBalance,
  fetchTunvnProducts,
  isTunvnConfigured,
  isTunvnEnabled,
  isTunvnSyncEnabled,
  parseTunvnProduct,
} from "@/lib/tunvn/client";
import { syncTunvnCatalog } from "@/lib/tunvn/sync";
import { createD1Fixture } from "./helpers/d1-fixture";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

const product = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `Produk ${id}`, price_vnd: 50_000, price_usdt: 1.96,
  discount_threshold: 0, discount_price_vnd: 0, discount_threshold_usdt: 0,
  discount_price_usdt: 0, stock: 7, description: "deskripsi", ...over,
});
const productsResponse = (rows: unknown[]) => vi.fn(async () =>
  new Response(JSON.stringify({ success: true, products: rows, usdt_vnd: 25_494 }), { status: 200 }));

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_SYNC_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "test-key-not-real");
  vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
});
afterEach(() => { fx.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const db = () => createDatabaseAccess(fx.db);
const row = (id: number) => fx.sql.prepare("SELECT * FROM tunvn_products WHERE supplier_product_id=?").get(id) as Record<string, unknown> | undefined;
const T0 = Date.UTC(2026, 10, 9, 10, 0, 0);

describe("0110 tunvn hidden catalog migration", () => {
  const migration = fs.readFileSync("drizzle/migrations/0110_tunvn_hidden_catalog.sql", "utf8");
  const schema = fs.readFileSync("drizzle/schema.sql", "utf8");
  const body = (sql: string) => {
    const m = sql.match(/CREATE TABLE IF NOT EXISTS tunvn_products \(([\s\S]*?)\n\);/);
    if (!m) throw new Error("tunvn_products missing");
    return m[1].replace(/\s+/g, " ").trim();
  };

  it("table body and indexes are identical to drizzle/schema.sql", () => {
    // Kolom migrasi 0112 di-inline di schema.sql (pola Games 0108); keluarkan
    // saat membandingkan bentuk dasar 0110 tanpa melonggarkan kolom lain.
    const later = [
      ", -- Migrasi 0112: tautan produk Market terbit + harga jual hasil markup. axvara_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL",
      ", markup_percent INTEGER NOT NULL DEFAULT 35 CHECK (markup_percent >= 0)",
      ", sell_price_idr INTEGER CHECK (sell_price_idr IS NULL OR sell_price_idr >= 0)",
      ", fx_idr_per_usdt REAL CHECK (fx_idr_per_usdt IS NULL OR fx_idr_per_usdt > 0)",
      ", -- Migrasi 0113: kontrol admin (tidak ditimpa sync/publish). admin_name TEXT",
      ", admin_description TEXT",
      ", publish_requested INTEGER NOT NULL DEFAULT 0 CHECK (publish_requested IN (0,1))",
    ];
    const baseSchema = later.reduce((text, column) => text.replace(column, ""), body(schema));
    expect(body(migration)).toBe(baseSchema);
    const indexes = (sql: string) => sql.match(/CREATE INDEX IF NOT EXISTS idx_tunvn_[^;]+ ON tunvn_products[^;]+;/g);
    expect(indexes(migration)).toEqual(indexes(schema));
    expect(indexes(migration)).toHaveLength(2);
  });

  it("applies idempotently and always defaults to hidden", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(migration);
      sqlite.exec(migration);
      sqlite.exec("INSERT INTO tunvn_products(supplier_product_id,name,price_vnd) VALUES(85,'Netflix',50000)");
      expect(sqlite.prepare("SELECT visible,synced_at FROM tunvn_products WHERE supplier_product_id=85").get())
        .toEqual({ visible: 0, synced_at: null });
      expect(() => sqlite.exec("INSERT INTO tunvn_products(supplier_product_id,name) VALUES(85,'dup')")).toThrow(/UNIQUE/);
      expect(() => sqlite.exec("INSERT INTO tunvn_products(supplier_product_id,name,visible) VALUES(86,'x',2)")).toThrow(/CHECK/);
    } finally { sqlite.close(); }
  });
});

describe("TUNVN gates", () => {
  it("is off by default and sync needs both switches plus key", async () => {
    vi.stubEnv("TUNVN_ENABLED", "");
    expect(isTunvnEnabled()).toBe(false);
    expect(isTunvnSyncEnabled()).toBe(false);
    expect(isTunvnConfigured()).toBe(false);
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await syncTunvnCatalog(db(), { now: T0 })).toEqual({ skipped: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sync switch alone cannot enable anything", () => {
    vi.stubEnv("TUNVN_ENABLED", "false");
    expect(isTunvnSyncEnabled()).toBe(false);
    expect(isTunvnConfigured()).toBe(false);
  });

  it("rejects a non-HTTPS base URL", () => {
    vi.stubEnv("TUNVN_BASE_URL", "http://tunvn.test");
    expect(isTunvnConfigured()).toBe(false);
  });
});

describe("TUNVN parsers", () => {
  it("parses upstream product shape and normalises zero discounts to null", () => {
    expect(parseTunvnProduct(product(85))).toMatchObject({
      supplier_product_id: 85, price_vnd: 50_000, price_usdt: 1.96, stock: 7,
      discount_price_vnd: null, discount_price_usdt: null,
    });
    expect(parseTunvnProduct(product(86, { price_usdt: 0 }))).toMatchObject({ price_usdt: null });
    expect(parseTunvnProduct(product(0))).toBeNull();
    expect(parseTunvnProduct(product(87, { name: "  " }))).toBeNull();
    expect(parseTunvnProduct(product(88, { stock: -1 }))).toBeNull();
    expect(parseTunvnProduct("nope")).toBeNull();
  });
});

describe("syncTunvnCatalog (hidden mirror)", () => {
  it("inserts rows always hidden and never touches Market tables", async () => {
    vi.stubGlobal("fetch", productsResponse([product(85), product(69, { price_vnd: 39_000, stock: 62 })]));
    const r = await syncTunvnCatalog(db(), { now: T0 });
    expect(r).toMatchObject({ ok: true, fetched: 2, upserted: 2, invalid: 0, usdt_vnd: 25_494 });
    expect(row(85)).toMatchObject({ name: "Produk 85", price_vnd: 50_000, stock: 7, visible: 0 });
    expect(row(85)!.synced_at).toBe(new Date(T0).toISOString());
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM products").get()).toEqual({ c: 0 });
    expect(fx.sql.prepare("SELECT COUNT(*) c FROM tunvn_products WHERE visible<>0").get()).toEqual({ c: 0 });
  });

  it("preserves an existing visible flag instead of forcing it either way", async () => {
    fx.sql.exec("INSERT INTO tunvn_products(supplier_product_id,name,price_vnd,visible) VALUES(85,'old',1,1)");
    vi.stubGlobal("fetch", productsResponse([product(85, { name: "Baru", price_vnd: 51_000 })]));
    await syncTunvnCatalog(db(), { now: T0 });
    expect(row(85)).toMatchObject({ name: "Baru", price_vnd: 51_000, visible: 1 });
  });

  it("zeroes stock of rows missing from a later full sync without deleting them", async () => {
    vi.stubGlobal("fetch", productsResponse([product(85), product(69)]));
    await syncTunvnCatalog(db(), { now: T0 });
    vi.stubGlobal("fetch", productsResponse([product(85)]));
    const r = await syncTunvnCatalog(db(), { now: T0 + 10 * 60_000 });
    expect(r).toMatchObject({ ok: true, deactivated: 1 });
    expect(row(69)).toMatchObject({ stock: 0, visible: 0 });
  });

  it("throttles inside the 45s minimum interval without refetching and resumes at 45s", async () => {
    const f = productsResponse([product(85)]);
    vi.stubGlobal("fetch", f);
    await syncTunvnCatalog(db(), { now: T0 });
    expect(await syncTunvnCatalog(db(), { now: T0 + 30_000 })).toEqual({ skipped: "throttled" });
    expect(await syncTunvnCatalog(db(), { now: T0 + 44_999 })).toEqual({ skipped: "throttled" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(await syncTunvnCatalog(db(), { now: T0 + 45_000 })).toMatchObject({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("refuses an empty upstream catalog instead of wiping the mirror", async () => {
    vi.stubGlobal("fetch", productsResponse([product(85)]));
    await syncTunvnCatalog(db(), { now: T0 });
    vi.stubGlobal("fetch", productsResponse([]));
    expect(await syncTunvnCatalog(db(), { now: T0 + 10 * 60_000 })).toEqual({ ok: false, error: "empty_tunvn_catalog" });
    expect(row(85)).toMatchObject({ stock: 7 });
  });
  it("rejects a partial malformed catalog without zeroing or updating existing stock", async () => {
    vi.stubGlobal("fetch", productsResponse([product(85),product(69)]));
    await syncTunvnCatalog(db(), { now: T0 });
    vi.stubGlobal("fetch", productsResponse([product(85,{stock:99}),{id:"bad"}]));
    expect(await syncTunvnCatalog(db(), { now:T0+180_000 })).toEqual({ok:false,error:"invalid_tunvn_catalog"});
    expect(row(85)).toMatchObject({stock:7}); expect(row(69)).toMatchObject({stock:7});
  });

  it("classifies 401 as config and never retries, so no key-guessing loop", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 }));
    vi.stubGlobal("fetch", f);
    expect(await syncTunvnCatalog(db(), { now: T0, force: true })).toEqual({ ok: false, error: "products_config", detail: "auth_401" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("TUNVN read-only calls", () => {
  it("sends the key only as a header to the configured base URL", async () => {
    let seenUrl = "";
    let seenKey: string | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      seenUrl = String(url);
      seenKey = new Headers(init?.headers).get("x-api-key");
      return new Response(JSON.stringify({ success: true, user_id: 1, username: "Axvara_support", balance_vnd: 0, balance_usdt: 0.0099, usdt_vnd: 25_494 }), { status: 200 });
    }));
    expect(await fetchTunvnBalance()).toMatchObject({ kind: "ok", username: "Axvara_support", balance_vnd: 0, balance_usdt: 0.0099 });
    expect(seenUrl).toBe("https://tunvn.test/api/balance");
    expect(seenUrl).not.toContain("test-key-not-real");
    expect(seenKey).toBe("test-key-not-real");
  });

  it("does not call the network at all when disabled", async () => {
    vi.stubEnv("TUNVN_ENABLED", "false");
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchTunvnProducts()).toEqual({ kind: "config", reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps malformed success payloads to api_error, not empty data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    expect(await fetchTunvnProducts()).toEqual({ kind: "api_error", detail: "products_shape" });
  });
});
