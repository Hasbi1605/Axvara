// @vitest-environment node
// Audit UX S4 — regresi runtime untuk temuan yang diimplementasikan:
// Respons admin urutan terbalik diuji oleh audit-admin-race.behavior.test.tsx.
// (2) stok efektif unique di jalur keranjang (PDP + cart);
// (3) identitas quote product+variant, recovery minimum varian B,
//     composite key stabil, direct-buy URL lama lintas produk;
// (4) rentang tanggal half-open mentah + facet global privat ~60 dtk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestOrder, insertTestProduct } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { GET as listOrders } from "@/app/api/admin/orders/route";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toastMock }));

let fixture: ReturnType<typeof createD1Fixture>;

async function adminHeaders() {
  const session = await createAdminToken("admin@axvara.tech");
  const idle = await createIdleToken(session.sid);
  return { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` };
}

async function fetchOrders(query: string) {
  const response = await listOrders(new NextRequest(`https://axvara.tech/api/admin/orders?${query}`, { headers: await adminHeaders() }));
  const body = await response.json() as {
    orders: { code: string; created_at: string }[]; stats: { total: number };
    counts: { channels: Record<string, number> }; methods: string[];
    pagination: { total: number };
  };
  return { status: response.status, body };
}

beforeEach(async () => {
  fixture = createD1Fixture();
  await insertTestProduct(fixture.sql);
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "7".repeat(64));
  clearRateLimitBucketsForTest();
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("admin orders — rentang tanggal half-open mentah", () => {
  it("batas hari inklusif-penuh: 23:59:59 spasi + T00:00 ISO ikut tercakup, tengah malam berikut tidak", async () => {
    fixture.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,created_at)
      VALUES('AXV-D1','A','6280','[]',1000,'qris','pending','2026-10-20 23:59:59'),
            ('AXV-D2','B','6280','[]',1000,'qris','pending','2026-10-20T00:00:00.000Z'),
            ('AXV-D3','C','6280','[]',1000,'qris','pending','2026-10-21T00:00:00.000Z')`);
    const one = await fetchOrders("date_from=2026-10-20&date_to=2026-10-20&limit=100");
    expect(one.status).toBe(200);
    expect(one.body.orders.map((o) => o.code).sort()).toEqual(["AXV-D1", "AXV-D2"]);
    const span = await fetchOrders("date_from=2026-10-20&date_to=2026-10-21&limit=100");
    expect(span.body.orders.map((o) => o.code).sort()).toEqual(["AXV-D1", "AXV-D2", "AXV-D3"]);
  });

  it("facet global tetap utuh saat daftar tersaring tanggal", async () => {
    insertTestOrder(fixture.sql, "AXV-P1", { status: "pending" });
    const data = await fetchOrders("date_from=2999-01-01&date_to=2999-01-02&limit=8");
    expect(data.body.orders).toEqual([]);
    expect(data.body.stats.total).toBe(0);
    expect(Object.values(data.body.counts.channels).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
  });
});

describe("admin orders — facet privat ~60 detik", () => {
  it("request daftar kedua dalam TTL tidak memindai ulang facet", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_JWT_SECRET", "s4-facet-fixture-secret-not-a-real-key");
    vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
    const store = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (key: Request) => store.get(key.url)?.clone(),
        put: async (key: Request, value: Response) => { store.set(key.url, value.clone()); },
      }),
    });
    insertTestOrder(fixture.sql, "AXV-P1", { status: "pending" });
    const before = fixture.control.queries;
    await fetchOrders("page=1&limit=1");
    const afterFirst = fixture.control.queries;
    expect(afterFirst).toBeGreaterThan(before);
    await fetchOrders("page=1&limit=1");
    const afterSecond = fixture.control.queries;
    // Facet (scan GROUP BY seluruh orders) hanya pada request pertama;
    // request kedua memakai snapshot terenkripsi (list+stats+links tetap jalan).
    expect(afterSecond - afterFirst).toBeLessThan(afterFirst - before);
  });
});

function cartProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-1", name: "Fixture Unique", slug: "fixture-unique", price: 10_000,
    category: "x", stock: 2, isActive: true, ...overrides,
  };
}

describe("keranjang — stok efektif unique + refresh metadata", () => {
  // Zustand persist butuh localStorage; environment node tidak memilikinya
  // (peringatan --localstorage-file). Shim in-memory cukup untuk menguji
  // logika clamp/refresh store tanpa DOM.
  function stubMemoryStorage() {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
      setItem: (k: string, v: string) => { data.set(k, String(v)); },
      removeItem: (k: string) => { data.delete(k); },
      clear: () => data.clear(),
      get length() { return data.size; },
      key: (i: number) => [...data.keys()][i] ?? null,
    });
  }
  async function cartState() {
    stubMemoryStorage();
    const { useCart } = await import("@/stores/cart");
    return useCart;
  }

  it("repeat PDP add memakai stok efektif: stock=2/available=1 terkunci di 1, bukan 2", async () => {
    const useCart = await cartState();
    useCart.setState({ items: [], drawerOpen: false });
    const p = cartProduct({ variantId: 9, fulfillmentMode: "unique", inventoryAvailable: 1 });
    useCart.getState().add(p as never, 1);
    useCart.getState().add(p as never, 1);
    expect(useCart.getState().items[0].qty).toBe(1);
  });

  it("repeat PDP add me-refresh metadata basi lalu clamp ke minimum baru", async () => {
    const useCart = await cartState();
    useCart.setState({ items: [], drawerOpen: false });
    const stale = cartProduct({ variantId: 9, minQty: 1, stock: 10 });
    useCart.getState().add(stale as never, 2);
    expect(useCart.getState().items[0].qty).toBe(2);
    // Katalog terbaru: min naik 3, stok turun 3 — add ulang me-refresh lalu clamp.
    useCart.getState().add(cartProduct({ variantId: 9, minQty: 3, stock: 3 }) as never, 1);
    const item = useCart.getState().items[0] as { minQty?: number; qty: number };
    expect(item.minQty).toBe(3);
    expect(item.qty).toBe(3);
  });

  it("produk sama dua varian tetap dua baris dengan minimum masing-masing", async () => {
    const useCart = await cartState();
    useCart.setState({ items: [], drawerOpen: false });
    useCart.getState().add(cartProduct({ variantId: 1, minQty: 1, stock: 10 }) as never, 1);
    useCart.getState().add(cartProduct({ variantId: 2, minQty: 5, stock: 10 }) as never, 2);
    const items = useCart.getState().items;
    expect(items).toHaveLength(2);
    expect(items.map((i) => [i.variantId, i.qty])).toEqual([[1, 1], [2, 5]]);
  });
});

describe("quote — identitas varian + minimum recovery", () => {
  async function quote(items: unknown[]) {
    const { POST } = await import("@/app/api/checkout/quote/route");
    const res = await POST(new NextRequest("http://localhost/api/checkout/quote", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.77" },
      body: JSON.stringify({ items }),
    }));
    return { status: res.status, body: await res.json() as { ok: boolean; issues?: { type: string; slug?: string; variant_id?: number; min_qty?: number; product_id?: number }[] } };
  }

  beforeEach(() => {
    fixture.sql.exec(`DELETE FROM product_variants; DELETE FROM products;
      INSERT INTO products(id,name,slug,price,stock) VALUES(1,'S4 Prod','s4-prod',10000,100);
      INSERT INTO product_variants(id,product_id,sku,label,price,stock,fulfillment_mode,min_qty) VALUES
        (21,1,'S4-A','Varian A',10000,100,'manual',1),
        (22,1,'S4-B','Varian B',10000,100,'manual',5);
      INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1)`);
  });

  it("dua varian produk sama di bawah minimum masing-masing dilaporkan terpisah dengan identitas terstruktur", async () => {
    const { status, body } = await quote([
      { slug: "s4-prod", variant_id: 21, qty: 1, expected_price: 10000 },
      { slug: "s4-prod", variant_id: 22, qty: 2, expected_price: 10000 },
    ]);
    expect(status).toBe(409);
    expect(body.ok).toBe(false);
    // Varian A (min 1) lolos, varian B (min 5, qty 2) gagal — bukan agregat gabungan.
    expect(body.issues).toHaveLength(1);
    expect(body.issues?.[0]).toMatchObject({ type: "below_minimum", slug: "s4-prod", variant_id: 22, min_qty: 5 });
  });

  it("request product_id-only tanpa slug tetap membawa identitas varian B", async () => {
    const { status, body } = await quote([
      { product_id: 1, variant_id: 21, qty: 1, expected_price: 10000 },
      { product_id: 1, variant_id: 22, qty: 2, expected_price: 10000 },
    ]);
    expect(status).toBe(409);
    expect(body.issues).toHaveLength(1);
    expect(body.issues?.[0]).toMatchObject({ type: "below_minimum", product_id: 1, variant_id: 22, min_qty: 5 });
    expect(body.issues?.[0].slug).toBeUndefined();
  });

  it("quote dua varian penuh lolos tanpa digabung", async () => {
    const { status, body } = await quote([
      { slug: "s4-prod", variant_id: 21, qty: 1, expected_price: 10000 },
      { slug: "s4-prod", variant_id: 22, qty: 5, expected_price: 10000 },
    ]);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("price change membawa variant_id sehingga dua varian tidak bertabrakan", async () => {
    const { POST } = await import("@/app/api/checkout/quote/route");
    const res = await POST(new NextRequest("http://localhost/api/checkout/quote", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.78" },
      body: JSON.stringify({ items: [
        { slug: "s4-prod", variant_id: 21, qty: 1, expected_price: 1 },
        { slug: "s4-prod", variant_id: 22, qty: 5, expected_price: 2 },
      ] }),
    }));
    const body = await res.json() as { ok: boolean; changes?: { product_id: number; variant_id?: number }[] };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.changes?.map((c) => c.variant_id).sort()).toEqual([21, 22]);
  });
});

describe("admin fetch — respons basi tidak menimpa request terbaru", () => {
  it("rowMatchesIssue: issue product_id-only tanpa slug hanya memulihkan varian B", async () => {
    const { rowMatchesIssue } = await import("@/lib/checkout-line-identity");
    const rows = [
      { id: "1", slug: "s4-prod", variantId: 21 },
      { id: "1", slug: "s4-prod", variantId: 22 },
    ];
    const issue = { product_id: 1, variant_id: 22, min_qty: 10, type: "below_minimum" };
    expect(rows.filter((r) => rowMatchesIssue(r, issue)).map((r) => r.variantId)).toEqual([22]);
    // Slug hilang total tetap cocok via variant+product.
    expect(rowMatchesIssue({ id: "1", variantId: 22 }, { product_id: 1, variant_id: 22 })).toBe(true);
    expect(rowMatchesIssue({ id: "2" }, { product_id: 1 })).toBe(false);
    expect(rowMatchesIssue({ id: "1" }, {})).toBe(false);
    // Varian berbeda tidak pernah cocok.
    expect(rowMatchesIssue({ id: "1", slug: "s4-prod", variantId: 21 }, issue)).toBe(false);
  });
});
