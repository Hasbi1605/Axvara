import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { computeSkSignature } from "@/lib/sekalipay/client";
import { bindSkInvoiceByRef, processSkPendingOrders, recoverStaleSkClaims, skRefId } from "@/lib/sekalipay/order";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { createD1Fixture, stubFulfillmentKey } from "../helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearRateLimitBucketsForTest();
});

function setup(status = "claimed", code = "AXV-20261022-STUCK") {
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_AUTO_ORDER_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_API_KEY", "fixture-key");
  vi.stubEnv("SEKALIPAY_WEBHOOK_SECRET", "fixture-secret");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
  vi.stubEnv("CRON_SECRET", "fixture-cron");
  stubFulfillmentKey();
  const fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO products(id,name,slug,price,stock) VALUES(1,'Capcut','capcut',7259,10);
    INSERT INTO product_variants(id,product_id,sku,label,price,stock,sk_variant_id)
      VALUES(1,1,'CAPCUT','7 Hari Private',7259,10,'1095');
    INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock,sk_order_process)
      VALUES('1095','9','Capcut','7 Hari Private',5000,10,'auto')`);
  fx.sql.prepare(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel,paid_at)
    VALUES(?,'Buyer','628','[{"product_id":1,"variant_id":1,"qty":1}]',7259,'qris','lunas','paid','web',datetime('now'))`).run(code);
  fx.sql.prepare(`INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status)
    VALUES(?,0,1,1,1,'manual','web','queued')`).run(code);
  fx.sql.prepare(`INSERT INTO sk_order_links(order_code,sk_variant_id,quantity,sk_cost,status,attempt_count,
    request_sent_at,lease_expires_at,next_attempt_at,idempotency_key)
    VALUES(?,'1095',1,5000,?,1,datetime('now','-5 minutes'),datetime('now','-3 minutes'),datetime('now','-5 minutes'),?)`)
    .run(code, status, skRefId(code, "1095", 1));
  return { fx, code, db: createDatabaseAccess(fx.db) };
}

function completed(code: string) {
  return { invoice: "SK-RECOVERED", ref_id: skRefId(code, "1095", 1), status: "completed",
    items: [{ variant_id: 1095, product_name: "Capcut", variant_name: "7 Hari Private", product_license: "Email: fixture@example.com\nPassword: fixture-pass" }] };
}

async function webhook(code: string, signatureOverride?: string) {
  const { POST } = await import("@/app/api/webhook/sekalipay/route");
  const data = completed(code);
  const signature = signatureOverride ?? await computeSkSignature(data.ref_id, data.invoice, data.status, "fixture-secret");
  return POST(new NextRequest("http://localhost/api/webhook/sekalipay", { method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature },
    body: JSON.stringify({ event: "order.completed", data }),
  }));
}

function expectDelivered(fx: ReturnType<typeof createD1Fixture>) {
  expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get())
    .toMatchObject({ status: "completed", sk_invoice: "SK-RECOVERED" });
  expect(fx.sql.prepare("SELECT status,delivered_ciphertext FROM fulfillment_items").get())
    .toMatchObject({ status: "delivered", delivered_ciphertext: expect.any(String) });
  expect(fx.sql.prepare("SELECT fulfillment_status FROM orders").get()?.fulfillment_status).toBe("delivered");
}

describe("SK sent claim recovery — incident 23 October", () => {
  it.each(["claimed", "submitted", "ordering"])("recovers %s without an invoice using GET ref_id and delivers without a second purchase", async status => {
    const { fx, code } = setup(status);
    try {
      const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).not.toBe("POST");
        return Response.json({ data: completed(code) });
      });
      vi.stubGlobal("fetch", fetch);
      const budget = createBudgetedDatabase(40, 2, fx.db);
      expect(await recoverStaleSkClaims(budget.access)).toBe(1);
      expectDelivered(fx);
      expect(budget.used).toBeLessThanOrEqual(38);
      await recoverStaleSkClaims(createDatabaseAccess(fx.db));
      await processSkPendingOrders(createDatabaseAccess(fx.db), { skipOrphanProbe: true });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(decodeURIComponent(String(fetch.mock.calls[0][0]))).toContain(skRefId(code, "1095", 1));
    } finally { fx.close(); }
  });

  it("the existing lite cron repairs a sent claim and delivers automatically", async () => {
    const { fx, code } = setup();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: completed(code) })));
      const { POST } = await import("@/app/api/cron/lite/route");
      const response = await POST(new NextRequest("http://localhost/api/cron/lite?job=sk_orders", {
        method: "POST", headers: { authorization: "Bearer fixture-cron" },
      }));
      expect(response.status).toBe(200);
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it("recovery delivers the credential email within the existing 40-statement cron budget", async () => {
    const { fx, code } = setup();
    try {
      vi.stubEnv("RESEND_API_KEY", "fixture-email");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@example.com");
      fx.sql.exec("UPDATE orders SET customer_email='buyer@example.com'");
      const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).includes("api.resend.com")) return Response.json({ id: "EMAIL-RECOVERED" });
        expect(init?.method).not.toBe("POST");
        return Response.json({ data: completed(code) });
      });
      vi.stubGlobal("fetch", fetch);
      const budget = createBudgetedDatabase(40, 2, fx.db);
      expect(await recoverStaleSkClaims(budget.access)).toBe(1);
      expectDelivered(fx);
      expect(fx.sql.prepare("SELECT status FROM buyer_notice_log WHERE idempotency_key LIKE 'email:sk-credential:%'").get()?.status).toBe("sent");
      expect(budget.used).toBeLessThanOrEqual(38);
      expect(fetch.mock.calls.filter(([url]) => String(url).includes("api.resend.com"))).toHaveLength(1);
    } finally { fx.close(); }
  });

  it.each(["query", "path", "lookup"])("buyer %s polling recovers a missing invoice immediately without waiting for a lease or cron", async route => {
    const { fx, code } = setup("claimed", "AXV-20261022-11223344");
    try {
      fx.sql.exec("UPDATE orders SET customer_wa='6281234567890'; UPDATE sk_order_links SET lease_expires_at=datetime('now','+2 minutes')");
      const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).not.toBe("POST");
        return Response.json({ data: completed(code) });
      });
      vi.stubGlobal("fetch", fetch);
      const request = new NextRequest(`http://localhost/api/orders?code=${code}`);
      let response: Response;
      if (route === "query") {
        const { GET } = await import("@/app/api/orders/route");
        response = await GET(request);
      } else if (route === "path") {
        const { GET } = await import("@/app/api/orders/[code]/route");
        response = await GET(request, { params: Promise.resolve({ code }) });
      } else {
        const { POST } = await import("@/app/api/orders/lookup/route");
        response = await POST(new NextRequest("http://localhost/api/orders/lookup", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ code, wa: "6281234567890" }) }));
      }
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ order: { credentials_ready: true, fulfillment_status: "delivered" } });
      expectDelivered(fx);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("throttles buyer polling by ref_id and records a processing invoice for the next poll", async () => {
    const { fx, code, db } = setup();
    try {
      const { maybeRefreshSupplierOrder } = await import("@/lib/orders/supplier-refresh");
      const fetch = vi.fn(async () => Response.json({ data: { ...completed(code), status: "processing" } }));
      vi.stubGlobal("fetch", fetch);
      expect(await maybeRefreshSupplierOrder(code, db)).toEqual({ refreshed: false, skipped: false });
      expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get())
        .toMatchObject({ status: "processing", sk_invoice: "SK-RECOVERED" });
      expect(await maybeRefreshSupplierOrder(code, db)).toEqual({ refreshed: false, skipped: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("binds an early completion webhook before the POST response and never regresses completed on the late response", async () => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=0");
      const fetch = vi.fn(async () => {
        expect((await webhook(code)).status).toBe(200);
        expectDelivered(fx);
        return Response.json({ data: { invoice: "SK-RECOVERED", status: "processing" } });
      });
      vi.stubGlobal("fetch", fetch);
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expectDelivered(fx);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((await webhook(code)).status).toBe(200);
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it("a timeout after an early completion webhook does not overwrite delivered status", async () => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=0");
      vi.stubGlobal("fetch", vi.fn(async () => {
        expect((await webhook(code)).status).toBe(200);
        throw new Error("network timeout");
      }));
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it.each([400, 402])("a late HTTP%s cannot fail or block an order already delivered by its webhook", async status => {
    const { fx, code, db } = setup("pending");
    try {
      fx.sql.exec("UPDATE sk_order_links SET request_sent_at=NULL,attempt_count=2");
      vi.stubGlobal("fetch", vi.fn(async () => {
        expect((await webhook(code)).status).toBe(200);
        return Response.json({ message: status === 402 ? "BALANCE_IS_INSUFFICIENT" : "INVALID_ORDER" }, { status });
      }));
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expectDelivered(fx);
    } finally { fx.close(); }
  });

  it("does not attach an invoice from an unsigned webhook or an unrelated/mismatched reference", async () => {
    const { fx, code, db } = setup();
    try {
      expect((await webhook(code, "invalid")).status).toBe(401);
      expect(await bindSkInvoiceByRef(skRefId(code, "1095", 2), "SK-OTHER", db)).toBe(false);
      expect(await bindSkInvoiceByRef("sk:OTHER:1095:1", "SK-OTHER", db)).toBe(false);
      expect(fx.sql.prepare("SELECT sk_invoice,status FROM sk_order_links").get()).toMatchObject({ sk_invoice: null, status: "claimed" });
      expect(await bindSkInvoiceByRef(skRefId(code, "1095", 1), "SK-FIRST", db)).toBe(true);
      expect(await bindSkInvoiceByRef(skRefId(code, "1095", 1), "SK-OTHER", db)).toBe(false);
      expect(fx.sql.prepare("SELECT sk_invoice FROM sk_order_links").get()?.sk_invoice).toBe("SK-FIRST");
    } finally { fx.close(); }
  });

  it("keeps active claims alone and preserves ambiguous failures for read-only recovery", async () => {
    const { fx, db } = setup();
    try {
      const fetch = vi.fn(async () => Response.json({ message: "not found" }, { status: 404 }));
      vi.stubGlobal("fetch", fetch);
      fx.sql.exec("UPDATE sk_order_links SET lease_expires_at=datetime('now','+1 minute')");
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      fx.sql.exec("UPDATE sk_order_links SET lease_expires_at=datetime('now','-1 minute')");
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fx.sql.prepare("SELECT status,attempt_count,sk_invoice FROM sk_order_links").get())
        .toMatchObject({ status: "claimed", attempt_count: 1, sk_invoice: null });
      await processSkPendingOrders(db, { skipOrphanProbe: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("supports legacy links without idempotency_key and unsent claims still return to pending", async () => {
    const { fx, code, db } = setup();
    try {
      fx.sql.exec("UPDATE sk_order_links SET idempotency_key=NULL");
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: completed(code) })));
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expectDelivered(fx);
      fx.sql.exec("UPDATE sk_order_links SET status='claimed',sk_invoice=NULL,request_sent_at=NULL,lease_expires_at=datetime('now','-1 minute')");
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expect(fx.sql.prepare("SELECT status FROM sk_order_links").get()?.status).toBe("pending");
    } finally { fx.close(); }
  });

  it("reconciles a manually handed-over old order without replacing or sending its credentials again", async () => {
    const { fx, code, db } = setup();
    try {
      vi.stubEnv("RESEND_API_KEY", "fixture-email");
      vi.stubEnv("FORWARD_FROM_EMAIL", "noreply@example.com");
      fx.sql.exec(`UPDATE orders SET customer_email='buyer@example.com',fulfillment_status='delivered';
        UPDATE fulfillment_items SET status='delivered',last_error='manual_handover:admin',
          delivered_ciphertext='manual-contents',delivered_iv='manual-iv',delivered_message_id='manual'`);
      const fetch = vi.fn(async () => Response.json({ data: completed(code) }));
      vi.stubGlobal("fetch", fetch);
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expect(fx.sql.prepare("SELECT status,delivered_ciphertext,delivered_message_id FROM fulfillment_items").get())
        .toMatchObject({ status: "delivered", delivered_ciphertext: "manual-contents", delivered_message_id: "manual" });
      expect(fx.sql.prepare("SELECT status FROM sk_order_links").get()?.status).toBe("completed");
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("throttles failed recovery lookups while preserving the original purchase reference", async () => {
    const { fx, code, db } = setup();
    try {
      const fetch = vi.fn(async () => Response.json({ message: "not found" }, { status: 404 }));
      vi.stubGlobal("fetch", fetch);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(await recoverStaleSkClaims(db)).toBe(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      fx.sql.exec("UPDATE sk_order_links SET next_attempt_at=datetime('now','-1 minute')");
      fetch.mockImplementation(async () => Response.json({ data: completed(code) }));
      expect(await recoverStaleSkClaims(db)).toBe(1);
      expectDelivered(fx);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { fx.close(); }
  });

  it("returns a retryable response for a signed webhook whose reference cannot be bound", async () => {
    const { fx } = setup();
    try {
      expect((await webhook("OTHER-ORDER")).status).toBe(500);
      expect(fx.sql.prepare("SELECT status,sk_invoice FROM sk_order_links").get())
        .toMatchObject({ status: "claimed", sk_invoice: null });
    } finally { fx.close(); }
  });
});
