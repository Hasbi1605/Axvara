// tests/pedia-final-queue.workerd.test.ts — PSMM-FINAL-PATCH A/B (2026-11-12).
// Membuktikan di D1 NATIVE (workerd):
// - enqueue untuk ID YANG SAMA di antara pembacaan cermin dan ack tidak hilang
//   (token generasi + ack CAS), dan ID itu dikerjakan ulang pada drain berikut;
// - ID berbeda yang bersamaan seluruhnya bertahan;
// - `present=0` tidak pernah "dihidupkan kembali" walau urutan add/remove
//   datang tidak berurutan;
// - enqueue-all menulis token untuk SEMUA layanan present (620-an) dalam
//   statement atomik, tanpa mematerialisasi semuanya sekaligus.
import { expect, it } from "vitest";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

async function runtime(script: string) {
  return new Miniflare({
    modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"],
    script, d1Databases: ["DB"],
  });
}

async function bundle(contents: string) {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents },
    bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
    define: { "process.env": JSON.stringify({ PEDIA_MIN_ORDER_RP: "1000" }) },
    plugins: [{ name: "framework-marker", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "framework" }));
      b.onLoad({ filter: /.*/, namespace: "framework" }, () => ({ contents: "" }));
    } }],
  });
  return compiled.outputFiles[0].text;
}

/** DDL dibangun dari test agar quoting aman; mencakup kolom 0117. */
async function prepare(instance: Miniflare, opts: { services?: number[]; present0?: number[] } = {}) {
  const db = await instance.getD1Database("DB");
  await db.exec(
    "CREATE TABLE IF NOT EXISTS store_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  await db.exec(
    "CREATE TABLE IF NOT EXISTS pedia_supplier_services (supplier TEXT NOT NULL, service_id INTEGER NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, type TEXT NOT NULL, rate_idr_per_1k REAL NOT NULL, min_qty INTEGER NOT NULL, max_qty INTEGER NOT NULL, api_refill INTEGER NOT NULL DEFAULT 0, api_cancel INTEGER NOT NULL DEFAULT 0, api_dripfeed INTEGER NOT NULL DEFAULT 0, present INTEGER NOT NULL DEFAULT 1, first_seen_at TEXT, updated_at TEXT, PRIMARY KEY(supplier,service_id))",
  );
  await db.exec(
    "CREATE TABLE IF NOT EXISTS pedia_products (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, platform TEXT NOT NULL, metric TEXT NOT NULL, target_kind TEXT NOT NULL, name TEXT NOT NULL, tagline TEXT, description_md TEXT, checklist_json TEXT NOT NULL DEFAULT '[]', packages_json TEXT NOT NULL DEFAULT '[]', step INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 0, is_featured INTEGER NOT NULL DEFAULT 0, sold_count INTEGER NOT NULL DEFAULT 0, managed TEXT NOT NULL DEFAULT 'curated', created_at TEXT, updated_at TEXT)",
  );
  await db.exec(
    "CREATE TABLE IF NOT EXISTS pedia_tiers (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, tier TEXT NOT NULL DEFAULT 'standar', label_note TEXT, supplier TEXT NOT NULL DEFAULT 'providersmm', supplier_service_id INTEGER NOT NULL, backup_service_id INTEGER, price_group TEXT NOT NULL, markup_pct REAL NOT NULL, min_profit_rp INTEGER NOT NULL, refill_days INTEGER NOT NULL DEFAULT 0, eta_start TEXT, eta_finish TEXT, package_prices_json TEXT NOT NULL DEFAULT '{}', rate_snapshot REAL, is_active INTEGER NOT NULL DEFAULT 0, auto_disabled_reason TEXT, updated_at TEXT, public_name TEXT, description_md TEXT, terms_md TEXT, instructions_md TEXT, recommendation_note TEXT, min_qty_override INTEGER, max_qty_override INTEGER, quantity_step INTEGER NOT NULL DEFAULT 1, target_format TEXT NOT NULL DEFAULT 'url', refill_anchor TEXT NOT NULL DEFAULT 'created', region TEXT NOT NULL DEFAULT 'global', quality TEXT NOT NULL DEFAULT 'standar', speed_note TEXT, drop_risk TEXT NOT NULL DEFAULT 'sedang', is_recommended INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, drop_label TEXT, speed_per_day TEXT, input_kind TEXT, managed TEXT NOT NULL DEFAULT 'curated', managed_snapshot_at TEXT, UNIQUE(product_id, supplier, supplier_service_id))",
  );
  const present = opts.services ?? [];
  const absent = opts.present0 ?? [];
  if (present.length || absent.length) {
    const stmt = db.prepare(
      "INSERT INTO pedia_supplier_services (supplier,service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present) VALUES ('providersmm',?,'Instagram Followers Global [No Refill]','Instagram Followers','Default',20000,20,10000,0,?)",
    );
    await db.batch([...present.map((id) => stmt.bind(id, 1)), ...absent.map((id) => stmt.bind(id, 0))]);
  }
  return db;
}

it("an enqueue between mirror read and ack keeps the new token and is processed next drain", async () => {
  const script = await bundle(`
    import { enqueueManagedWork, drainManagedWork, managedPendingCount } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    export default { async fetch(req, env) {
      const db = createDatabaseAccess(env.DB);
      await enqueueManagedWork(db, [1]);
      // Balapan: enqueue ID yang SAMA untuk generasi baru TEPAT setelah
      // pembacaan cermin, sebelum ack. Hook dipasang lewat proxy queryAll.
      const realQueryAll = db.queryAll;
      let injected = false;
      db.queryAll = async (q, ...p) => {
        const rows = await realQueryAll(q, ...p);
        if (!injected && q.includes('FROM pedia_supplier_services')) {
          injected = true;
          await enqueueManagedWork(db, [1]);
        }
        return rows;
      };
      const first = await drainManagedWork(db, 5);
      const afterFirst = await managedPendingCount(db);
      const second = await drainManagedWork(db, 5);
      const afterSecond = await managedPendingCount(db);
      return Response.json({ injected, first, afterFirst, second, afterSecond });
    }};
  `);
  const mf = await runtime(script);
  try {
    await prepare(mf, { services: [1] });
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as {
      injected: boolean;
      first: { processed: number; remaining: number; errors: string[] };
      afterFirst: number;
      second: { processed: number; remaining: number; errors: string[] };
      afterSecond: number;
    };
    expect(data.injected).toBe(true);
    // Drain pertama memproses, tetapi token generasi baru TIDAK terhapus ack.
    expect(data.first.processed).toBe(1);
    expect(data.afterFirst).toBe(1);
    // Drain berikut mengerjakan token baru lalu ack bersih.
    expect(data.second.processed).toBe(1);
    expect(data.afterSecond).toBe(0);
    expect([...data.first.errors, ...data.second.errors]).toEqual([]);
  } finally { await mf.dispose(); }
}, 60000);

it("concurrent enqueues for different IDs all survive; a present=0 row never revives", async () => {
  const script = await bundle(`
    import { enqueueManagedWork, drainManagedWork, managedPendingCount } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    export default { async fetch(req, env) {
      const db = createDatabaseAccess(env.DB);
      // Snapshot resmi agar ID 1 bisa benar-benar aktif lebih dulu.
      const snapshot = JSON.stringify({ fetched_at: '2026-11-12T10:00:00.000Z', source_url: 'https://providersmm.id/services',
        entries: { '1': { status: 'ok', text: 'Syarat resmi berlaku.' } } });
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_psmm_desc_snapshot',?,datetime('now'))", snapshot);
      await enqueueManagedWork(db, [1]);
      await drainManagedWork(db, 5);
      const before = await db.queryFirst('SELECT is_active FROM pedia_tiers WHERE supplier_service_id=1');
      // Sumber menghilang (present=0), lalu enqueue add & remove datang bersamaan
      // TIDAK berurutan untuk ID yang sama.
      await db.execRun("UPDATE pedia_supplier_services SET present=0 WHERE service_id=1");
      await Promise.all([enqueueManagedWork(db, [2,3,4]), enqueueManagedWork(db, [1,5,6,7]), enqueueManagedWork(db, [1], [1])]);
      const afterEnqueue = await managedPendingCount(db);
      let guard = 0, seen = [];
      while ((await managedPendingCount(db)) > 0 && guard++ < 6) {
        seen.push(await drainManagedWork(db, 4));
      }
      const remaining = await managedPendingCount(db);
      const revived = await db.queryFirst('SELECT is_active,auto_disabled_reason FROM pedia_tiers WHERE supplier_service_id=1');
      return Response.json({ before, afterEnqueue, remaining, errors: seen.flatMap(r => r.errors), revived });
    }};
  `);
  const mf = await runtime(script);
  try {
    // ID 1 present lebih dulu (script menonaktifkannya sendiri); sisanya tidak ada.
    await prepare(mf, { services: [1], present0: [2, 3, 4, 5, 6, 7] });
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as {
      before: { is_active: number } | null;
      afterEnqueue: number; remaining: number; errors: string[];
      revived: { is_active: number; auto_disabled_reason: string } | null;
    };
    // ID 1 sempat AKTIF sebelum sumber hilang — jadi test ini benar-benar
    // membuktikan tidak ada kebangkitan, bukan sekadar tidak pernah aktif.
    expect(data.before).toMatchObject({ is_active: 1 });
    expect(data.afterEnqueue).toBe(7);
    expect(data.remaining).toBe(0);
    expect(data.errors).toEqual([]);
    expect(data.revived).toMatchObject({ is_active: 0, auto_disabled_reason: "service_missing" });
  } finally { await mf.dispose(); }
}, 60000);

it("metadata refresh enqueues ALL present managed IDs (620) atomically and drains a bounded window", async () => {
  const count = 620;
  const script = await bundle(`
    import { enqueueAllManaged, managedPendingCount, drainManagedWork } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    export default { async fetch(req, env) {
      const db = createDatabaseAccess(env.DB);
      const queued = await enqueueAllManaged(db);
      const pending = await managedPendingCount(db);
      const first = await drainManagedWork(db, 20);
      const afterFirst = await managedPendingCount(db);
      return Response.json({ queued, pending, processed: first.processed, afterFirst, errors: first.errors });
    }};
  `);
  const mf = await runtime(script);
  try {
    await prepare(mf, { services: Array.from({ length: count }, (_, i) => 1000 + i) });
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as {
      queued: number; pending: number; processed: number; afterFirst: number; errors: string[];
    };
    // SEMUA 620 present terantrekan (bukan hanya 20 pertama).
    expect(data.queued).toBe(count);
    expect(data.pending).toBe(count);
    // Drain tetap terbatas; ekor tidak hilang.
    expect(data.processed).toBe(20);
    expect(data.afterFirst).toBe(count - 20);
    expect(data.errors).toEqual([]);
  } finally { await mf.dispose(); }
}, 60000);


it("snapshot+enqueue-all+marker commit as one batch: a failing statement rolls back all three", async () => {
  // Snapshot baru, antrean, dan penanda kesegaran WAJIB satu transaksi D1.
  // Trigger membuat INSERT penanda gagal di tengah batch: D1 native harus
  // me-rollback snapshot+antrean juga, sehingga last-good lama tetap utuh
  // (bukan "snapshot baru + penanda lama" yang mematikan seluruh katalog).
  const script = await bundle(`
    import { refreshSupplierDescriptions, loadSupplierSnapshot, managedPendingCount } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    const HTML = '<html><body><table><tbody><tr><td data-filter-table-service-id="1">1</td><td class="service-name">Instagram Followers Global</td><td class="service-description-cell"><div class="desc-content" hidden>Baru V2.</div></td></tr></tbody></table></body></html>';
    export default { async fetch(req, env) {
      const url = new URL(req.url);
      const failLast = url.searchParams.get('failLast') === '1';
      globalThis.fetch = async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      const db = createDatabaseAccess(env.DB);
      // Kondisi awal last-good V1: snapshot + marker + satu token pending lama.
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_psmm_desc_snapshot',?,datetime('now'))", JSON.stringify({ fetched_at: '2026-11-12T10:00:00.000Z', source_url: 'https://providersmm.id/services', entries: { '1': { status: 'ok', text: 'Lama V1.' } } }));
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_psmm_desc_last_at','2026-11-12T10:00:00.000Z',datetime('now'))");
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_pending:1','oldtoken',datetime('now'))");
      if (failLast) {
        await env.DB.prepare("CREATE TRIGGER block_marker BEFORE INSERT ON store_settings WHEN NEW.key='pedia_psmm_desc_last_at' BEGIN SELECT RAISE(ABORT,'injected_marker_failure'); END").run();
      }
      const result = await refreshSupplierDescriptions(db, 1, { force: true });
      const snap = await loadSupplierSnapshot(db);
      const marker = await db.queryFirst("SELECT value FROM store_settings WHERE key='pedia_psmm_desc_last_at'");
      const pending = await db.queryAll("SELECT key,value FROM store_settings WHERE key LIKE 'pedia_pending:%' ORDER BY key");
      return Response.json({ result, version: snap.fetchedAt, text: snap.descriptions.get(1) ?? null, marker, pending, pendingCount: await managedPendingCount(db) });
    }};
  `);
  const mf = await runtime(script);
  try {
    await prepare(mf, { services: [1] });
    const failed = await (await mf.dispatchFetch("http://localhost/?failLast=1")).json() as {
      result: { status: string; error?: string };
      version: string | null; text: string | null; marker: { value: string } | null;
      pending: { key: string; value: string }[]; pendingCount: number;
    };
    expect(failed.result.status).toBe("kept_last_good");
    // Ketiga nilai lama UTUH (tidak ada snapshot baru tanpa penanda).
    expect(failed.version).toBe("2026-11-12T10:00:00.000Z");
    expect(failed.text).toBe("Lama V1.");
    expect(failed.marker).toMatchObject({ value: "2026-11-12T10:00:00.000Z" });
    expect(failed.pending).toEqual([{ key: "pedia_pending:1", value: "oldtoken" }]);
    expect(failed.pendingCount).toBe(1);
  } finally { await mf.dispose(); }
}, 60000);

it("a successful refresh updates snapshot, queue token, and marker together", async () => {
  const script = await bundle(`
    import { refreshSupplierDescriptions, loadSupplierSnapshot, managedPendingCount } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    const HTML = '<html><body><table><tbody><tr><td data-filter-table-service-id="1">1</td><td class="service-name">Instagram Followers Global</td><td class="service-description-cell"><div class="desc-content" hidden>Baru V2.</div></td></tr></tbody></table></body></html>';
    export default { async fetch(req, env) {
      globalThis.fetch = async () => new Response(HTML, { status: 200, headers: { 'content-type': 'text/html' } });
      const db = createDatabaseAccess(env.DB);
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_psmm_desc_snapshot',?,datetime('now'))", JSON.stringify({ fetched_at: '2026-11-12T10:00:00.000Z', source_url: 'https://providersmm.id/services', entries: { '1': { status: 'ok', text: 'Lama V1.' } } }));
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_psmm_desc_last_at','2026-11-12T10:00:00.000Z',datetime('now'))");
      await db.execRun("INSERT INTO store_settings(key,value,updated_at) VALUES ('pedia_pending:1','oldtoken',datetime('now'))");
      const result = await refreshSupplierDescriptions(db, 1, { force: true });
      const snap = await loadSupplierSnapshot(db);
      const marker = await db.queryFirst("SELECT value FROM store_settings WHERE key='pedia_psmm_desc_last_at'");
      const pending = await db.queryAll("SELECT key,value FROM store_settings WHERE key LIKE 'pedia_pending:%' ORDER BY key");
      return Response.json({ result, version: snap.fetchedAt, text: snap.descriptions.get(1) ?? null, marker, pending, pendingCount: await managedPendingCount(db) });
    }};
  `);
  const mf = await runtime(script);
  try {
    await prepare(mf, { services: [1] });
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as {
      result: { status: string; fetchedAt?: string };
      version: string | null; text: string | null; marker: { value: string } | null;
      pending: { key: string; value: string }[]; pendingCount: number;
    };
    expect(data.result.status).toBe("refreshed");
    const version = String(data.result.fetchedAt);
    // Ketiga nilai BARU konsisten satu sama lain.
    expect(data.version).toBe(version);
    expect(data.text).toBe("Baru V2.");
    expect(data.marker).toMatchObject({ value: version });
    expect(data.pendingCount).toBe(1);
    expect(data.pending[0].key).toBe("pedia_pending:1");
    expect(data.pending[0].value).not.toBe("oldtoken");
    expect(data.pending[0].value).toHaveLength(32);
  } finally { await mf.dispose(); }
}, 60000);
