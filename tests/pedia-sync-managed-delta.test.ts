// tests/pedia-sync-managed-delta.test.ts — PSMM-P2 (2026-11-12; revisi review-1).
// BLOCKER #2: delta lebih besar dari kapasitas per-request TIDAK boleh hilang
// atau di-ack. Semua ID masuk antrean durable; kegagalan tulis tidak di-ack;
// baris sisa dikerjakan heartbeat berikut tanpa memutar ulang awalan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { MANAGED_PER_CALL } from "@/lib/pedia/auto-catalog";
import { managedPendingCount, drainManagedWork, loadSupplierDescriptions, MANAGED_DRAIN_PER_CALL } from "@/lib/pedia/metadata-refresh";

// Jam dipaku ke 2026-11-12 supaya jendela throttle 6 jam dihitung dari
// `fetchedAt` fixture (2026-11-12T10:00Z), bukan tanggal berjalan: tanpa ini
// heartbeat "kedua" selalu dianggap lewat 6 jam dan refresh ulang terus
// (mengantrekan lagi seluruh layanan). Hanya `Date` yang di-fake agar
// promise/D1 fixture tetap berjalan normal.
const NOW = new Date("2026-11-12T10:30:00.000Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

vi.mock("@/lib/pedia/supplier-descriptions", async (orig) => {
  const real = await orig<typeof import("@/lib/pedia/supplier-descriptions")>();
  return { ...real, fetchSupplierDescriptions: vi.fn() };
});

const service = (id: number) => ({
  service_id: id, name: "Instagram Followers Global [No Refill]", category: "Instagram Followers",
  type: "Default", rate: 20000, min_qty: 20, max_qty: 10000, api_refill: 0, api_cancel: 0, api_dripfeed: 0,
});

async function seedDescriptions(db: ReturnType<typeof createDatabaseAccess>, ids: number[]) {
  const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
  const entries = new Map(ids.map((id) => [id, { status: "ok" as const, text: "Teks resmi.\nSyarat berlaku." }]));
  vi.mocked(fetchSupplierDescriptions).mockResolvedValue({
    ok: true, fetchedAt: "2026-11-12T10:00:00.000Z",
    parsed: { ids: new Set(ids), entries },
  });
  const { refreshSupplierDescriptions } = await import("@/lib/pedia/metadata-refresh");
  await refreshSupplierDescriptions(db, ids.length, { force: true });
}

function send(body: unknown, token = "test-sync") {
  return new Request("http://x/", { method: "POST", headers: { "x-supplier-sync-token": token }, body: JSON.stringify(body) }) as never;
}

describe("supplier-sync managed delta (no loss, no false ack)", () => {
  it("accepts a delta larger than the per-request window and eventually materializes every row", async () => {
    const fx = createD1Fixture();
    const db = createDatabaseAccess(fx.db);
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const ids = Array.from({ length: MANAGED_PER_CALL * 3 + 4 }, (_, i) => 400 + i);
    await seedDescriptions(db, ids);
    const { POST } = await import("@/app/api/supplier-sync/route");

    const res = await POST(send({ source: "providersmm", services: ids.map(service), removed_service_ids: [] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Satu request hanya menguras sebagian, tetapi SEMUA id sudah diantrekan.
    expect(body.managed.processed).toBe(MANAGED_DRAIN_PER_CALL);
    expect(await managedPendingCount(db)).toBe(ids.length - MANAGED_DRAIN_PER_CALL);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_supplier_services WHERE supplier='providersmm'`)).toMatchObject({ n: ids.length });

    // Heartbeat berikut (delta kosong) melanjutkan; semua baris akhirnya ada.
    let guard = 0;
    while ((await managedPendingCount(db)) > 0 && guard++ < 10) {
      const tick = await POST(send({ source: "providersmm", services: [], removed_service_ids: [] }));
      expect(tick.status).toBe(200);
    }
    expect(await managedPendingCount(db)).toBe(0);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: ids.length });
    // Tidak ada duplikat.
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_products WHERE managed='auto'`)).toMatchObject({ n: ids.length });
  });

  it("does NOT ack a delta whose managed writes fail; retry completes all rows", async () => {
    const fx = createD1Fixture();
    const db = createDatabaseAccess(fx.db);
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const ids = [801, 802, 803];
    await seedDescriptions(db, ids);
    const { POST } = await import("@/app/api/supplier-sync/route");

    fx.control.fail = (q) => q.includes("INTO pedia_tiers");
    const failed = await POST(send({ source: "providersmm", services: ids.map(service), removed_service_ids: [] }));
    fx.control.fail = null;
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false, errors: ["managed_incomplete"] });
    // Semua baris tetap pending (tidak di-ack).
    expect(await managedPendingCount(db)).toBe(ids.length);

    const retry = await POST(send({ source: "providersmm", services: ids.map(service), removed_service_ids: [] }));
    expect(retry.status).toBe(200);
    let guard = 0;
    while ((await managedPendingCount(db)) > 0 && guard++ < 5) await drainManagedWork(db);
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: ids.length });
  });

  it("heartbeat refreshes metadata automatically once the 6h window passes", async () => {
    const fx = createD1Fixture();
    const db = createDatabaseAccess(fx.db);
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    const { POST } = await import("@/app/api/supplier-sync/route");
    // Baris cermin tersimpan dulu (tanpa managed) agar hitungan katalog ada.
    await db.execRun(`INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES ('providersmm',901,'Instagram Followers Global [No Refill]','Instagram Followers','Default',20000,20,10000,0,1)`);

    // Heartbeat pertama: refresh (belum ada marker).
    vi.mocked(fetchSupplierDescriptions).mockResolvedValue({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: { ids: new Set([901]), entries: new Map([[901, { status: "ok" as const, text: "Teks A." }]]) } });
    const first = await POST(send({ source: "providersmm", services: [], removed_service_ids: [] }));
    expect((await first.json()).metadata.status).toBe("refreshed");
    expect((await loadSupplierDescriptions(db)).get(901)).toBe("Teks A.");
    // Layanan baru tanpa resync manual kini otomatis aktif dari heartbeat.
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto'`)).toMatchObject({ n: 1 });

    // Heartbeat kedua dalam jendela throttle: tidak fetch ulang.
    const before = vi.mocked(fetchSupplierDescriptions).mock.calls.length;
    const second = await POST(send({ source: "providersmm", services: [], removed_service_ids: [] }));
    expect((await second.json()).metadata.status).toBe("throttled");
    expect(vi.mocked(fetchSupplierDescriptions).mock.calls.length).toBe(before);
  });

  it("metadata upstream failure on heartbeat preserves last-good and still acks the mirror", async () => {
    const fx = createD1Fixture();
    const db = createDatabaseAccess(fx.db);
    vi.stubEnv("SUPPLIER_SYNC_TOKEN", "test-sync");
    const { fetchSupplierDescriptions } = await import("@/lib/pedia/supplier-descriptions");
    const { refreshSupplierDescriptions } = await import("@/lib/pedia/metadata-refresh");
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: true, fetchedAt: "2026-11-12T10:00:00.000Z", parsed: { ids: new Set([902]), entries: new Map([[902, { status: "ok" as const, text: "Lama." }]]) } });
    await refreshSupplierDescriptions(db, 1, { force: true });
    // Paksa throttle lewat agar heartbeat mencoba fetch.
    await db.execRun(`UPDATE store_settings SET value='2000-01-01T00:00:00.000Z' WHERE key='pedia_psmm_desc_last_at'`);
    vi.mocked(fetchSupplierDescriptions).mockResolvedValueOnce({ ok: false, error: "count_mismatch" });
    const { POST } = await import("@/app/api/supplier-sync/route");
    const res = await POST(send({ source: "providersmm", services: [], removed_service_ids: [] }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.metadata.status).toBe("kept_last_good");
    expect((await loadSupplierDescriptions(db)).get(902)).toBe("Lama.");
  });
});
