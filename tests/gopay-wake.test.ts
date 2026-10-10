import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GOPAY_POLLER_WAKE_URL, resetGopayWakeForTest, scheduleGopayWake } from "@/lib/payments/gopay-wake";

// 2026-10-10 (insiden 1102): poller GoPay idle 60 dtk; Pages membangunkannya
// saat QR terbit + tombol cek status. Wake best-effort, tidak boleh throw.
describe("scheduleGopayWake", () => {
  beforeEach(() => {
    resetGopayWakeForTest();
    vi.stubEnv("GOPAY_QRIS_ENABLED", "true");
    vi.stubEnv("GOPAY_STATIC_QRIS", "000201010212");
    vi.stubEnv("GOPAY_POLLER_SECRET", "poller-secret");
    vi.stubEnv("GOPAY_POLLER_WAKE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("POST ke URL default dengan x-poller-secret", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await scheduleGopayWake("invoice")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEFAULT_GOPAY_POLLER_WAKE_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-poller-secret"]).toBe("poller-secret");
  });

  it("override URL via GOPAY_POLLER_WAKE_URL", async () => {
    vi.stubEnv("GOPAY_POLLER_WAKE_URL", "https://example.test/wake");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await scheduleGopayWake("web_check");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://example.test/wake");
  });

  it("dedupe per isolate 3 dtk: spam klik = 1 wake", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await scheduleGopayWake("web_check");
    expect(await scheduleGopayWake("web_check")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GoPay tidak terkonfigurasi → tidak memanggil VPS", async () => {
    vi.stubEnv("GOPAY_QRIS_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await scheduleGopayWake("invoice")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("VPS mati / timeout tidak pernah throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(scheduleGopayWake("invoice")).resolves.toBe(true);
  });
});
