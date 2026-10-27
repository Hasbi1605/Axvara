import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); clearRateLimitBucketsForTest(); });

describe("OWASP request byte boundaries", () => {
  it.each(["orders", "pedia/orders", "pedia/quote", "auth/login", "orders/lookup", "subscribers"])("%s rejects an oversized body before database or authentication work", async (path) => {
    vi.stubEnv("NEXT_PUBLIC_PAYMENTS_MAINTENANCE", "false");
    vi.stubEnv("PEDIA_ENABLED", "true");
    vi.stubEnv("PEDIA_ORDERS_ENABLED", "true");
    clearRateLimitBucketsForTest();
    const handlers: Record<string, () => Promise<{ POST: (request: NextRequest) => Promise<Response> }>> = {
      orders: () => import("@/app/api/orders/route"),
      "pedia/orders": () => import("@/app/api/pedia/orders/route"),
      "pedia/quote": () => import("@/app/api/pedia/quote/route"),
      "auth/login": () => import("@/app/api/auth/login/route"),
      "orders/lookup": () => import("@/app/api/orders/lookup/route"),
      subscribers: () => import("@/app/api/subscribers/route"),
    };
    const { POST } = await handlers[path]();
    const response = await POST(new NextRequest(`https://axvara.test/api/${path}`, {
      method: "POST", body: JSON.stringify({ padding: "x".repeat(33_000) }),
    }));
    expect(response.status).toBe(413);
  });
  it.each([undefined, "1"])("quote body without a trustworthy content-length (%s) is rejected before validation", async (length) => {
    clearRateLimitBucketsForTest();
    const { POST } = await import("@/app/api/checkout/quote/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (length) headers["content-length"] = length;
    const response = await POST(new NextRequest("https://axvara.test/api/checkout/quote", {
      method: "POST", headers, body: JSON.stringify({ items: [], padding: "é".repeat(17_000) }),
    }));
    expect(response.status).toBe(413);
  });

  it("Pedia rewrite retains the same browser security policy as Market", async () => {
    vi.stubEnv("PEDIA_ENABLED", "true");
    const { middleware } = await import("@/middleware");
    const response = await middleware(new NextRequest("https://pedia.axvara.tech/instagram", { headers: { host: "pedia.axvara.tech" } }));
    expect(response.headers.get("x-middleware-rewrite")).toContain("/pedia/instagram");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
  });

  it("cross-origin API writes still return 403 with security headers", async () => {
    const { middleware } = await import("@/middleware");
    const response = await middleware(new NextRequest("https://pedia.axvara.tech/api/orders", {
      method: "POST", headers: { host: "pedia.axvara.tech", origin: "https://untrusted.example" },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});
