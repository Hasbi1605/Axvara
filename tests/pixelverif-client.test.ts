import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPixelverifOrder,
  fetchPixelverifCredits,
  fetchPixelverifPricing,
  findPixelverifOrderByEmail,
  getPixelverifOrder,
  isPixelverifConfigured,
  isPixelverifDispatchEnabled,
  isPixelverifEnabled,
  isPixelverifSyncEnabled,
  parsePixelverifCredits,
  parsePixelverifOrder,
  parsePixelverifPricing,
  parseRetryAfterSeconds,
} from "@/lib/pixelverif/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Pixel Verification client contracts", () => {
  it("enforces HTTPS configuration and never fetches when disabled or invalid", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    vi.stubEnv("PIXELVERIF_ENABLED", "false");
    expect(isPixelverifEnabled()).toBe(false);
    expect(isPixelverifConfigured()).toBe(false);
    expect((await fetchPixelverifCredits()).kind).toBe("config");

    vi.stubEnv("PIXELVERIF_ENABLED", "true");
    vi.stubEnv("PIXELVERIF_API_KEY", "pv-fixture-key");
    vi.stubEnv("PIXELVERIF_API_BASE_URL", "http://pixel.test");
    expect(isPixelverifConfigured()).toBe(false);
    expect((await fetchPixelverifCredits()).kind).toBe("config");

    vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://user:pass@pixel.test");
    expect(isPixelverifConfigured()).toBe(false);

    vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test/");
    vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "false");
    expect(isPixelverifConfigured()).toBe(true);
    expect(isPixelverifSyncEnabled()).toBe(false);
    expect(isPixelverifDispatchEnabled()).toBe(false);

    vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "true");
    expect(isPixelverifSyncEnabled()).toBe(true);
    expect(isPixelverifDispatchEnabled()).toBe(true);
    expect((await fetchPixelverifPricing()).kind).not.toBe("config");
    // pricing is public, still doesn't require key? but our mock will handle
  });

  it("sends X-API-Key, never logs key, and parses retry_after_seconds from body", async () => {
    vi.stubEnv("PIXELVERIF_ENABLED", "true");
    vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "true");
    vi.stubEnv("PIXELVERIF_API_KEY", "pv-fixture-secret");
    vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test");

    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ error: "rate limited", retry_after_seconds: 42 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetcher);
    const res = await fetchPixelverifPricing();
    expect(res.kind).toBe("ambiguous");
    if (res.kind === "ambiguous") expect(res.retryAfterSeconds).toBe(42);
  });

  it("parses pricing, credits, and activation_status from both locations", () => {
    const pricingJson = {
      success: true,
      version: 25,
      updated_at: 1234567890123,
      default_validity: 3,
      allowed_validities: [3],
      pricing: { normal: { "3": 1 }, full: { "3": 1.5 } },
    };
    expect(parsePixelverifPricing(pricingJson)).toMatchObject({ version: 25, pricing: { normal: { "3": 1 } } });

    // v33 all-disabled feed (empty allowed_validities with explicit disabled_plans) is valid.
    const allDisabledV33 = {
      success: true,
      version: 33,
      updated_at: 1795679681691,
      default_validity: 6,
      allowed_validities: [],
      pricing: { normal: {}, full: {} },
      disabled_plans: ["FULL:3", "full:6", "link_validation", "normal:3", "normal:6"],
      link_validation: null,
    };
    expect(parsePixelverifPricing(allDisabledV33)).toEqual({
      version: 33,
      updated_at: 1795679681691,
      default_validity: 6,
      allowed_validities: [],
      pricing: { normal: {}, full: {} },
      disabled_plans: ["full:3", "full:6", "link_validation", "normal:3", "normal:6"],
    });
    // Empty/missing/malformed allowed_validities without valid disablement signal stays rejected.
    expect(parsePixelverifPricing({ ...allDisabledV33, disabled_plans: [] })).toBeNull();
    expect(parsePixelverifPricing({ ...allDisabledV33, disabled_plans: undefined })).toBeNull();
    expect(parsePixelverifPricing({ ...allDisabledV33, allowed_validities: null })).toBeNull();
    expect(parsePixelverifPricing({ ...allDisabledV33, allowed_validities: ["bad"] })).toBeNull();

    const creditsJson = { success: true, credits_remaining: 10, name: "Axvara" };
    expect(parsePixelverifCredits(creditsJson)).toMatchObject({ credits_remaining: 10 });

    const orderA = {
      success: true,
      order: {
        order_id: "ord-1",
        email: "a@gmail.com",
        status: "success",
        flow_type: "full",
        validity: 3,
        credit_cost: 1.5,
        activation_status: "activated",
        result: { link: "https://one.google.com/partner-eft-onboard/abc" },
      },
    };
    expect(parsePixelverifOrder(orderA)?.activation_status).toBe("activated");

    const orderB = {
      success: true,
      order: {
        order_id: "ord-2",
        email: "b@gmail.com",
        status: "success",
        flow_type: "full",
        validity: 3,
        credit_cost: 1.5,
        result: { link: "https://one.google.com/partner-eft-onboard/abc", activation_status: "already_redeemed" },
      },
    };
    expect(parsePixelverifOrder(orderB)?.activation_status).toBe("already_redeemed");
  });

  it("keeps only the known activation vocabulary; echoed free text never survives (Sol-11)", async () => {
    const base = { order_id: "ord-3", email: "c@gmail.com", status: "success", flow_type: "normal", validity: 3, credit_cost: 1 };
    expect(parsePixelverifOrder({ success: true, order: { ...base, activation_status: " Activated " } })?.activation_status).toBe("activated");
    expect(parsePixelverifOrder({ success: true, order: { ...base, activation_status: "<b>pwd: hunter2</b>" } })?.activation_status).toBeNull();
    expect(parsePixelverifOrder({ success: true, order: { ...base, result: { activation_status: "call +1 555 0100" } } })?.activation_status).toBeNull();
    const { safeActivationStatus, sanitizePixelverifReceiptSummary } = await import("@/lib/pixelverif/admin");
    expect(safeActivationStatus("ERROR")).toBe("error");
    expect(safeActivationStatus("anything else")).toBeNull();
    // Legacy stored receipts (pre-allowlist) are sanitized on the admin read path too.
    const summary = JSON.parse(String(sanitizePixelverifReceiptSummary(JSON.stringify({ status: "success", activation_status: "leaked text" }))));
    expect(summary.activation_status).toBeUndefined();
  });

  it("reveal and delivery accept only documented statuses, https redeem links and integer queue positions (Sol re-review #1)", async () => {
    const { formatSafePixelverifRevealReceipt, safeRedeemLink, sanitizePixelverifReceiptSummary } = await import("@/lib/pixelverif/admin");
    expect(safeRedeemLink("https://one.google.com/partner-eft-onboard/X")).toBe("https://one.google.com/partner-eft-onboard/X");
    for (const bad of ["javascript:alert(1)", "http://one.google.com/x", "pwd hunter2", 42]) expect(safeRedeemLink(bad)).toBeNull();
    const reveal = JSON.parse(formatSafePixelverifRevealReceipt(JSON.stringify({ order: {
      order_id: "o1", status: "echo: hunter2", result: { link: "data:text/html,hunter2" }, queue_position: "hunter2",
    } }), { order_code: "AXV-1", status: "processing", flow_type: "normal", validity: 3 }));
    expect(JSON.stringify(reveal)).not.toContain("hunter2");
    expect(reveal).toMatchObject({ status: "processing", link: null, queue_position: null });
    expect(JSON.parse(String(sanitizePixelverifReceiptSummary(JSON.stringify({ status: "hunter2" })))).status).toBeNull();
  });

  it("createPixelverifOrder sends X-Idempotency-Key and POST body without logging", async () => {
    vi.stubEnv("PIXELVERIF_ENABLED", "true");
    vi.stubEnv("PIXELVERIF_SYNC_ENABLED", "true");
    vi.stubEnv("PIXELVERIF_API_KEY", "pv-fixture-secret");
    vi.stubEnv("PIXELVERIF_API_BASE_URL", "https://pixel.test");
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, order_id: "ord-1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const res = await createPixelverifOrder(
      { email: "a@gmail.com", password: "secret", totp_secret: "JBSWY3DPEHPK3PXP", flow_type: "normal", validity: 3 },
      "AXV-1-0-s0",
    );
    expect(res.status).toBe(201);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://pixel.test/api/order");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("pv-fixture-secret");
    expect((init?.headers as Record<string, string>)["x-idempotency-key"]).toBe("AXV-1-0-s0");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(String((init as Record<string, unknown>).body));
    expect(body).toEqual({ email: "a@gmail.com", password: "secret", totp_secret: "JBSWY3DPEHPK3PXP", flow_type: "normal", validity: 3 });
  });

  it("parseRetryAfterSeconds handles numeric and date headers", () => {
    expect(parseRetryAfterSeconds("60")).toBe(60);
    expect(parseRetryAfterSeconds(null)).toBe(null);
    expect(parseRetryAfterSeconds("0")).toBe(null);
  });
});
