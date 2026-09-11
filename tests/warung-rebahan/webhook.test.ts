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
});
