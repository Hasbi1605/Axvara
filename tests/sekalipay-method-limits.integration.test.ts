// Batas min/max per kanal gateway + grup merchant (payment_type), tampilan nonaktif, token hanya yang tersedia, dan create menolak kanal di luar batas.
// SEMUA data di sini adalah FIXTURE kontrak yang didokumentasikan (bukan katalog/limit merchant nyata; katalog asli belum terverifikasi: IP belum di-whitelist).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { verifyCheckoutQuoteToken } from "@/lib/auth";
import { gatewayEligibility, listSekalipayCatalog, listSekalipayMethods } from "@/lib/payments/sekalipay-gateway";

const MIN = 10_000;
const MAX = 10_000_000;
const row = (code: string, over: Record<string, unknown> = {}) => ({ payment_code: code, payment_name: `Fixture ${code}`, payment_type: "va", min_amount: MIN, max_amount: MAX, fee_info: { type: "flat", description: "Rp 4.000" }, ...over });
const stubCatalog = (data: unknown[]) => {
  vi.stubEnv("SEKALIPAY_GATEWAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_GATEWAY_API_KEY", `fixture-${crypto.randomUUID()}`);
  vi.stubEnv("SEKALIPAY_GATEWAY_SECRET_KEY", "fixture-secret");
  const fetchMock = vi.fn(async () => Response.json({ status: true, data }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("katalog merchant: batas inklusif dan grup (FIXTURE)", () => {
  it("gatewayEligibility: min-1 below_min, min/min+1/max ok, max+1 above_max", () => {
    expect(gatewayEligibility(MIN - 1, MIN, MAX)).toBe("below_min");
    for (const ok of [MIN, MIN + 1, MAX - 1, MAX]) expect(gatewayEligibility(ok, MIN, MAX)).toBe("ok");
    expect(gatewayEligibility(MAX + 1, MIN, MAX)).toBe("above_max");
  });

  it("katalog tetap memuat kanal di luar batas sebagai nonaktif (tanpa biaya/total), shortfall hanya below_min dan dihitung server", async () => {
    stubCatalog([row("VA1")]);
    const below = (await listSekalipayCatalog(MIN - 1))[0];
    expect(below).toMatchObject({ code: "VA1", available: false, reason: "below_min", shortfall: 1, min: MIN, max: MAX, type: "va" });
    expect("estimatedFee" in below).toBe(false);
    expect("estimatedTotal" in below).toBe(false);
    expect(await listSekalipayMethods(MIN - 1)).toEqual([]); // jalur create/TG tidak pernah melihatnya
    for (const amount of [MIN, MIN + 1, MAX]) {
      expect((await listSekalipayCatalog(amount))[0]).toMatchObject({ available: true, estimatedFee: 4000, estimatedTotal: amount + 4000 });
      expect(await listSekalipayMethods(amount)).toMatchObject([{ code: "VA1", estimatedFee: 4000 }]);
    }
    const above = (await listSekalipayCatalog(MAX + 1))[0];
    expect(above).toMatchObject({ available: false, reason: "above_max", shortfall: null });
    expect("estimatedFee" in above).toBe(false);
    expect(await listSekalipayMethods(MAX + 1)).toEqual([]);
    await expect(listSekalipayCatalog(99)).rejects.toThrow("sekalipay_gateway_invalid_amount"); // validasi jumlah lama tidak berubah
  });

  it("grup dari payment_type asli; tipe hilang = other; tipe tak dikenal, biaya tak dikenal, batas cacat, QRIS tetap disembunyikan", async () => {
    stubCatalog([
      row("A_VA"), row("B_EW", { payment_type: "ewallet" }), row("C_NONE", { payment_type: undefined }), row("D_EMPTY", { payment_type: "" }),
      row("E_CARD", { payment_type: "card" }), row("F_FEE", { fee_info: { type: "flat", description: "mulai Rp 10" } }),
      row("G_MIN", { min_amount: "10000" }), row("H_MAX", { max_amount: 1.5 }), row("I_QRIS", { payment_code: "realtime_qris" }), row("J_BADCODE", { payment_code: "bad code" }),
    ]);
    const catalog = await listSekalipayCatalog(20_000);
    expect(catalog.map((c) => `${c.code}:${c.type}`)).toEqual(["A_VA:va", "B_EW:ewallet", "C_NONE:other", "D_EMPTY:other"]);
  });
});

describe("quote + create dengan batas (FIXTURE)", () => {
  let fixture: ReturnType<typeof createD1Fixture>;
  beforeEach(async () => {
    fixture = createD1Fixture(); await insertTestProduct(fixture.sql);
    fixture.sql.exec("INSERT OR IGNORE INTO payment_methods(id,label,account_number,account_name,is_active,sort_order) VALUES('qris','QRIS','-','AXVARA',1,1); UPDATE payment_methods SET is_active=1 WHERE id='qris'");
    vi.stubEnv("ADMIN_JWT_SECRET", "limits-fixture"); vi.stubEnv("QRIS_ACTIVE_PROVIDER", "klikqris"); vi.stubEnv("KLIKQRIS_ENABLED", "true");
    vi.stubEnv("KLIKQRIS_API_KEY", "fixture"); vi.stubEnv("KLIKQRIS_MERCHANT_ID", "123");
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
    const { clearRateLimitBucketsForTest } = await import("@/lib/rateLimit"); clearRateLimitBucketsForTest();
  });
  afterEach(() => { fixture.close(); });

  const quote = async () => {
    const { POST } = await import("@/app/api/checkout/quote/route");
    return POST(new NextRequest("http://localhost/api/checkout/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ product_id: 1, variant_id: 1, qty: 1 }] }) }));
  };
  const create = async (token: string, method: string) => {
    const { POST } = await import("@/app/api/orders/route");
    return POST(new NextRequest("http://localhost/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer_wa: "081234567890", customer_email: "buyer@example.test", items: [{ product_id: 1, variant_id: 1, qty: 1 }], payment_method: method, quote_token: token }) }));
  };

  it("quote menampilkan nonaktif (limits/alasan/shortfall server, tanpa biaya), urutan tersedia dulu, grup top-level; token hanya memuat yang tersedia dan tanpa grup/limits", async () => {
    // Subtotal fixture = harga produk uji (10.000): VA_OK min 10.000 (inklusif), VA_LOW min 10.001, EW_HIGH max 9.999.
    stubCatalog([row("VA_LOW", { min_amount: 10_001 }), row("EW_HIGH", { payment_type: "ewallet", min_amount: 100, max_amount: 9_999 }), row("VA_OK", { min_amount: 10_000 }), row("OTHER_OK", { payment_type: undefined, min_amount: 100, max_amount: 50_000 })]);
    const res = await quote(); expect(res.status).toBe(200); const data = await res.json();
    const gateways = data.paymentMethods.filter((m: { kind: string }) => m.kind === "gateway");
    expect(gateways.map((m: { id: string; available: boolean }) => `${m.id.split(":")[1]}:${m.available}`)).toEqual(["VA_OK:true", "OTHER_OK:true", "VA_LOW:false", "EW_HIGH:false"]);
    const byCode = (code: string) => gateways.find((m: { id: string }) => m.id.endsWith(code));
    expect(byCode("VA_OK")).toMatchObject({ group: "va", limits: { min: 10_000, max: MAX }, gateway: { estimated_fee: 4000, estimated_total: 14_000, idr_subtotal: 10_000 } });
    expect(byCode("OTHER_OK")).toMatchObject({ group: "other", available: true });
    expect(byCode("VA_LOW")).toMatchObject({ available: false, group: "va", limits: { min: 10_001 }, unavailable_reason: "below_min", shortfall: 1, gateway: { channel: "VA_LOW", idr_subtotal: 10_000 } });
    expect(byCode("EW_HIGH")).toMatchObject({ available: false, group: "ewallet", unavailable_reason: "above_max" });
    expect("shortfall" in byCode("EW_HIGH")).toBe(false);
    for (const code of ["VA_LOW", "EW_HIGH"]) { const m = byCode(code); expect(m.gateway.estimated_fee).toBeUndefined(); expect(m.gateway.estimated_total).toBeUndefined(); }
    const signed = (await verifyCheckoutQuoteToken(data.quoteToken))!.payment_methods;
    expect(signed.map((m) => m.id)).toEqual(["qris", "ewallet", "seabank", "sekalipay_gateway:VA_OK", "sekalipay_gateway:OTHER_OK"].filter((id) => signed.some((m) => m.id === id)));
    expect(signed.some((m) => m.id.endsWith("VA_LOW") || m.id.endsWith("EW_HIGH"))).toBe(false);
    for (const m of signed) { expect(m).not.toHaveProperty("group"); expect(m).not.toHaveProperty("limits"); expect(m).not.toHaveProperty("unavailable_reason"); expect(m).not.toHaveProperty("shortfall"); }
  });

  it("buildMethodOptions (TG + token) tidak pernah memuat nonaktif; buildMethodCatalog memuatnya", async () => {
    stubCatalog([row("VA_LOW", { min_amount: 10_001 }), row("VA_OK", { min_amount: 10_000 })]);
    const { buildMethodOptions, buildMethodCatalog } = await import("@/lib/payments/method-options");
    const options = await buildMethodOptions(10_000);
    expect(options.filter((m) => m.kind === "gateway").map((m) => m.id)).toEqual(["sekalipay_gateway:VA_OK"]);
    expect(options.every((m) => m.available === true)).toBe(true);
    const catalog = await buildMethodCatalog(10_000);
    expect(catalog.filter((m) => m.kind === "gateway").map((m) => `${m.id}:${m.available}`)).toEqual(["sekalipay_gateway:VA_OK:true", "sekalipay_gateway:VA_LOW:false"]);
  });

  it("create menolak ID nonaktif walau body dipalsukan: tidak ada pesanan, stok utuh, tidak ada panggilan invoice", async () => {
    const fetchMock = stubCatalog([row("VA_LOW", { min_amount: 10_001 }), row("EW_HIGH", { payment_type: "ewallet", min_amount: 100, max_amount: 9_999 })]);
    const data = await (await quote()).json();
    for (const id of ["sekalipay_gateway:VA_LOW", "sekalipay_gateway:EW_HIGH"]) {
      const res = await create(data.quoteToken, id);
      expect(res.status).toBe(409); // tidak ada di token bertanda tangan
    }
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
    expect(fixture.sql.prepare("SELECT COUNT(*) n FROM payment_transactions").get()?.n).toBe(0);
    expect((fetchMock.mock.calls as unknown as Array<[string]>).every(([url]) => String(url).endsWith("payment-methods"))).toBe(true);
  });

  it("create memvalidasi ulang batas LIVE: kanal yang batasnya bergeser (stale quote) ditolak 503 sebelum membuat pesanan; inklusif di min/max", async () => {
    const { createCheckoutQuoteToken } = await import("@/lib/auth");
    const signedAt = async (subtotal: number) => (await createCheckoutQuoteToken({
      items: [{ product_id: 1, variant_id: 1, price: subtotal, qty: 1, name: "Fixture" }], subtotal,
      payment_methods: [{ id: "sekalipay_gateway:BOUND", kind: "gateway", account_number: "", currency: "IDR", gateway: { channel: "BOUND", estimated_fee: 4000, estimated_total: subtotal + 4000, idr_subtotal: subtotal } }],
    })).token;
    const token = await signedAt(10_000);
    // Quote lama; live: min naik 1 di atas total (min+1 > total) atau max turun 1 di bawah total => tidak tersedia.
    for (const [min, max] of [[10_001, MAX], [100, 9_999]]) {
      stubCatalog([row("BOUND", { min_amount: min, max_amount: max })]);
      const res = await create(token, "sekalipay_gateway:BOUND");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("Metode pembayaran tidak tersedia.");
      expect(fixture.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
      vi.stubEnv("ADMIN_JWT_SECRET", "limits-fixture"); vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
    }
    // Tepat di batas (min == total, max == total): lolos validasi kelayakan (bukan penolakan "tidak tersedia").
    for (const [min, max] of [[10_000, MAX], [100, 10_000]]) {
      stubCatalog([row("BOUND", { min_amount: min, max_amount: max })]);
      const res = await create(token, "sekalipay_gateway:BOUND");
      expect((await res.json().catch(() => ({}))).error).not.toBe("Metode pembayaran tidak tersedia.");
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
      vi.stubEnv("ADMIN_JWT_SECRET", "limits-fixture"); vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
      fixture.sql.exec("DELETE FROM payment_transactions; DELETE FROM orders");
    }
  });
});
