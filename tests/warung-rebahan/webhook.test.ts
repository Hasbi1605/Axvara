import { describe, expect, it, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function signedBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function webhookRequest(body: string, signature: string) {
  return new Request("http://localhost/api/webhook/warung", {
    method: "POST",
    headers: { "content-type": "application/json", "x-rebahan-signature": signature },
    body,
  });
}

describe("POST /api/webhook/warung", () => {
  it("503 bila master switch mati", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
    const { POST } = await import("@/app/api/webhook/warung/route");
    const res = await POST(webhookRequest("{}", "x") as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(503);
  });

  it("401 bila signature salah", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "rahasia");
    vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "rahasia");
    const { POST } = await import("@/app/api/webhook/warung/route");
    const res = await POST(
      webhookRequest(JSON.stringify({ event: "order.completed", data: { order_id: "ORD-1" } }), "00".repeat(32)) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(401);
  });

  it("400 bila payload tidak valid walau signature benar", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
    vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
    const body = JSON.stringify({ event: "order.completed", data: {} });
    const sig = await signedBody("s", body);
    const { POST } = await import("@/app/api/webhook/warung/route");
    const res = await POST(webhookRequest(body, sig) as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it("415 bila content-type bukan JSON", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    const { POST } = await import("@/app/api/webhook/warung/route");
    const res = await POST(
      new Request("http://localhost/api/webhook/warung", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "halo",
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(415);
  });

  it("200 + monotonik: completed lalu failed replay tetap completed", async () => {
    const { createD1Fixture, stubFulfillmentKey } = await import("../helpers/d1-fixture");
    const fx = createD1Fixture();
    try {
      stubFulfillmentKey();
      fx.sql.prepare("INSERT INTO products(id,name,slug,price,stock) VALUES(1,'P','p-wh',100,10)").run();
      fx.sql.prepare("INSERT INTO product_variants(id,product_id,sku,label,price,stock) VALUES(1,1,'S','V',100,10)").run();
      fx.sql.prepare("INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,sales_channel) VALUES('AXV-20260913-WH01','B','628','[]',100,'qris','lunas','paid','web')").run();
      fx.sql.prepare("INSERT INTO fulfillment_items(order_code,item_index,product_id,variant_id,qty,fulfillment_mode,recipient_channel,status,attempt_count) VALUES('AXV-20260913-WH01',0,1,1,1,'manual','web','queued',0)").run();
      fx.sql.prepare("INSERT INTO wr_order_links(order_code,wr_order_id,wr_variant_id,quantity,wr_cost,status) VALUES('AXV-20260913-WH01','ORD-WH-1','var-1',1,5000,'processing')").run();
      vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_API_KEY", "s");
      vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "s");
      const { POST } = await import("@/app/api/webhook/warung/route");
      const completedBody = JSON.stringify({ event: "order.completed", data: { order_id: "ORD-WH-1", account_details: [{ email: "a@b.c" }] } });
      const res1 = await POST(webhookRequest(completedBody, await signedBody("s", completedBody)) as unknown as Parameters<typeof POST>[0]);
      expect(res1.status).toBe(200);
      // Replay failed yang terlambat: tetap 200, status tidak regresi.
      const failedBody = JSON.stringify({ event: "order.failed", data: { order_id: "ORD-WH-1", status: "failed" } });
      const res2 = await POST(webhookRequest(failedBody, await signedBody("s", failedBody)) as unknown as Parameters<typeof POST>[0]);
      expect(res2.status).toBe(200);
      const link = fx.sql.prepare("SELECT status FROM wr_order_links WHERE wr_order_id='ORD-WH-1'").get() as { status: string };
      expect(link.status).toBe("completed");
      // Regresi yang diblokir tercatat di event log (observable).
      const blocked = fx.sql.prepare("SELECT COUNT(*) n FROM wr_webhook_events WHERE applied=0").get() as { n: number };
      expect(Number(blocked.n)).toBeGreaterThan(0);
    } finally {
      fx.close();
    }
  });
});
