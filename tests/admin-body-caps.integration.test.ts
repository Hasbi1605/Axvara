import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createD1Fixture, stubFulfillmentKey } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { POST as proofsReview } from "@/app/api/admin/proofs/[id]/route";
import { PUT as pediaSettings } from "@/app/api/admin/pedia/settings/route";
import { POST as supplierLinks } from "@/app/api/admin/supplier-links/route";
import { POST as paymentEvents } from "@/app/api/admin/payments/events/route";
import { POST as warungMarkupBulk } from "@/app/api/admin/warung/markup/bulk/route";
import { PUT as saveVariantCopy } from "@/app/api/admin/variant-copy/route";
import { POST as fulfillment } from "@/app/api/admin/fulfillment/route";
import { POST as createProduct } from "@/app/api/products/route";
import { PUT as updateProduct } from "@/app/api/products/[id]/route";
import { POST as createArticle } from "@/app/api/articles/route";
import { PUT as storeSettings } from "@/app/api/store-settings/route";

// AU-B1-3 — every authenticated admin mutation route must read its JSON body
// through the bounded reader (readJsonBody / readTextBody), never a bare
// `req.json()`. A static scan keeps the policy enforced as routes are added.

const API_DIR = path.join(process.cwd(), "src/app/api");
// Multipart uploads use their own validation; public/webhook routes use their
// own documented caps and are not selected by the privileged-route guard.
const uploads = new Set(["upload/route.ts", "agent/media/route.ts"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const routes = walk(API_DIR).map((file) => ({
  route: path.relative(API_DIR, file),
  source: fs.readFileSync(file, "utf8"),
})).filter(({ route, source }) => !uploads.has(route) && (
  route.startsWith("admin/") || /\b(?:requireAdmin(?:Detailed)?|checkAdminSession|requireAgent)\b/.test(source)
));

describe("AU-B1-3 static guard — admin routes use the bounded JSON reader", () => {
  it("scans the whole admin API surface", () => {
    expect(routes.filter(({ route }) => route.startsWith("admin/")).length).toBeGreaterThan(50);
    expect(routes.map(({ route }) => route)).toEqual(expect.arrayContaining([
      "products/route.ts", "products/[id]/route.ts", "articles/route.ts", "articles/[id]/route.ts",
      "banners/route.ts", "categories/route.ts", "store-settings/route.ts", "payment-methods/route.ts",
    ]));
  });

  it("does not allow direct request body reads in privileged routes", () => {
    const directRead = /\b(?:req|request)\s*(?:\?\.|\.)\s*(?:json|text|arrayBuffer|formData|blob|bytes)\s*\(/;
    const offenders = routes.filter(({ source }) => directRead.test(source)).map(({ route }) => route);
    expect(offenders).toEqual([]);
  });
});

// One behavior probe per cap class: an authenticated caller sending an oversize
// body is rejected by the streamed bound BEFORE the Zod parse, with the
// canonical 413 error shape (no reliance on Content-Length).
describe("AU-B1-3 behavior — oversize bodies return 413 with the existing error shape", () => {
  let fx: ReturnType<typeof createD1Fixture>;
  let cookie: string;

  beforeEach(async () => {
    fx = createD1Fixture();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_JWT_SECRET", "fx6-body-cap-fixture-secret");
    vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
    clearRateLimitBucketsForTest();
    const session = await createAdminToken("admin@example.test");
    const idle = await createIdleToken(session.sid);
    cookie = `axvara_admin_token=${session.token}; axvara_idle=${idle}`;
  });
  afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const req = (url: string, body: string, method = "POST") => new NextRequest(url, {
    method, headers: { "content-type": "application/json", cookie }, body,
  });

  const cases: { name: string; cap: number; call: (r: NextRequest) => Promise<Response> }[] = [
    { name: "proofs review (8 KB)", cap: 8_000, call: (r) => proofsReview(r, { params: Promise.resolve({ id: "1" }) }) },
    { name: "pedia settings (2 KB)", cap: 2_000, call: (r) => pediaSettings(r) },
    { name: "supplier-links create (8 KB)", cap: 8_000, call: (r) => supplierLinks(r) },
    { name: "payments events (8 KB)", cap: 8_000, call: (r) => paymentEvents(r) },
    { name: "warung markup bulk (64 KB)", cap: 64_000, call: (r) => warungMarkupBulk(r) },
    { name: "product creation (512 KB)", cap: 512_000, call: createProduct },
    { name: "product update (512 KB)", cap: 512_000, call: (r) => updateProduct(r, { params: Promise.resolve({ id: "1" }) }) },
    { name: "article creation (512 KB)", cap: 512_000, call: createArticle },
    { name: "store settings (8 KB)", cap: 8_000, call: storeSettings },
    { name: "variant copy (128 KB)", cap: 128_000, call: saveVariantCopy },
    { name: "fulfillment import (1 MB)", cap: 1_000_000, call: fulfillment },
  ];

  it.each(cases)("$name rejects an oversize body with 413", async ({ cap, call }) => {
    const oversize = JSON.stringify({ pad: "x".repeat(cap + 1_000) });
    const request = req("https://axvara.test/api/admin/fixture", oversize);
    expect(request.headers.has("Content-Length")).toBe(false);
    const res = await call(request);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("an under-cap malformed body is rejected as 400, not 413", async () => {
    const res = await proofsReview(req("https://axvara.test/api/admin/proofs/1", "{not-json"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    expect((await createProduct(req("https://axvara.test/api/products", "{not-json"))).status).toBe(400);
  });

  it("rejects unauthenticated product creation before consuming the body", async () => {
    const request = new NextRequest("https://axvara.test/api/products", {
      method: "POST", body: JSON.stringify({ name: "Fixture product", slug: "fx6b-unauthenticated" }),
    });
    expect((await createProduct(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(fx.sql.prepare("SELECT id FROM products WHERE slug=?").get("fx6b-unauthenticated")).toBeUndefined();
  });

  it("accepts full-length multibyte article content and source links", async () => {
    const body = JSON.stringify({ title: "Fixture article", content: "界".repeat(50_000), source_urls: ["https://example.test/"] });
    expect(Buffer.byteLength(body)).toBeGreaterThan(128_000);
    const res = await createArticle(req("https://axvara.test/api/articles", body));
    expect(res.status).toBe(201);
  });

  it("accepts four 4,000-character multibyte variant-copy fields with JSON Unicode escapes", async () => {
    fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Fixture','fx6b-copy',1000,1);
      INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'FX6B','Fixture',1000,1);`);
    const text = "界".repeat(4_000);
    // Unescaped BMP text uses at most 3 bytes per JS code unit. Escaping the
    // same characters is valid JSON and takes 6 bytes each on the wire.
    const body = JSON.stringify({ variant_id: 1, supplier_key: "", terms: text, activation: text, terms_en: text, activation_en: text })
      .replaceAll("界", "\\u754c");
    expect(Buffer.byteLength(body)).toBeGreaterThan(64_000);
    const res = await saveVariantCopy(req("https://axvara.test/api/admin/variant-copy", body, "PUT"));
    expect(res.status).toBe(200);
    expect(fx.sql.prepare("SELECT admin_terms,admin_activation,admin_terms_en,admin_activation_en FROM product_variants WHERE id=1").get())
      .toEqual({ admin_terms: text, admin_activation: text, admin_terms_en: text, admin_activation_en: text });
  });

  it("imports 100 distinct 2,000-character multibyte secrets", async () => {
    stubFulfillmentKey();
    fx.sql.exec("INSERT INTO products(id,name,slug,price,stock,fulfillment_mode) VALUES(1,'Fixture','fx6b-inventory',1000,0,'unique')");
    const secrets = Array.from({ length: 100 }, (_, i) => "界".repeat(1997) + String(i).padStart(3, "0"));
    const body = JSON.stringify({ action: "import", product_id: 1, secrets });
    expect(Buffer.byteLength(body)).toBeGreaterThan(512_000);
    const res = await fulfillment(req("https://axvara.test/api/admin/fulfillment", body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 100, duplicate: 0, invalid: 0 });
  });
});
