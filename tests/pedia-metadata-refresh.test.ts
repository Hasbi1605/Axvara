// tests/pedia-metadata-refresh.test.ts — PSMM-P2/P3 (2026-11-12; revisi review-1).
// Mengunci: snapshot atomik + penanda kesegaran hanya sesudah persist penuh,
// last-good saat gagal, invalidasi eksplisit baris kosong, >=1 baris gagal tidak
// pernah dilaporkan sukses, throttle 6 jam, serta antrean materialisasi durable
// (delta > kapasitas per-request tidak hilang dan tidak di-ack palsu).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  refreshSupplierDescriptions, loadSupplierDescriptions, loadSupplierDescriptionStatus,
  enqueueManagedWork, drainManagedWork, managedPendingCount, METADATA_REFRESH_INTERVAL_MS,
} from "@/lib/pedia/metadata-refresh";
import { MANAGED_PER_CALL } from "@/lib/pedia/auto-catalog";
import { createAdminToken, createIdleToken } from "@/lib/auth";

const SNAPSHOT_KEY = "pedia_psmm_desc_snapshot";
const MARKER_KEY = "pedia_psmm_desc_last_at";

vi.mock("@/lib/pedia/supplier-descriptions", async (orig) => {
  const real = await orig<typeof import("@/lib/pedia/supplier-descriptions")>();
  return { ...real, fetchSupplierDescriptions: vi.fn() };
});
vi.mock("@/lib/pedia/proxy", async (orig) => ({
  ...await orig<typeof import("@/lib/pedia/proxy")>(),
  callPediaProxy: vi.fn(),
}));

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

type Entry = { status: "ok" | "empty" | "oversize"; text: string };

function parsed(entries: Record<number, Entry>) {
  const ids = new Set(Object.keys(entries).map(Number));
  return { ids, entries: new Map(Object.entries(entries).map(([id, e]) => [Number(id), e])) };
}

async function fixture() {
  const fx = createD1Fixture();
  const db = createDatabaseAccess(fx.db);
  vi.stubEnv("ADMIN_EMAIL", "admin@axvara.tech");
  vi.stubEnv("ADMIN_JWT_SECRET", "pedia-metadata-test-secret");
  vi.stubEnv("ADMIN_PASSWORD_SHA256", "a".repeat(64));
  return { fx, db };
}

async function seedMirror(db: ReturnType<typeof createDatabaseAccess>, ids: number[]) {
  for (const id of ids) {
    await db.execRun(
      `INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present)
       VALUES ('providersmm',?,'Instagram Followers Global','Instagram Followers','Default',20000,20,10000,0,1)`, id,
    );
  }
}

describe("refreshSupplierDescriptions (atomik + last-good)", () => {
  it("stores one validated snapshot and only then writes the freshness marker", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({
      ok: true, fetchedAt: "2026-11-12T10:00:00.000Z",
      parsed: parsed({
        101: { status: "ok", text: "Proses 1-6 jam.\nFormat https://www.instagram.com/username/" },
        102: { status: "ok", text: "Likes bertahap." },
        103: { status: "empty", text: "" },
      }),
    });
    const r = await refreshSupplierDescriptions(db, 3, { now: Date.parse("2026-11-12T10:00:00Z") });
    expect(r).toMatchObject({ status: "refreshed", rows: 3, described: 2 });
    const stored = await loadSupplierDescriptions(db);
    expect(stored.get(101)).toContain("https://www.instagram.com/username/");
    expect(stored.has(103)).toBe(false);
    const status = await loadSupplierDescriptionStatus(db);
    expect(status.get(103)).toBe("empty");
    expect(await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, MARKER_KEY)).toMatchObject({ value: "2026-11-12T10:00:00.000Z" });
    expect(await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, SNAPSHOT_KEY)).toBeTruthy();
  });

  it("counts row coverage independently of non-empty descriptions (620 rows / 44 empty)", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    const entries: Record<number, Entry> = {};
    for (let id = 1; id <= 620; id++) entries[id] = id <= 44 ? { status: "empty", text: "" } : { status: "ok", text: "Teks." };
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed(entries) });
    const r = await refreshSupplierDescriptions(db, 620, { force: true });
    expect(r).toMatchObject({ status: "refreshed", rows: 620, described: 576 });
    expect((await loadSupplierDescriptions(db)).size).toBe(576);
  });

  it("never writes a success marker when the snapshot persist fails, and keeps last-good", async () => {
    const { db, fx } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({ 101: { status: "ok", text: "Lama." } }) });
    await refreshSupplierDescriptions(db, 1, { force: true });

    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T17:00:00.000Z", parsed: parsed({ 101: { status: "ok", text: "Baru." } }) });
    fx.control.fail = (q) => q.includes("INSERT INTO store_settings") && q.includes("ON CONFLICT");
    const failed = await refreshSupplierDescriptions(db, 1, { force: true });
    fx.control.fail = null;
    expect(failed).toEqual({ status: "kept_last_good", error: "persist_failed" });
    // Marker masih waktu lama, snapshot lama tetap otoritatif (retriable).
    expect(await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, MARKER_KEY)).toMatchObject({ value: "2026-11-12T10:00:00.000Z" });
    expect((await loadSupplierDescriptions(db)).get(101)).toBe("Lama.");
  });

  it("invalidates a stale description when the fresh snapshot explicitly reports empty", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({ 101: { status: "ok", text: "Garansi refill lama." } }) });
    await refreshSupplierDescriptions(db, 1, { force: true });
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T17:00:00.000Z", parsed: parsed({ 101: { status: "empty", text: "" } }) });
    await refreshSupplierDescriptions(db, 1, { force: true });
    expect((await loadSupplierDescriptions(db)).has(101)).toBe(false);
    expect((await loadSupplierDescriptionStatus(db)).get(101)).toBe("empty");
  });

  it("marks oversize text as such and never stores a truncated description", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    const long = "x".repeat(3500);
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({ 101: { status: "oversize", text: long } }) });
    await refreshSupplierDescriptions(db, 1, { force: true });
    expect((await loadSupplierDescriptions(db)).has(101)).toBe(false);
    expect((await loadSupplierDescriptionStatus(db)).get(101)).toBe("oversize");
    const raw = String((await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, SNAPSHOT_KEY))?.value ?? "");
    expect(raw).not.toContain("x".repeat(3000));
  });

  it("throttles <6h and retries after the window", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({ 101: { status: "ok", text: "Teks." } }) });
    await refreshSupplierDescriptions(db, 1, { now: Date.parse("2026-11-12T10:00:00Z") });
    expect((await refreshSupplierDescriptions(db, 1, { now: Date.parse("2026-11-12T15:00:00Z") })).status).toBe("throttled");
    expect(vi.mocked(fetchSupplierDescriptions)).toHaveBeenCalledTimes(1);
    expect((await refreshSupplierDescriptions(db, 1, { now: Date.parse("2026-11-12T16:05:00Z") })).status).toBe("refreshed");
    expect(METADATA_REFRESH_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("keeps last-good when the upstream snapshot fails validation", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({ 101: { status: "ok", text: "Teks lama." } }) });
    await refreshSupplierDescriptions(db, 1, { force: true });
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: false, error: "count_mismatch" });
    expect(await refreshSupplierDescriptions(db, 1, { force: true })).toEqual({ status: "kept_last_good", error: "count_mismatch" });
    expect((await loadSupplierDescriptions(db)).get(101)).toBe("Teks lama.");
  });
});

describe("durable managed queue", () => {
  it("enqueues every delta ID and drains in bounded windows without losing the tail", async () => {
    const { db } = await fixture();
    const ids = Array.from({ length: MANAGED_PER_CALL + 7 }, (_, i) => 500 + i);
    await seedMirror(db, ids);
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    const entries: Record<number, Entry> = {};
    for (const id of ids) entries[id] = { status: "ok", text: "Teks resmi." };
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed(entries) });
    await refreshSupplierDescriptions(db, ids.length, { force: true });

    await enqueueManagedWork(db, ids, []);
    expect(await managedPendingCount(db)).toBe(ids.length);
    const first = await drainManagedWork(db);
    expect(first.processed).toBeTruthy();
    expect(first.remaining).toBe(ids.length - first.processed);
    // Semua sisa dikerjakan window berikutnya; tidak ada yang hilang.
    let guard = 0;
    while ((await managedPendingCount(db)) > 0 && guard++ < 10) await drainManagedWork(db);
    expect(await managedPendingCount(db)).toBe(0);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: ids.length });
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_products WHERE managed='auto'`)).toMatchObject({ n: ids.length });
  });

  it("keeps a failed row pending (retriable) instead of dropping it", async () => {
    const { db, fx } = await fixture();
    await seedMirror(db, [701]);
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({ 701: { status: "ok", text: "Teks." } }) });
    await refreshSupplierDescriptions(db, 1, { force: true });
    await enqueueManagedWork(db, [701], []);
    fx.control.fail = (q) => q.includes("INTO pedia_tiers");
    const failed = await drainManagedWork(db);
    fx.control.fail = null;
    expect(failed.errors.length).toBeGreaterThan(0);
    expect(await managedPendingCount(db)).toBe(1);
    // Retry berhasil dan antrean kosong.
    const retry = await drainManagedWork(db);
    expect(retry.errors).toEqual([]);
    expect(await managedPendingCount(db)).toBe(0);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: 1 });
  });
});

describe("admin bootstrap resync (authenticated, durable)", () => {
  async function adminCookie() {
    const session = await createAdminToken("admin@axvara.tech");
    return `axvara_admin_token=${session.token}; axvara_idle=${await createIdleToken(session.sid)}`;
  }

  it("resync enqueues and drains a bounded window with metadata persisted first", async () => {
    const { db } = await fixture();
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: parsed({}) });
    const proxy = await import("@/lib/pedia/proxy");
    const catalog = Array.from({ length: MANAGED_PER_CALL + 5 }, (_, i) => ({
      service: 101 + i, name: "Instagram Followers Global", category: "Instagram Followers",
      type: "Default", rate: "20000", min: "20", max: "10000", refill: false,
    }));
    vi.mocked(proxy.callPediaProxy).mockImplementation(async (_p, action) => action === "services"
      ? ({ ok: true, status: 200, data: catalog } as never)
      : ({ ok: true, status: 200, data: { balance: "1000", currency: "IDR" } } as never));
    const { POST } = await import("@/app/api/admin/pedia/services/route");
    const cookie = await adminCookie();
    const send = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/admin/pedia/services", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }) as never);

    const first = await send({ action: "resync", supplier: "providersmm" });
    const one = await first.json();
    expect(first.status).toBe(200);
    expect(one.metadata.status).toBe("refreshed");
    expect(one.managed.processed).toBe(MANAGED_PER_CALL);
    expect(one.done).toBe(false);

    const second = await send({ action: "resync", supplier: "providersmm", cursor: MANAGED_PER_CALL });
    const two = await second.json();
    expect(two.done).toBe(true);
    let guard = 0;
    while ((await managedPendingCount(db)) > 0 && guard++ < 5) await drainManagedWork(db);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: catalog.length });
  });

  it("rejects unauthenticated bootstrap and never wipes on upstream failure", async () => {
    const { db } = await fixture();
    const proxy = await import("@/lib/pedia/proxy");
    vi.mocked(proxy.callPediaProxy).mockResolvedValue({ ok: false, kind: "timeout" } as never);
    const { POST } = await import("@/app/api/admin/pedia/services/route");
    const unauth = await POST(new Request("http://localhost/api/admin/pedia/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "resync", supplier: "providersmm" }) }) as never);
    expect(unauth.status).toBe(401);
    const cookie = await adminCookie();
    const res = await POST(new Request("http://localhost/api/admin/pedia/services", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ action: "resync", supplier: "providersmm" }) }) as never);
    expect(res.status).toBe(502);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: 0 });
  });
});
