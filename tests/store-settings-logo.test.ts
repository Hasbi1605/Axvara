// tests/store-settings-logo.test.ts — Audit AU-H2-12 (21 Nov 2026).
//
// PUT /api/store-settings logoUrl dulu menerima "//evil.com/x.png" karena cek
// `startsWith("/")` — protocol-relative = off-origin. Sekarang hanya path
// situs (bukan "//") atau URL HTTPS.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fx = createD1Fixture(); });
afterEach(() => { fx.close(); vi.restoreAllMocks(); });

const body = (logoUrl: string) => ({
  name: "AXVARA", tagline: "Toko akun premium dan AI gateway.", whatsappNumber: "089519388264",
  supportHours: "09.00–23.00 WIB", footerText: "AXVARA independen, tidak terafiliasi.", logoUrl,
});
const put = (logoUrl: string) => import("@/app/api/store-settings/route").then(({ PUT }) => PUT(new NextRequest("http://localhost/api/store-settings", {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body(logoUrl)),
})));

describe("AU-H2-12 — store-settings logoUrl rejects protocol-relative/off-origin", () => {
  it("accepts same-origin path and https URL", async () => {
    expect((await put("/brand/logo.svg")).status).toBe(200);
    expect((await put("https://cdn.vendor.com/logo.png")).status).toBe(200);
  });

  it.each(["//evil.com/x.png", "http://cdn.vendor.com/x.png"])("rejects %j", async (logoUrl) => {
    expect((await put(logoUrl)).status).toBe(400);
  });
});
