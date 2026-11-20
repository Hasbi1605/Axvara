import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { clearRateLimitBucketsForTest } from "@/lib/rateLimit";
import { POST as proofsReview } from "@/app/api/admin/proofs/[id]/route";
import { PUT as pediaSettings } from "@/app/api/admin/pedia/settings/route";
import { POST as supplierLinks } from "@/app/api/admin/supplier-links/route";
import { POST as paymentEvents } from "@/app/api/admin/payments/events/route";
import { POST as warungMarkupBulk } from "@/app/api/admin/warung/markup/bulk/route";

// AU-B1-3 — every authenticated admin mutation route must read its JSON body
// through the bounded reader (readJsonBody / readTextBody), never a bare
// `req.json()`. A static scan keeps the policy enforced as routes are added.

const ADMIN_API_DIR = path.join(process.cwd(), "src/app/api/admin");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

const routes = walk(ADMIN_API_DIR);

describe("AU-B1-3 static guard — admin routes use the bounded JSON reader", () => {
  it("scans the whole admin API surface", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it("no admin route.ts parses req.json()/request.json() directly", () => {
    const offenders = routes.filter((file) => /(?:req|request)\.json\(\)/.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});

// One behavior probe per cap class: an authenticated caller sending an oversize
// body is rejected by the streamed bound BEFORE the Zod parse, with the
// canonical 413 error shape (no reliance on Content-Length).
describe("AU-B1-3 behavior — oversize bodies return 413 with the existing error shape", () => {
  let fx: ReturnType<typeof createD1Fixture>;
  let cookie: string;

  beforeEach(async () => {
    fx = createD1Fixture();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_JWT_SECRET", "fx6-body-cap-fixture-secret");
    vi.stubEnv("ADMIN_EMAIL", "admin@example.test");
    vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
    clearRateLimitBucketsForTest();
    const session = await createAdminToken("admin@example.test");
    const idle = await createIdleToken(session.sid);
    cookie = `axvara_admin_token=${session.token}; axvara_idle=${idle}`;
  });
  afterEach(() => { fx.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const req = (url: string, body: string, method = "POST") => new NextRequest(url, {
    method, headers: { "content-type": "application/json", cookie }, body,
  });

  const cases: { name: string; cap: number; call: (r: NextRequest) => Promise<Response> }[] = [
    { name: "proofs review (8 KB)", cap: 8_000, call: (r) => proofsReview(r, { params: Promise.resolve({ id: "1" }) }) },
    { name: "pedia settings (2 KB)", cap: 2_000, call: (r) => pediaSettings(r) },
    { name: "supplier-links create (8 KB)", cap: 8_000, call: (r) => supplierLinks(r) },
    { name: "payments events (8 KB)", cap: 8_000, call: (r) => paymentEvents(r) },
    { name: "warung markup bulk (64 KB)", cap: 64_000, call: (r) => warungMarkupBulk(r) },
  ];

  it.each(cases)("$name rejects an oversize body with 413", async ({ cap, call }) => {
    const oversize = JSON.stringify({ pad: "x".repeat(cap + 1_000) });
    const res = await call(req("https://axvara.test/api/admin/fixture", oversize));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("an under-cap malformed body is rejected as 400, not 413", async () => {
    const res = await proofsReview(req("https://axvara.test/api/admin/proofs/1", "{not-json"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });
});
