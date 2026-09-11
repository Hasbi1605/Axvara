import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyWrError,
  getWrBaseUrl,
  isWrAutoOrderEnabled,
  isWrEnabled,
  isWrSandbox,
  isWrSyncEnabled,
  verifyWebhookSignature,
  WrApiError,
  WrInsufficientBalanceError,
  WrNetworkError,
  WrOutOfStockError,
} from "@/lib/warung-rebahan/client";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Warung Rebahan feature flags", () => {
  it("master switch mematikan segalanya walau sub-flag aktif", () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "false");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "true");
    expect(isWrEnabled()).toBe(false);
    expect(isWrSyncEnabled()).toBe(false);
    expect(isWrAutoOrderEnabled()).toBe(false);
  });

  it("sync default aktif saat master on, auto-order default mati", () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_SYNC_ENABLED", "");
    vi.stubEnv("WARUNG_REBAHAN_AUTO_ORDER_ENABLED", "");
    expect(isWrEnabled()).toBe(true);
    expect(isWrSyncEnabled()).toBe(true);
    expect(isWrAutoOrderEnabled()).toBe(false);
  });

  it("sandbox hanya aktif bila eksplisit true", () => {
    vi.stubEnv("WARUNG_REBAHAN_SANDBOX", "");
    expect(isWrSandbox()).toBe(false);
    vi.stubEnv("WARUNG_REBAHAN_SANDBOX", "true");
    expect(isWrSandbox()).toBe(true);
  });

  it("base URL default dan trim trailing slash", () => {
    vi.stubEnv("WARUNG_REBAHAN_BASE_URL", "");
    expect(getWrBaseUrl()).toBe("https://warungrebahan.com/api/v1");
    vi.stubEnv("WARUNG_REBAHAN_BASE_URL", "https://warungrebahan.com/api/v1///");
    expect(getWrBaseUrl()).toBe("https://warungrebahan.com/api/v1");
  });
});

describe("Warung Rebahan error classification", () => {
  it("saldo tidak cukup menjadi WrInsufficientBalanceError", () => {
    const err = classifyWrError("Saldo tidak mencukupi", 400, "/order");
    expect(err).toBeInstanceOf(WrInsufficientBalanceError);
    expect(err).toBeInstanceOf(WrApiError);
  });

  it("stok habis menjadi WrOutOfStockError", () => {
    const err = classifyWrError("Stok produk habis", 400, "/order");
    expect(err).toBeInstanceOf(WrOutOfStockError);
  });

  it("error lain menjadi WrApiError biasa", () => {
    const err = classifyWrError("Variant tidak ditemukan", 404, "/order");
    expect(err).toBeInstanceOf(WrApiError);
    expect(err).not.toBeInstanceOf(WrInsufficientBalanceError);
    expect(err).not.toBeInstanceOf(WrOutOfStockError);
    expect(err.status).toBe(404);
  });
});

describe("Warung Rebahan API client fetch", () => {
  it("mengirim api_key dan mengembalikan data saat success", async () => {
    vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "test-key");
    let seenBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        seenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            success: true,
            message: "ok",
            data: { balance: 245000, currency: "IDR" },
          }),
        };
      }),
    );
    const { fetchBalance } = await import("@/lib/warung-rebahan/client");
    const balance = await fetchBalance();
    expect(balance).toEqual({ balance: 245000, currency: "IDR" });
    expect(seenBody.api_key).toBe("test-key");
  });

  it("success=false melempar WrApiError", async () => {
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: false, message: "API key salah", data: null }),
      })),
    );
    const { fetchBalance } = await import("@/lib/warung-rebahan/client");
    await expect(fetchBalance()).rejects.toBeInstanceOf(WrApiError);
  });

  it("mode proxy: ke /wr/* + token, tanpa api_key asli", async () => {
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "");
    vi.stubEnv(
      "WARUNG_REBAHAN_PROXY_URL",
      "https://axvara-wa-gateway-82ca358cd56f.herokuapp.com/",
    );
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "proxy-secret");
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenHeaders = (init.headers ?? {}) as Record<string, string>;
        seenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return {
          ok: true,
          json: async () => ({
            success: true,
            message: "ok",
            data: { balance: 100000, currency: "IDR" },
          }),
        };
      }),
    );
    const { fetchBalance } = await import("@/lib/warung-rebahan/client");
    expect(await fetchBalance()).toEqual({ balance: 100000, currency: "IDR" });
    expect(seenUrl).toBe(
      "https://axvara-wa-gateway-82ca358cd56f.herokuapp.com/wr/balance",
    );
    expect(seenHeaders["x-proxy-token"]).toBe("proxy-secret");
    expect("api_key" in seenBody).toBe(false);
  });

  it("mode proxy tanpa token melempar sebelum fetch", async () => {
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.example");
    vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchBalance } = await import("@/lib/warung-rebahan/client");
    await expect(fetchBalance()).rejects.toThrow("WARUNG_REBAHAN_PROXY_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("menolak host di luar warungrebahan.com (SSRF-safe)", async () => {
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    vi.stubEnv("WARUNG_REBAHAN_BASE_URL", "https://evil.example/api");
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchBalance } = await import("@/lib/warung-rebahan/client");
    await expect(fetchBalance()).rejects.toBeInstanceOf(WrNetworkError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("timeout dibungkus menjadi WrNetworkError", async () => {
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "k");
    vi.stubEnv("WARUNG_REBAHAN_BASE_URL", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const { fetchProducts } = await import("@/lib/warung-rebahan/client");
    await expect(fetchProducts()).rejects.toBeInstanceOf(WrNetworkError);
  });
});

describe("Warung Rebahan webhook signature", () => {
  it("menerima HMAC-SHA256 yang valid dan menolak yang salah", async () => {
    vi.stubEnv("WARUNG_REBAHAN_API_KEY", "webhook-secret-sama");
    vi.stubEnv("WARUNG_REBAHAN_WEBHOOK_SECRET", "webhook-secret-sama");
    const raw = JSON.stringify({ event: "order.completed", data: { order_id: "ORD-1" } });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("webhook-secret-sama"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(await verifyWebhookSignature(raw, hex)).toBe(true);
    expect(await verifyWebhookSignature(raw, `sha256=${hex}`)).toBe(true);
    expect(await verifyWebhookSignature(raw, "00".repeat(32))).toBe(false);
    expect(await verifyWebhookSignature(raw, "bukan-hex")).toBe(false);
  });
});
