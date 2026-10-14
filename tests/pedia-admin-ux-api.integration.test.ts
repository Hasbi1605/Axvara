import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { GET, POST, PUT } from "@/app/api/admin/pedia/products/route";
import { createDatabaseAccess } from "@/lib/db-access";
import { createAdminToken, createIdleToken } from "@/lib/auth";
import { callPediaProxy } from "@/lib/pedia/proxy";

vi.mock("@/lib/pedia/proxy", async (original) => ({ ...await original<typeof import("@/lib/pedia/proxy")>(), callPediaProxy: vi.fn() }));

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
  vi.mocked(callPediaProxy).mockReset();
  vi.mocked(callPediaProxy).mockImplementation(async (_provider, action) => ({ ok: true, status: 200, data: action === "balance" ? { balance: "100000", currency: "IDR" } : action === "status" ? { status: "Pending" } : [{ service: 86, name: "Instagram", category: "Followers", type: "Default", rate: "1000", min: "100", max: "1000", refill: true }] }) as never);
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
afterEach(() => { fixture.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("partial PUT validates numeric bounds and JSON without resetting unrelated product fields", async () => {
  expect((await PUT(req({ id: productId, step: 0 }))).status).toBe(400);
  expect((await PUT(req({ id: productId, packages_json: "[105]" }))).status).toBe(400);
  expect((await PUT(req({ id: productId, checklist_json: "{}" }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, markup_pct: -1 }))).status).toBe(400);
  expect((await PUT(req({ id: productId, is_featured: 1 }))).status).toBe(200);
  const p = await createDatabaseAccess().queryFirst("SELECT name, packages_json, is_featured FROM pedia_products WHERE id=?", productId);
  expect(p).toMatchObject({ name: "Followers Instagram", packages_json: "[100,250,500,1000]", is_featured: 1 });
});

it.each([
  [{ id: "public", label: "Publik", help: {} }],
  [{ id: "public", label: "Publik", help: ["Bantuan"] }],
  [{ id: "public", label: "Publik", help: null }],
  [{ id: "public", label: "Publik", help: 1 }],
  [{ id: "public", label: "Publik" }, { id: "public", label: "Duplikat" }],
  [{ id: "public", label: "Publik" }, { id: " public ", label: "Alias" }],
  [{ id: "", label: "Publik" }],
  [{ id: " ", label: "Publik" }],
  [{ id: "x".repeat(121), label: "Publik" }],
  [{ id: "public", label: "" }],
  [{ id: "public", label: " " }],
  [{ id: "public", label: "x".repeat(501) }],
  [{ id: "public", label: "Publik", help: "x".repeat(2001) }],
].map((checklist) => ({ checklist })))("POST and PUT reject malformed checklist $checklist without persistence", async ({ checklist }) => {
  const db = createDatabaseAccess();
  const before = await db.queryFirst("SELECT checklist_json FROM pedia_products WHERE id=?", productId);
  const checklist_json = JSON.stringify(checklist);
  expect((await PUT(req({ id: productId, checklist_json }))).status).toBe(400);
  expect((await POST(req({ slug: "invalid-checklist", name: "Fixture", platform: "instagram", metric: "followers", target_kind: "profile", checklist_json }))).status).toBe(400);
  expect(await db.queryFirst("SELECT checklist_json FROM pedia_products WHERE id=?", productId)).toEqual(before);
  expect(await db.queryFirst("SELECT id FROM pedia_products WHERE slug='invalid-checklist'")).toBeNull();
});

it("checklists allow optional string help and bounded unique IDs/labels while preserving extra fields", async () => {
  const checklist_json = JSON.stringify([
    { id: "x".repeat(120), label: "x".repeat(500), help: "x".repeat(2000), image: "/fixture.webp" },
    { id: "public", label: "Akun publik" }, { id: "username", label: "Username tetap", help: "" },
  ]);
  expect((await POST(req({ slug: "valid-checklist", name: "Fixture", platform: "instagram", metric: "followers", target_kind: "profile", checklist_json }))).status).toBe(200);
  expect((await PUT(req({ id: productId, checklist_json }))).status).toBe(200);
  expect(await createDatabaseAccess().queryFirst("SELECT checklist_json FROM pedia_products WHERE id=?", productId)).toEqual({ checklist_json });
  expect((await PUT(req({ id: productId, checklist_json: "[]" }))).status).toBe(200);
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
  expect(await createDatabaseAccess().queryFirst("SELECT package_prices_json FROM pedia_tiers WHERE id=?", tierId)).toMatchObject({ package_prices_json: "{}" });
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

async function indoService(type = "Default") {
  await createDatabaseAccess().execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
    VALUES ('indosmm',86,'Indo Instagram','Followers',?,9000,250,1000,1)`, type);
}
async function order(code: string, supplier = "providersmm", attempts = 0, sid: string | null = null) {
  await createDatabaseAccess().execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,order_kind) VALUES (?,'Fixture','628123456789','buyer@example.com','[]',5000,'qris','lunas','pedia')`, code);
  await createDatabaseAccess().execRun(`INSERT INTO pedia_order_items
    (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts,supplier_order_id)
    VALUES (?,?,?,'{"refill_days":30}','x','x',100,50,5000,?,86,30000,'needs_check',?,?)`, code, productId, tierId, supplier, attempts, sid);
}

it("mapping provider and service is one validated update and never rewrites old orders", async () => {
  await indoService(); await order("AXP-OLD");
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm" }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier_service_id: 86 }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "unknown", supplier_service_id: 86 }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).status).toBe(200);
  const db = createDatabaseAccess();
  const t = await db.queryFirst(`SELECT supplier,supplier_service_id,rate_snapshot,package_prices_json FROM pedia_tiers WHERE id=?`, tierId);
  expect(t).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, rate_snapshot: 9000 });
  expect(Object.keys(JSON.parse(String(t?.package_prices_json)))).toEqual(["250", "500", "1000"]);
  expect(await db.queryFirst(`SELECT supplier,supplier_service_id,snapshot_json FROM pedia_order_items WHERE order_code='AXP-OLD'`)).toEqual({ supplier: "providersmm", supplier_service_id: 86, snapshot_json: '{"refill_days":30}' });
  expect(await db.queryFirst(`SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier='providersmm' AND service_id=86`)).toMatchObject({ rate_idr_per_1k: 30000 });
});

it.each([undefined, "USD"])("IndoSMM mapping refuses unverified currency %s before persistence", async (currency) => {
  await indoService();
  vi.mocked(callPediaProxy).mockResolvedValue({ ok: true, status: 200, data: { balance: "100", currency } });
  const result = await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }));
  expect(await result.json()).toMatchObject({ error: "unsupported_currency" });
  expect(await createDatabaseAccess().queryFirst(`SELECT supplier FROM pedia_tiers WHERE id=?`, tierId)).toMatchObject({ supplier: "providersmm" });
  expect(callPediaProxy).toHaveBeenCalledTimes(1);
});

it("IndoSMM mapping and activation require the VPS rate gate, not a local flag", async () => {
  await indoService();
  vi.mocked(callPediaProxy).mockImplementation(async (_p, action) => action === "balance" ? { ok: true, status: 200, data: { balance: "100", currency: "IDR" } } : { ok: false, kind: "api_error" } as never);
  expect(await (await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).json()).toMatchObject({ error: "pricing_unverified" });
  await createDatabaseAccess().execRun(`UPDATE pedia_tiers SET supplier='indosmm',is_active=0 WHERE id=?`, tierId);
  expect((await PUT(req({ kind: "tier", id: tierId, is_active: 1 }))).status).toBe(400);
});

it("creation validates packages, parent, provider and compatible service then prices the new tier", async () => {
  expect((await POST(req({ slug: "new", name: "New", platform: "instagram", metric: "likes", target_kind: "post", packages_json: "[105]", step: 10 }))).status).toBe(400);
  const created = await (await POST(req({ slug: "new", name: "New", platform: "instagram", metric: "likes", target_kind: "post", packages_json: "[100,250]", step: 10 }))).json();
  await indoService();
  const body = { kind: "tier", product_id: created.id, tier: "hemat", supplier: "indosmm", supplier_service_id: 86, price_group: "G3", markup_pct: 20, min_profit_rp: 1000 };
  expect((await POST(req({ ...body, product_id: 99999 }))).status).toBe(404);
  expect((await POST(req({ ...body, supplier_service_id: 99999 }))).status).toBe(400);
  const made = await (await POST(req(body))).json();
  expect(made.ok).toBe(true);
  const row = await createDatabaseAccess().queryFirst(`SELECT supplier,is_active,package_prices_json FROM pedia_tiers WHERE id=?`, made.id);
  expect(row).toMatchObject({ supplier: "indosmm", is_active: 0 });
  expect(Object.keys(JSON.parse(String(row?.package_prices_json)))).toEqual(["250"]);
});

it("creation reprice failure identifies the already saved tier so retries cannot create duplicates silently", async () => {
  // Sejak 0062 duplikat dicegah UNIQUE(product, supplier, service): retry
  // pembuatan layanan yang sama ditolak bersih, bukan duplikat diam-diam.
  await createDatabaseAccess().execRun(`DELETE FROM pedia_tiers WHERE product_id=? AND tier='hemat'`, productId);
  fixture.control.fail = (sql) => sql.includes("SET package_prices_json=?");
  await createDatabaseAccess().execRun(`INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type, rate_idr_per_1k, min_qty, max_qty, present)
    VALUES ('providersmm',777001,'Baru','Followers','Default',30000,100,1000,1)`);
  const body = { kind: "tier", product_id: productId, tier: "hemat", supplier: "providersmm", supplier_service_id: 777001, price_group: "G3", markup_pct: 20, min_profit_rp: 1000 };
  const result = await POST(req(body));
  expect(result.status).toBe(500);
  expect(await result.json()).toMatchObject({ error: "reprice_failed", saved: true, id: expect.any(Number) });
  fixture.control.fail = null;
  const dupe = await POST(req(body));
  expect(dupe.status).toBe(500);
  expect((await dupe.json()).error).toBe("save_failed");
});

it("incompatible supplier types cannot be mapped", async () => {
  await indoService("Custom Comments");
  expect(await (await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).json()).toMatchObject({ error: "service_unavailable" });
});

it("supplier search keeps same IDs distinct and filters mapping/provider/compatibility", async () => {
  await indoService();
  const { GET: services } = await import("@/app/api/admin/pedia/services/route");
  const all = await (await services(new NextRequest("http://localhost/?q=86", { headers: { cookie } }))).json();
  expect(all.rows.map((r: Record<string, unknown>) => `${r.supplier}:${r.service_id}`)).toEqual(["indosmm:86", "providersmm:86"]);
  const filtered = await (await services(new NextRequest("http://localhost/?supplier=indosmm&mapping=unmapped&compatible=1", { headers: { cookie } }))).json();
  expect(filtered.total).toBe(1); expect(filtered.rows[0].used_in).toBeNull();
  expect((await services(new NextRequest("http://localhost/?supplier=other", { headers: { cookie } }))).status).toBe(400);
  expect((await services(new NextRequest("http://localhost/?page=NaN", { headers: { cookie } }))).status).toBe(400);
});

it("provider resync enforces IDR, rate gate, valid entire catalog and honest partial failure", async () => {
  const { POST: sync } = await import("@/app/api/admin/pedia/services/route");
  expect((await sync(req({ action: "resync", supplier: "other" }))).status).toBe(400);
  vi.mocked(callPediaProxy).mockResolvedValueOnce({ ok: true, status: 200, data: { balance: "10", currency: "USD" } });
  expect((await sync(req({ action: "resync", supplier: "indosmm" }))).status).toBe(400);
  expect((await sync(req({ action: "resync", supplier: "indosmm" }))).status).toBe(200);
  expect(await createDatabaseAccess().queryFirst(`SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=86`)).toMatchObject({ rate_idr_per_1k: 1000 });
  fixture.control.fail = (sql) => sql.includes("INSERT INTO pedia_supplier_services");
  const partial = await sync(req({ action: "resync", supplier: "indosmm" }));
  expect(partial.status).toBe(500); expect(await partial.json()).toMatchObject({ ok: false, supplier: "indosmm", errors: ["sync_partial"] });
});

it("resync rejects malformed catalogs before any supplier rows are written", async () => {
  const { POST: sync } = await import("@/app/api/admin/pedia/services/route");
  vi.mocked(callPediaProxy).mockResolvedValue({ ok: true, status: 200, data: [{ service: 99, name: "Broken", category: "IG", type: "Default", rate: "NaN", min: 1, max: 100 }] });
  expect((await sync(req({ action: "resync", supplier: "providersmm" }))).status).toBe(502);
  expect(await createDatabaseAccess().queryFirst(`SELECT service_id FROM pedia_supplier_services WHERE service_id=99`)).toBeNull();
});

it("provider health preserves a healthy supplier when the other fails, never labels USD as rupiah", async () => {
  const { GET: overview } = await import("@/app/api/admin/pedia/overview/route");
  vi.mocked(callPediaProxy).mockImplementation(async (provider) => ({ ok: true, status: 200, data: { balance: "12000", currency: provider === "indosmm" ? "USD" : "IDR" } }) as never);
  const data = await (await overview(req())).json();
  expect(data.providers[0]).toMatchObject({ supplier: "providersmm", error: null, balance: { value: 12000, stale: false } });
  expect(data.providers[1]).toMatchObject({ supplier: "indosmm", error: "unsupported_currency", balance: { value: null, stale: true }, pricing_verified: false });
  expect(await createDatabaseAccess().queryAll(`SELECT supplier FROM pedia_supplier_balance_log`)).toEqual([{ supplier: "providersmm" }]);
});

it("order balance/reconciliation use stored provider, save supplier ID snapshot, and allow identical IDs across providers only", async () => {
  await order("AXP-A", "providersmm", 1, "42"); await order("AXP-B", "indosmm", 1);
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  const action = (code: string, body: Record<string, unknown>) => act(req(body), { params: Promise.resolve({ code }) });
  expect((await action("AXP-B", { action: "check_balance" })).status).toBe(200);
  expect(callPediaProxy).toHaveBeenCalledWith("indosmm", "balance", {}, 15000);
  expect((await action("AXP-B", { action: "mark_submitted", supplier_order_id: "42", confirm: true })).status).toBe(200);
  const row = await createDatabaseAccess().queryFirst(`SELECT supplier,supplier_order_id,snapshot_json FROM pedia_order_items WHERE order_code='AXP-B'`);
  expect(row).toMatchObject({ supplier: "indosmm", supplier_order_id: "42" });
  expect(JSON.parse(String(row?.snapshot_json))).toMatchObject({ refill_days: 30, supplier: "indosmm", supplier_service_id: 86, supplier_order_id: "42" });
  await order("AXP-C", "indosmm", 1);
  expect((await action("AXP-C", { action: "mark_submitted", supplier_order_id: "42", confirm: true })).status).toBe(409);
});

it.each(["042", "00", "0", "+42", "4.2", "4e2"])("mark_submitted rejects noncanonical supplier ID %s before proxy or persistence", async (sid) => {
  await order("AXP-EXISTING", "indosmm", 1, "42");
  await order("AXP-ALIAS", "indosmm", 1);
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  const result = await act(req({ action: "mark_submitted", supplier_order_id: sid, confirm: true }), { params: Promise.resolve({ code: "AXP-ALIAS" }) });
  expect(result.status).toBe(400);
  expect(await result.json()).toMatchObject({ error: "invalid_supplier_order_id" });
  expect(callPediaProxy).not.toHaveBeenCalled();
  expect(await createDatabaseAccess().queryFirst("SELECT status,supplier_order_id FROM pedia_order_items WHERE order_code='AXP-ALIAS'")).toEqual({ status: "needs_check", supplier_order_id: null });
});

it("mark_submitted preserves large decimal IDs as strings and rejects their exact provider-scoped duplicate", async () => {
  const sid = "900719925474099312345678901234567890123456789012345678901234";
  await order("AXP-LARGE", "indosmm", 1);
  await order("AXP-DUPLICATE", "indosmm", 1);
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  const action = (code: string) => act(req({ action: "mark_submitted", supplier_order_id: sid, confirm: true }), { params: Promise.resolve({ code }) });
  expect((await action("AXP-LARGE")).status).toBe(200);
  expect(callPediaProxy).toHaveBeenCalledExactlyOnceWith("indosmm", "status", { order: sid }, 15000);
  const saved = await createDatabaseAccess().queryFirst("SELECT supplier_order_id,snapshot_json FROM pedia_order_items WHERE order_code='AXP-LARGE'");
  expect(saved?.supplier_order_id).toBe(sid);
  expect(JSON.parse(String(saved?.snapshot_json)).supplier_order_id).toBe(sid);
  const conflict = await action("AXP-DUPLICATE");
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ error: "supplier_order_conflict" });
  expect(callPediaProxy).toHaveBeenCalledTimes(1);
});

it("ambiguous recovery cannot retry or issue credit despite confirmation", async () => {
  await order("AXP-AMB", "indosmm", 1);
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  for (const action of ["resubmit", "cancel_credit"]) {
    const result = await act(req({ action, confirm: true, checked_supplier: true, accept_charge: true }), { params: Promise.resolve({ code: "AXP-AMB" }) });
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ error: "reconcile_required" });
  }
  expect(callPediaProxy).not.toHaveBeenCalled();
  expect(await createDatabaseAccess().queryAll(`SELECT * FROM pedia_credits`)).toEqual([]);
});

it("safe pre-submit recovery requires both checks and paid status", async () => {
  await order("AXP-SAFE");
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  const params = { params: Promise.resolve({ code: "AXP-SAFE" }) };
  expect((await act(req({ action: "resubmit", confirm: true }), params)).status).toBe(400);
  expect((await act(req({ action: "resubmit", confirm: true, checked_supplier: true, accept_charge: true }), params)).status).toBe(200);
  expect(await createDatabaseAccess().queryFirst(`SELECT status,supplier FROM pedia_order_items WHERE order_code='AXP-SAFE'`)).toMatchObject({ status: "queued", supplier: "providersmm" });
});

it("credit cancellation rolls back credit and ledger if order update fails", async () => {
  await order("AXP-CREDIT");
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  fixture.control.fail = (sql) => sql.includes("SET status='canceled'");
  expect((await act(req({ action: "cancel_credit", confirm: true }), { params: Promise.resolve({ code: "AXP-CREDIT" }) })).status).toBe(500);
  expect(await createDatabaseAccess().queryAll(`SELECT * FROM pedia_credits`)).toEqual([]);
  fixture.control.fail = null;
  expect((await act(req({ action: "cancel_credit", confirm: true }), { params: Promise.resolve({ code: "AXP-CREDIT" }) })).status).toBe(200);
  expect(await createDatabaseAccess().queryFirst(`SELECT status FROM pedia_order_items WHERE order_code='AXP-CREDIT'`)).toMatchObject({ status: "canceled" });
  expect((await createDatabaseAccess().queryAll(`SELECT * FROM pedia_credit_ledger`)).length).toBe(1);
});

it("partial settings saves return saved keys instead of full success", async () => {
  const { PUT: settings } = await import("@/app/api/admin/pedia/settings/route");
  fixture.control.fail = (sql, params) => sql.includes("INSERT INTO store_settings") && params[0] === "pedia_markup_g2";
  const result = await settings(req({ pedia_markup_g1: 100, pedia_markup_g2: 50 }));
  expect(result.status).toBe(500); expect(await result.json()).toMatchObject({ error: "save_partial", saved_fields: ["pedia_markup_g1"] });
});
