import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { GET, POST, PUT } from "@/app/api/admin/pedia/products/route";
import { createDatabaseAccess } from "@/lib/db-access";
import { createAdminToken, createIdleToken } from "@/lib/auth";

let fixture: ReturnType<typeof createD1Fixture>;
let cookie: string;
let productId: number;
let tierId: number;
function req(body?: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/pedia/products", {
    method: body ? "PUT" : "GET", headers: { cookie, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
beforeEach(async () => {
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "pedia-admin-ux-api-test-secret");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  fixture = createD1Fixture();
  const session = await createAdminToken("admin@axvara.tech");
  cookie = `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
  await POST(new NextRequest("http://localhost/", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "seed" }) }));
  const db = createDatabaseAccess();
  const p = await db.queryFirst("SELECT id FROM pedia_products WHERE slug='followers-instagram'");
  productId = Number(p?.id);
  const t = await db.queryFirst("SELECT id FROM pedia_tiers WHERE product_id=? AND tier='standar'", productId);
  tierId = Number(t?.id);
  await db.execRun(`INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, present)
    VALUES ('providersmm',86,'Instagram','Followers','Default',30000,100,1000,1)`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("partial PUT validates numeric bounds and JSON without resetting unrelated product fields", async () => {
  expect((await PUT(req({ id: productId, step: 0 }))).status).toBe(400);
  expect((await PUT(req({ id: productId, packages_json: "[105]" }))).status).toBe(400);
  expect((await PUT(req({ id: productId, checklist_json: "{}" }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, markup_pct: -1 }))).status).toBe(400);
  expect((await PUT(req({ id: productId, is_featured: 1 }))).status).toBe(200);
  const p = await createDatabaseAccess().queryFirst("SELECT name, packages_json, is_featured FROM pedia_products WHERE id=?", productId);
  expect(p).toMatchObject({ name: "Followers Instagram", packages_json: "[100,250,500,1000]", is_featured: 1 });
});

it("package changes reprice existing tiers immediately and GET carries service type", async () => {
  expect((await PUT(req({ kind: "tier", id: tierId, is_active: 1 }))).status).toBe(200);
  expect((await PUT(req({ id: productId, packages_json: "[100,500]" }))).status).toBe(200);
  const tier = await createDatabaseAccess().queryFirst("SELECT package_prices_json, is_active FROM pedia_tiers WHERE id=?", tierId);
  expect(Object.keys(JSON.parse(String(tier?.package_prices_json)))).toEqual(["100", "500"]);
  expect(tier?.is_active).toBe(1);
  const response = await (await GET(req())).json();
  expect(response.tiers.find((t: { id: number }) => t.id === tierId).live_type).toBe("Default");
});

it("manual edits never revive a service marked missing by the supplier", async () => {
  const db = createDatabaseAccess();
  await db.execRun("UPDATE pedia_supplier_services SET present=0 WHERE service_id=86");
  expect((await PUT(req({ kind: "tier", id: tierId, is_active: 1 }))).status).toBe(200);
  expect(await db.queryFirst("SELECT present FROM pedia_supplier_services WHERE service_id=86")).toMatchObject({ present: 0 });
  expect(await db.queryFirst("SELECT is_active, auto_disabled_reason, package_prices_json FROM pedia_tiers WHERE id=?", tierId)).toMatchObject({ is_active: 0, auto_disabled_reason: "service_missing", package_prices_json: "{}" });
});

it("failed and nonexistent writes return errors, not success", async () => {
  expect((await PUT(req({ id: 99999, is_active: 1 }))).status).toBe(404);
  fixture.control.fail = (sql) => sql.startsWith("UPDATE pedia_products");
  expect((await PUT(req({ id: productId, is_active: 1 }))).status).toBe(500);
});

it("repricing failure reports partial persistence explicitly", async () => {
  fixture.control.fail = (sql) => sql.includes("SET package_prices_json=?");
  const result = await PUT(req({ kind: "tier", id: tierId, markup_pct: 40 }));
  expect(result.status).toBe(500); expect(await result.json()).toMatchObject({ error: "reprice_failed" });
  expect(await createDatabaseAccess().queryFirst("SELECT markup_pct FROM pedia_tiers WHERE id=?", tierId)).toMatchObject({ markup_pct: 40 });
});

it("failed reads do not masquerade as an empty catalog", async () => {
  fixture.control.fail = (sql) => sql.startsWith("SELECT * FROM pedia_products");
  expect((await GET(req())).status).toBe(500);
});

it("order action database failures return a visible error", async () => {
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  fixture.control.fail = (sql) => sql.startsWith("SELECT * FROM pedia_order_items");
  const result = await act(req({ action: "mark_submitted", supplier_order_id: "123" }), { params: Promise.resolve({ code: "AXP-TEST" }) });
  expect(result.status).toBe(500); expect(await result.json()).toMatchObject({ error: "save_failed" });
});
