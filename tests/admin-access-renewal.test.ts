import { afterEach, expect, it, vi } from "vitest";
import { fetchAdminAuth } from "@/lib/admin-auth-fetch";

afterEach(() => vi.unstubAllGlobals());
it("renews Access through a full navigation on edge redirect or origin access_required", async () => {
  const assign = vi.fn(); vi.stubGlobal("window", { location: { assign } });
  for (const response of [{ type: "opaqueredirect" }, new Response("{}", {
    status: 401, headers: { "X-AXVARA-Admin-Access": "access_required" },
  })]) {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(fetchAdminAuth("/api/auth/me")).rejects.toThrow("Cloudflare Access");
  }
  expect(assign.mock.calls).toEqual([["/admin"], ["/admin"]]);
});
it("does not redirect or discard app-session errors or transient service failures", async () => {
  const assign = vi.fn(); vi.stubGlobal("window", { location: { assign } });
  for (const status of [200, 401, 503]) {
    const response = new Response("{}", { status });
    const fetchMock = vi.fn(async () => response); vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAdminAuth("/api/auth/refresh", { method: "POST" })).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/refresh", { method: "POST", redirect: "manual" });
  }
  expect(assign).not.toHaveBeenCalled();
});
