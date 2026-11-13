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
  await db.execRun(`INSERT INTO pedia_tiers(product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp,is_active,package_prices_json) VALUES(?,'standar','indosmm',86,'G3',20,1000,0,'{}')`,productId);
  await db.execRun(`INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',86,'Instagram','Followers','Default',30000,100,1000,1)`);
  const t = await db.queryFirst("SELECT id FROM pedia_tiers WHERE product_id=? AND tier='standar'", productId);
  tierId = Number(t?.id);
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

async function saleService(type = "Default") {
  await createDatabaseAccess().execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
    VALUES ('indosmm',86,'IG Instagram','Followers',?,9000,250,1000,1) ON CONFLICT(supplier,service_id) DO UPDATE SET type=excluded.type,rate_idr_per_1k=9000,min_qty=250`, type);
  // Tier dimulai dari mapping historis IndoSMM agar remap ke supplier jual diuji.
  await createDatabaseAccess().execRun(`UPDATE pedia_tiers SET supplier='indosmm' WHERE id=?`,tierId);
}
async function order(code: string, supplier = "indosmm", attempts = 0, sid: string | null = null) {
  await createDatabaseAccess().execRun(`INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,status,payment_status,order_kind) VALUES (?,'Fixture','628123456789','buyer@example.com','[]',5000,'qris','lunas','paid','pedia')`, code);
  await createDatabaseAccess().execRun(`INSERT INTO pedia_order_items
    (order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status,submit_attempts,supplier_order_id)
    VALUES (?,?,?,'{"refill_days":30}','x','x',100,50,5000,?,86,30000,'needs_check',?,?)`, code, productId, tierId, supplier, attempts, sid);
}

it("mapping provider and service is one validated update and never rewrites old orders", async () => {
  await saleService(); await order("AXP-OLD", "indosmm");
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm" }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier_service_id: 86 }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "unknown", supplier_service_id: 86 }))).status).toBe(400);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).status).toBe(200);
  const db = createDatabaseAccess();
  const t = await db.queryFirst(`SELECT supplier,supplier_service_id,rate_snapshot,package_prices_json FROM pedia_tiers WHERE id=?`, tierId);
  expect(t).toMatchObject({ supplier: "indosmm", supplier_service_id: 86, rate_snapshot: 9000 });
  expect(Object.keys(JSON.parse(String(t?.package_prices_json)))).toEqual(["250", "500", "1000"]);
  expect(await db.queryFirst(`SELECT supplier,supplier_service_id,snapshot_json FROM pedia_order_items WHERE order_code='AXP-OLD'`)).toEqual({ supplier: "indosmm", supplier_service_id: 86, snapshot_json: '{"refill_days":30}' });
  expect(await db.queryFirst(`SELECT rate_idr_per_1k FROM pedia_supplier_services WHERE supplier='indosmm' AND service_id=86`)).toMatchObject({ rate_idr_per_1k: 9000 });
});

it("sale mapping runs the IndoSMM rate-unit gate and fails closed on a proxy outage", async () => {
  await saleService();
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).status).toBe(200);
  expect(await createDatabaseAccess().queryFirst(`SELECT supplier FROM pedia_tiers WHERE id=?`, tierId)).toMatchObject({ supplier: "indosmm" });
  expect(callPediaProxy).toHaveBeenCalledWith("indosmm", "balance", {}, 15000);
  vi.mocked(callPediaProxy).mockResolvedValue({ ok: false, kind: "api_error" } as never);
  expect((await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).status).toBe(400);
});

it("creation validates packages, parent, provider and compatible service then prices the new tier", async () => {
  expect((await POST(req({ slug: "new", name: "New", platform: "instagram", metric: "likes", target_kind: "post", packages_json: "[105]", step: 10 }))).status).toBe(400);
  const created = await (await POST(req({ slug: "new", name: "New", platform: "instagram", metric: "likes", target_kind: "post", packages_json: "[100,250]", step: 10 }))).json();
  await saleService();
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
    VALUES ('indosmm',777001,'Baru','Followers','Default',30000,100,1000,1)`);
  const body = { kind: "tier", product_id: productId, tier: "hemat", supplier: "indosmm", supplier_service_id: 777001, price_group: "G3", markup_pct: 20, min_profit_rp: 1000 };
  const result = await POST(req(body));
  expect(result.status).toBe(500);
  expect(await result.json()).toMatchObject({ error: "reprice_failed", saved: true, id: expect.any(Number) });
  fixture.control.fail = null;
  const dupe = await POST(req(body));
  expect(dupe.status).toBe(500);
  expect((await dupe.json()).error).toBe("save_failed");
});

it("incompatible supplier types cannot be mapped", async () => {
  await saleService("Custom Comments");
  expect(await (await PUT(req({ kind: "tier", id: tierId, supplier: "indosmm", supplier_service_id: 86 }))).json()).toMatchObject({ error: "service_unavailable" });
});

it("supplier search keeps same IDs distinct and filters mapping/provider/compatibility", async () => {
  await saleService();
  const { GET: services } = await import("@/app/api/admin/pedia/services/route");
  const all = await (await services(new NextRequest("http://localhost/?q=86", { headers: { cookie } }))).json();
  expect(all.rows.map((r: Record<string, unknown>) => `${r.supplier}:${r.service_id}`)).toEqual(["indosmm:86"]);
  const filtered = await (await services(new NextRequest("http://localhost/?supplier=indosmm&mapping=unmapped&compatible=1", { headers: { cookie } }))).json();
  expect(filtered.total).toBe(0);
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
  vi.mocked(callPediaProxy).mockImplementation(async (_provider, action) => ({ ok: true, status: 200, data: action === "balance" ? { balance: "100000", currency: "IDR" } : [{ service: 99, name: "Broken", category: "IG", type: "Default", rate: "NaN", min: 1, max: 100 }] }) as never);
  expect((await sync(req({ action: "resync", supplier: "indosmm" }))).status).toBe(502);
  expect(await createDatabaseAccess().queryFirst(`SELECT service_id FROM pedia_supplier_services WHERE service_id=99`)).toBeNull();
});

// 2026-11-13 (owner): ringkasan mengikuti supplier jual aktif (IndoSMM);
// USD tidak pernah dilabel rupiah.
it("provider health lists only the active sale supplier and never labels USD as rupiah", async () => {
  const { GET: overview } = await import("@/app/api/admin/pedia/overview/route");
  vi.mocked(callPediaProxy).mockImplementation(async () => ({ ok: true, status: 200, data: { balance: "12000", currency: "USD" } }) as never);
  const data = await (await overview(req())).json();
  expect(data.providers).toHaveLength(1);
  expect(data.providers[0]).toMatchObject({ supplier: "indosmm", error: "unsupported_currency", balance: { value: null, stale: true }, pricing_verified: false });
  expect(vi.mocked(callPediaProxy).mock.calls.some((c) => c[0] === "indosmm")).toBe(true);
  vi.mocked(callPediaProxy).mockImplementation(async (_p, action) => ({ ok: true, status: 200, data: action === "services" ? [{ service: 1 }] : { balance: "12000", currency: "IDR" } }) as never);
  const ok = await (await overview(req())).json();
  expect(ok.providers[0]).toMatchObject({ supplier: "indosmm", error: null, balance: { value: 12000, stale: false }, pricing_verified: true });
  expect(await createDatabaseAccess().queryAll(`SELECT supplier FROM pedia_supplier_balance_log`)).toEqual([{ supplier: "indosmm" }]);
});

it("order balance/reconciliation use stored provider, save supplier ID snapshot, and allow identical IDs across providers only", async () => {
  await order("AXP-A", "legacy_supplier", 1, "42"); await order("AXP-B", "indosmm", 1);
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
  for (const action of ["resubmit", "cancel_manual"]) {
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
  expect(await createDatabaseAccess().queryFirst(`SELECT status,supplier FROM pedia_order_items WHERE order_code='AXP-SAFE'`)).toMatchObject({ status: "queued", supplier: "indosmm" });
});

it("manual cancellation atomically records follow-up without credits", async () => {
  await order("AXP-CREDIT");
  const { POST: act } = await import("@/app/api/admin/pedia/orders/[code]/route");
  fixture.control.fail = (sql) => sql.includes("UPDATE pedia_order_items SET status=?");
  expect((await act(req({ action: "cancel_manual", confirm: true }), { params: Promise.resolve({ code: "AXP-CREDIT" }) })).status).toBe(500);
  expect(await createDatabaseAccess().queryAll(`SELECT * FROM pedia_credits`)).toEqual([]);
  fixture.control.fail = null;
  expect((await act(req({ action: "cancel_manual", confirm: true }), { params: Promise.resolve({ code: "AXP-CREDIT" }) })).status).toBe(200);
  expect(await createDatabaseAccess().queryFirst(`SELECT status FROM pedia_order_items WHERE order_code='AXP-CREDIT'`)).toMatchObject({ status: "canceled" });
  expect((await createDatabaseAccess().queryAll(`SELECT * FROM pedia_credit_ledger`)).length).toBe(0);
  expect(await createDatabaseAccess().queryFirst("SELECT state FROM pedia_followups WHERE order_code='AXP-CREDIT'")).toMatchObject({state:"open"});
});

it("settings GET reports the effective operational min-order and alert values, not stale saved rows", async () => {
  const db = createDatabaseAccess();
  await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES('pedia_min_order_rp','7500',datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  await db.execRun(`INSERT INTO store_settings(key,value,updated_at) VALUES('pedia_balance_alert_rp','250000',datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  vi.stubEnv("PEDIA_MIN_ORDER_RP", "3000");
  vi.stubEnv("PEDIA_BALANCE_ALERT_RP", "40000");
  const { GET: settings } = await import("@/app/api/admin/pedia/settings/route");
  const data = await (await settings(req())).json();
  expect(data.settings.pedia_min_order_rp).toBe(3000);
  expect(data.settings.pedia_balance_alert_rp).toBe(40000);
});

it("partial settings saves return saved keys instead of full success", async () => {
  const { PUT: settings } = await import("@/app/api/admin/pedia/settings/route");
  fixture.control.fail = (sql, params) => sql.includes("INSERT INTO store_settings") && params[0] === "pedia_markup_g2";
  const result = await settings(req({ pedia_markup_g1: 100, pedia_markup_g2: 50 }));
  expect(result.status).toBe(500); expect(await result.json()).toMatchObject({ error: "save_partial", saved_fields: ["pedia_markup_g1"] });
});

it("authenticated shortlist includes only the sale supplier at one quantity without writes or supplier calls",async()=>{
 await saleService();
 await createDatabaseAccess().execRun("UPDATE pedia_supplier_services SET name='Instagram Followers Global'");
 const {GET:services}=await import("@/app/api/admin/pedia/services/route");
 const response=await services(new NextRequest(`http://localhost/?view=shortlist&product_id=${productId}&quantity=500`,{headers:{cookie}}));
 expect(response.status).toBe(200);
 const data=await response.json();
 expect(data.rows.length).toBeGreaterThan(0);
 expect(data.rows.every((r:Record<string,unknown>)=>r.supplier==="indosmm" && Number(r.estimated_cost)>0)).toBe(true);
 expect(callPediaProxy).not.toHaveBeenCalled();
 expect((await services(new NextRequest(`http://localhost/?view=shortlist&product_id=${productId}&quantity=NaN`,{headers:{cookie}}))).status).toBe(400);
 expect((await services(new NextRequest(`http://localhost/?view=shortlist&product_id=${productId}&quantity=500`))).status).toBe(401);
});

it("new draft tiers persist reviewed public copy and bounds while staying inactive",async()=>{
 await createDatabaseAccess().execRun("INSERT INTO pedia_supplier_services(supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present) VALUES('indosmm',99,'Instagram Followers','Followers','Default',1000,10,1000,1)");
 const response=await POST(req({kind:"tier",product_id:productId,tier:"standar",supplier:"indosmm",supplier_service_id:99,price_group:"G3",markup_pct:20,min_profit_rp:1000,refill_days:0,is_active:0,public_name:"Reviewed draft",description_md:"Reviewed description",terms_md:"Without refill",instructions_md:"Use profile URL",min_qty_override:100,max_qty_override:500,quantity_step:10,target_format:"url",refill_anchor:"created",is_recommended:0}));
 expect(response.status).toBe(200);
 const {id}=await response.json();
 expect(await createDatabaseAccess().queryFirst("SELECT public_name,description_md,terms_md,instructions_md,min_qty_override,max_qty_override,quantity_step,is_active FROM pedia_tiers WHERE id=?",id)).toEqual({public_name:"Reviewed draft",description_md:"Reviewed description",terms_md:"Without refill",instructions_md:"Use profile URL",min_qty_override:100,max_qty_override:500,quantity_step:10,is_active:0});
});

it("allows sale-supplier creation, remapping and activation, and still edits retired copies",async()=>{
 const db=createDatabaseAccess();
 await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,present)
   VALUES ('indosmm',88,'Instagram Baru','Followers','Default',9000,100,1000,1)`);
 const body={kind:"tier",product_id:productId,tier:"hemat",supplier:"indosmm",supplier_service_id:88,price_group:"G3",markup_pct:20,min_profit_rp:1000,is_active:0};
 expect((await POST(req(body))).status).toBe(200);
 await db.execRun("UPDATE pedia_tiers SET supplier='legacy_supplier',is_active=0 WHERE id=?",tierId);
 expect((await PUT(req({kind:"tier",id:tierId,supplier:"indosmm",supplier_service_id:86}))).status).toBe(200);
 expect((await PUT(req({kind:"tier",id:tierId,is_active:1}))).status).toBe(200);
 await db.execRun("UPDATE pedia_tiers SET supplier='legacy_supplier',is_active=0 WHERE id=?",tierId);
 expect((await PUT(req({kind:"tier",id:tierId,public_name:"Riwayat",is_active:0}))).status).toBe(200);
 expect(await db.queryFirst("SELECT supplier,public_name,is_active FROM pedia_tiers WHERE id=?",tierId)).toEqual({supplier:"legacy_supplier",public_name:"Riwayat",is_active:0});
});
it.each(['Canva Pro','Google Gemini','CapCut'])('rejects premium category %s on tier creation and activation',async(category)=>{
 const db=createDatabaseAccess();await db.execRun("UPDATE pedia_supplier_services SET category=? WHERE supplier='indosmm'",category);
 expect((await POST(req({kind:"tier",product_id:productId,tier:"hemat",supplier:"indosmm",supplier_service_id:86,price_group:"G3",markup_pct:20,min_profit_rp:1000}))).status).toBe(400);
 expect((await PUT(req({kind:"tier",id:tierId,is_active:1}))).status).toBe(400);
});

it("manual follow-up resolution requires a note, records the session actor once, and preserves paid facts",async()=>{
  await order("AXP-HANDLED");
  const db=createDatabaseAccess();await db.execRun("UPDATE pedia_order_items SET status='partial' WHERE order_code='AXP-HANDLED'");
  await db.execRun("INSERT INTO pedia_followups(order_code,reason) VALUES('AXP-HANDLED','supplier_partial')");
  const {POST:action}=await import("@/app/api/admin/pedia/orders/[code]/route");const ctx={params:Promise.resolve({code:"AXP-HANDLED"})};
  expect((await action(req({action:"mark_handled",confirm:true}),ctx)).status).toBe(400);
  expect((await action(req({action:"mark_handled",confirm:true,note:"Ditangani manual di luar website."}),ctx)).status).toBe(200);
  expect(await db.queryFirst("SELECT state,note,handled_by FROM pedia_followups WHERE order_code='AXP-HANDLED'")).toEqual({state:"handled",note:"Ditangani manual di luar website.",handled_by:"admin@axvara.tech"});
  expect((await action(req({action:"mark_handled",confirm:true,note:"Percobaan menimpa catatan sebelumnya."}),ctx)).status).toBe(409);
  expect(await db.queryFirst("SELECT status,payment_status FROM orders WHERE code='AXP-HANDLED'")).toEqual({status:"lunas",payment_status:"paid"});
  expect(await db.queryAll("SELECT * FROM pedia_credits")).toHaveLength(0);
});

it("retired credit actions reject before changing an order or issuing value",async()=>{
  await order("AXP-RETIRED");const {POST:action}=await import("@/app/api/admin/pedia/orders/[code]/route");
  const response=await action(req({action:"cancel_credit",confirm:true}),{params:Promise.resolve({code:"AXP-RETIRED"})});
  expect(response.status).toBe(410);expect((await response.json()).error).toBe("credits_retired");
  expect(await createDatabaseAccess().queryFirst("SELECT status FROM pedia_order_items WHERE order_code='AXP-RETIRED'")).toEqual({status:"needs_check"});
});
