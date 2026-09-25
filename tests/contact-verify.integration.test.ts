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

  it("order tanpa email tidak bisa dibuka dengan email; WA (6 digit terakhir) tetap jalan", async () => {
    const { POST } = await import("@/app/api/orders/[code]/credentials/route");
    expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { contact: "budi@gmail.com" }), ctx(NO_EMAIL))).status).toBe(403);
    expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { contact: "0812 9876 5432" }), ctx(NO_EMAIL))).status).toBe(200);
    expect((await POST(post(`/api/orders/${NO_EMAIL}/credentials`, { wa: "081298765432" }), ctx(NO_EMAIL))).status).toBe(200);
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
