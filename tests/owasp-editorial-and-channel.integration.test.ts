import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture, insertTestProduct } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { createChannelOrderAtomic, createPendingChannelOrder } from "@/lib/commerce";
import { getActiveVariant } from "@/lib/catalog";

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(async () => {
  fx = createD1Fixture();
  vi.stubEnv("ADMIN_EMAIL", "private-admin@example.test");
  vi.stubEnv("ADMIN_JWT_SECRET", "editorial-local-fixture");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "c".repeat(64));
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No external calls"); }));
  await insertTestProduct(fx.sql, "manual", 1);
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("public article responses omit editorial metadata and admin emails; admin retains private editing fields", async () => {
  fx.sql.exec(`INSERT INTO articles(id,slug,title,content,status,author_type,author_name,reviewed_by,idempotency_key,scheduled_at)
    VALUES(1,'fixture','Fixture article','Published body','published','admin','private-admin@example.test','private-admin@example.test','PRIVATE-IDEMPOTENCY','2099-01-01'),
    (2,'private-draft','PRIVATE-DRAFT','Private body','draft','admin','private-admin@example.test',NULL,NULL,NULL)`);
  const collection = await import("@/app/api/articles/route"), detail = await import("@/app/api/articles/[id]/route");
  const response = await collection.GET(new NextRequest("https://axvara.test/api/articles"));
  const publicList = await response.json();
  expect(publicList.articles).toHaveLength(1);
  expect(publicList.articles[0]).not.toHaveProperty("content");
  const publicDetail = await detail.GET(new NextRequest("https://axvara.test/api/articles/fixture"), { params: Promise.resolve({ id: "fixture" }) });
  const body = await publicDetail.json();
  expect(body.article).toMatchObject({ content: "Published body", author_name: "AXVARA" });
  for (const field of ["reviewed_by", "reviewed_at", "scheduled_at", "idempotency_key", "author_type"]) expect(body.article).not.toHaveProperty(field);
  expect(JSON.stringify([body, publicList])).not.toMatch(/PRIVATE|private-admin/);
  const session = await createAdminToken("private-admin@example.test"), idle = await createIdleToken(session.sid);
  const headers = { cookie: `axvara_admin_token=${session.token}; axvara_idle=${idle}` };
  const adminDetail = await detail.GET(new NextRequest("https://axvara.test/api/articles/fixture", { headers }), { params: Promise.resolve({ id: "fixture" }) });
  expect(adminDetail.headers.get("cache-control")).toContain("private");
  expect((await adminDetail.json()).article).toMatchObject({ reviewed_by: "private-admin@example.test", idempotency_key: "PRIVATE-IDEMPOTENCY" });
  const adminList = await collection.GET(new NextRequest("https://axvara.test/api/articles?all=1", { headers }));
  expect((await adminList.json()).articles).toHaveLength(2);
});

it.each(["price", "parent-inactive", "reparented"])("Telegram atomic guard rejects %s without changing stock/order", async (scenario) => {
  if (scenario === "price") fx.sql.exec("UPDATE product_variants SET price=15000");
  if (scenario === "parent-inactive") fx.sql.exec("UPDATE products SET is_active=0");
  if (scenario === "reparented") fx.sql.exec("INSERT INTO products(id,name,slug,price) VALUES(2,'Other','other',10000); UPDATE product_variants SET product_id=2");
  await expect(createChannelOrderAtomic({
    orderCode: "AXV-20261027-CHANNEL1", lines: [{ productId: 1, variantId: 1, qty: 1, stock: 100, fulfillmentMode: "manual" }],
    items: [{ product_id: 1, variant_id: 1, price: 10000, qty: 1, name: "Fixture" }],
    variantSnapshot: "{}", subtotal: 10000, primaryVariantId: 1, customerName: "Fixture", salesChannel: "telegram",
    telegramChatId: "fixture-chat", paymentMethod: "qris", paymentAccount: "Fixture", fulfillmentStatus: "not_required",
  })).rejects.toThrow();
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
});

it("Legacy creator guard refuses an inactive parent despite an active matching variant", async () => {
  const variant = await getActiveVariant(1);
  expect(variant).not.toBeNull();
  fx.sql.exec("UPDATE products SET is_active=0");
  await expect(createPendingChannelOrder({
    salesChannel: "web", productId: 1, productName: "Fixture", variantId: 1, variant: variant!,
    customerId: "fixture-member", customerName: "Fixture", customerWa: "6281234567890", conversationId: "fixture-group",
    idempotencyKey: "fixture-wa-admission", paymentMethod: "qris", paymentAccount: "Fixture",
  })).rejects.toThrow();
  expect(fx.sql.prepare("SELECT COUNT(*) n FROM orders").get()?.n).toBe(0);
  expect(fx.sql.prepare("SELECT stock FROM product_variants WHERE id=1").get()?.stock).toBe(100);
});
