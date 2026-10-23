// tests/contact-verify.integration.test.ts — Lacak pesanan dan detail akun
// bisa diverifikasi dengan No. WA ATAU email checkout (permintaan owner
// 2026-09-25). Dikunci di D1 nyata: email cocok penuh tanpa beda huruf
// besar/kecil, pesan gagal tetap generik (anti enumerasi), WA lama tetap jalan,
// dan order tanpa email tidak bisa dibuka dengan email apa pun.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct, stubFulfillmentKey } from "./helpers/d1-fixture";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { encryptSecret } from "@/lib/fulfillment/crypto";
import { parseBuyerContact } from "@/lib/order-contact";

let fixture: ReturnType<typeof createD1Fixture>;
const PAID = "AXV-20260925-CONTACT1";
const NO_EMAIL = "AXV-20260925-CONTACT2";

beforeEach(async () => {
  fixture = createD1Fixture();
  stubFulfillmentKey();
  clearRateLimitBucketsForTest();
  vi.stubEnv("PRODUCT_VARIANTS_READ", "false");
  await insertTestProduct(fixture.sql, "manual", 1);
  const insert = fixture.sql.prepare(`INSERT INTO orders
    (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,status,payment_status,sales_channel)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const items = JSON.stringify([{ product_id: 1, variant_id: 1, name: "Canva Pro — Invite 1 Bulan", price: 2000, qty: 1 }]);
  insert.run(PAID, "Rani Putri", "6281234567890", "Rani.Putri@Gmail.com", items, 2000, "qris", "DANA Business", "lunas", "paid", "web");
  insert.run(NO_EMAIL, "Budi", "6281298765432", null, items, 2000, "qris", "DANA Business", "lunas", "paid", "web");
  const sealed = await encryptSecret("Link undangan: https://canva.com/join/ABC");
  for (const code of [PAID, NO_EMAIL]) {
    fixture.sql.prepare(`INSERT INTO fulfillment_items (order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,delivered_message_id,delivered_ciphertext,delivered_iv)
      VALUES (?,0,1,1,1,'shared','web','delivered','item:1',?,?)`).run(code, sealed.ciphertext, sealed.iv);
  }
});
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); clearRateLimitBucketsForTest(); });

const post = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, {
  method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body),
});

describe("POST /api/orders/lookup — kode + No. WA atau email", () => {
  it("email cocok (spasi & huruf besar diabaikan) → ringkasan pesanan", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    const res = await POST(post("/api/orders/lookup", { code: PAID, contact: "  rani.putri@GMAIL.com " }));
    expect(res.status).toBe(200);
    const body = await res.json() as { order: { code: string; credentials_ready: boolean } };
    expect(body.order).toMatchObject({ code: PAID, credentials_ready: true });
  });

  it("email salah / order tanpa email → 404 generik yang sama dengan WA salah", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    const wrongEmail = await POST(post("/api/orders/lookup", { code: PAID, contact: "orang.lain@gmail.com" }));
    const noEmail = await POST(post("/api/orders/lookup", { code: NO_EMAIL, contact: "rani.putri@gmail.com" }));
    const wrongWa = await POST(post("/api/orders/lookup", { code: PAID, contact: "081299999999" }));
    expect([wrongEmail.status, noEmail.status, wrongWa.status]).toEqual([404, 404, 404]);
    const messages = new Set([(await wrongEmail.json()).error, (await noEmail.json()).error, (await wrongWa.json()).error]);
    expect(messages.size).toBe(1);
  });

  it("WA tetap jalan lewat `contact` maupun field lama `wa`; format buruk → 400 jelas", async () => {
    const { POST } = await import("@/app/api/orders/lookup/route");
    expect((await POST(post("/api/orders/lookup", { code: PAID, contact: "0812-3456-7890" }))).status).toBe(200);
    expect((await POST(post("/api/orders/lookup", { code: PAID, wa: "+6281234567890" }))).status).toBe(200);
    const badEmail = await POST(post("/api/orders/lookup", { code: PAID, contact: "rani@gmail" }));
    expect(badEmail.status).toBe(400);
    expect((await badEmail.json()).error).toContain("Format email");
    const empty = await POST(post("/api/orders/lookup", { code: PAID }));
    expect(empty.status).toBe(400);
  });
});

describe("POST /api/orders/[code]/credentials — detail akun dengan WA atau email", () => {
  const ctx = (code: string) => ({ params: Promise.resolve({ code }) });

  it("email checkout membuka detail + menerbitkan token; email lain ditolak", async () => {
    const { POST } = await import("@/app/api/orders/[code]/credentials/route");
    const denied = await POST(post(`/api/orders/${PAID}/credentials`, { contact: "rani.putri@gmail.co" }), ctx(PAID));
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toContain("canva.com");
    const ok = await POST(post(`/api/orders/${PAID}/credentials`, { contact: "RANI.PUTRI@gmail.com" }), ctx(PAID));
    expect(ok.status).toBe(200);
    const body = await ok.json() as { credentials: { details: string }[]; capability_token: string | null };
    expect(body.credentials[0].details).toBe("Link undangan: https://canva.com/join/ABC");
    expect(body.capability_token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("S&K pasca-bayar ikut terkirim sebagai blok terpisah (resolver PDP yang sama)", async () => {
    // S&K varian supplier (wr_terms) disuntik; snapshot kredensial tanpa
    // terms: endpoint memetasinya per item_index lewat resolveCredentialTermsByItem.
    fixture.sql.exec(`INSERT INTO wr_products(wr_product_id,wr_product_name,axvara_product_id) VALUES('prod-t1','Bstation',1)`);
    fixture.sql.exec(`INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,axvara_variant_id,axvara_sell_price,wr_terms,wr_delivery_terms) VALUES('var-t1','prod-t1','Premium 1B',3500,10,1,4500,'Garansi 1 bulan. Dilarang otak-atik billing pembayaran. Hanya login di 1 device saja.','Login dengan email, bukan Google.')`);
    fixture.sql.prepare("UPDATE product_variants SET wr_variant_id='var-t1' WHERE id=1").run();
    const { POST } = await import("@/app/api/orders/[code]/credentials/route");
    const ok = await POST(post(`/api/orders/${PAID}/credentials`, { contact: "RANI.PUTRI@gmail.com" }), ctx(PAID));
    expect(ok.status).toBe(200);
    const body = await ok.json() as { credentials: { details: string; terms?: { sections: { kind: string; items: string[] }[] } | null }[] };
    const termsText = JSON.stringify(body.credentials[0].terms ?? null);
    expect(termsText).toContain("Dilarang otak-atik billing");
    expect(termsText).toContain("Hanya login di 1 device");
    // Kredensial sendiri TIDAK tercampur S&K (tetap bersih untuk disalin).
    expect(body.credentials[0].details).not.toContain("Dilarang");
  });

  it("order tanpa email tidak bisa dibuka dengan email; WA penuh tetap jalan; suffix dan nomor lain ditolak", async () => {
    const { POST } = await import("@/app/api/orders/[code]/credentials/route");
    expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { contact: "budi@gmail.com" }), ctx(NO_EMAIL))).status).toBe(403);
    for (const contact of ["765432", "081211765432", "+6281298765433"]) {
      expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { contact }), ctx(NO_EMAIL))).status).toBe(403);
    }
    expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { contact: "0812 9876 5432" }), ctx(NO_EMAIL))).status).toBe(200);
    expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { wa: "081298765432" }), ctx(NO_EMAIL))).status).toBe(200);
  });

  it("shared product-description instructions also survive after payment through contact and token access", async () => {
    fixture.sql.prepare('UPDATE products SET description=? WHERE id=1').run('Akses produk.\nSyarat & Ketentuan:\n- Jangan bagikan link.\nCara Aktivasi:\n1. Buka link yang diterima.');
    const { POST, GET } = await import("@/app/api/orders/[code]/credentials/route");
    const body = await (await POST(post(`/api/orders/${PAID}/credentials`,{contact:'rani.putri@gmail.com'}),ctx(PAID))).json();
    expect(body.credentials[0].details).toBe('Link undangan: https://canva.com/join/ABC');
    expect(JSON.stringify(body.credentials[0].terms.sections)).toContain('Jangan bagikan link');
    expect(body.credentials[0].terms.activation[0].steps).toContain('Buka link yang diterima.');
    const again = await (await GET(new NextRequest(`http://localhost/api/orders/${PAID}/credentials?token=${body.capability_token}`),ctx(PAID))).json();
    expect(again.credentials[0].terms).toEqual(body.credentials[0].terms);
  });

  it("legacy orders without a variant in items can still read shared instructions using fulfillment identity", async () => {
    fixture.sql.prepare('UPDATE orders SET items=? WHERE code=?').run('[{"product_id":1,"name":"Legacy"}]',PAID);
    fixture.sql.exec("UPDATE product_variants SET admin_terms='- Jangan bagikan link',admin_copy_fingerprint='' WHERE id=1");
    const { POST } = await import("@/app/api/orders/[code]/credentials/route");
    const b=await (await POST(post(`/api/orders/${PAID}/credentials`,{contact:'rani.putri@gmail.com'}),ctx(PAID))).json();
    expect(JSON.stringify(b.credentials[0].terms.sections)).toContain('Jangan bagikan link');
  });
});

describe("parseBuyerContact", () => {
  it("membedakan email dan WA, menolak format buruk", () => {
    expect(parseBuyerContact(" A@B.co ")).toEqual({ kind: "email", value: "a@b.co" });
    expect(parseBuyerContact("0812-3456-7890")).toEqual({ kind: "wa", value: "6281234567890" });
    expect(parseBuyerContact("+62 812 3456 7890")).toEqual({ kind: "wa", value: "6281234567890" });
    for (const bad of ["", "rani@", "@gmail.com", "12345", "0712345678"]) expect(parseBuyerContact(bad)).toBeNull();
  });
});

it("durable credential failures survive isolate buckets but do not lock out another client", async () => {
  const { POST } = await import("@/app/api/orders/[code]/credentials/route");
  const ctx = { params: Promise.resolve({ code: PAID }) };
  for (let attempt=0;attempt<20;attempt++) {
    clearRateLimitBucketsForTest();
    const r=await POST(post(`/api/orders/${PAID}/credentials`,{contact:"wrong@example.test"}),ctx);
    expect(r.status).toBe(attempt===19?429:403);
  }
  clearRateLimitBucketsForTest();
  expect((await POST(post(`/api/orders/${PAID}/credentials`,{contact:"rani.putri@gmail.com"}),ctx)).status).toBe(429);
  const other=post(`/api/orders/${PAID}/credentials`,{contact:"rani.putri@gmail.com"});other.headers.set("cf-connecting-ip","203.0.113.10");
  expect((await POST(other,ctx)).status).toBe(200);
});
