// tests/pedia-core-fix.workerd.test.ts — PSMM-CORE-FIX B3 (2026-11-12).
// Membuktikan antrean durable di D1 NATIVE (workerd): enqueue/drain bersamaan
// tidak kehilangan ID, dan ack tidak menghapus pekerjaan baru.
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

/** DDL dibuat dari test (bukan string worker) agar quoting aman. */
async function prepare(instance: Miniflare) {
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
  return db;
}

it("concurrent enqueue + drain on native D1 never loses an ID and never over-acks", async () => {
  const script = await bundle(`
    import { enqueueManagedWork, drainManagedWork, managedPendingCount } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    export default { async fetch(req, env) {
      const db = createDatabaseAccess(env.DB);
      await Promise.all([
        enqueueManagedWork(db, [1,2,3]),
        enqueueManagedWork(db, [3,4,5]),
        enqueueManagedWork(db, [6,7]),
        enqueueManagedWork(db, [8]),
      ]);
      const afterEnqueue = await managedPendingCount(db);
      const [r1, r2] = await Promise.all([drainManagedWork(db, 5), drainManagedWork(db, 5)]);
      const afterConcurrent = await managedPendingCount(db);
      // Tidak ada ID yang HILANG: sisa dikuras pada putaran berikutnya.
      const seen = [r1, r2];
      for (let i = 0; i < 4; i++) { const r = await drainManagedWork(db, 5); seen.push(r); if (r.remaining === 0) break; }
      const remaining = await managedPendingCount(db);
      return Response.json({
        afterEnqueue, afterConcurrent, remaining,
        maxProcessed: Math.max(r1.processed, r2.processed),
        errors: seen.flatMap((r) => r.errors),
      });
    }};
  `);
  const mf = await runtime(script);
  try {
    await prepare(mf);
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as {
      afterEnqueue: number; afterConcurrent: number; remaining: number; maxProcessed: number; errors: string[];
    };
    // Semua 8 ID ter-enqueue walau 4 enqueue bersamaan (tidak ada yang tertimpa).
    expect(data.afterEnqueue).toBe(8);
    expect(data.errors).toEqual([]);
    // Dua drain bersamaan memproses subset, dan sisa tetap tersedia (tidak hilang).
    expect(data.maxProcessed).toBe(5);
    expect(data.afterConcurrent).toBe(3);
    // Setelah putaran lanjutan, antrean tuntas.
    expect(data.remaining).toBe(0);
  } finally { await mf.dispose(); }
}, 60000);

it("a batch larger than the window drains fully in native D1 with removals preserved", async () => {
  const script = await bundle(`
    import { enqueueManagedWork, drainManagedWork, managedPendingCount } from './src/lib/pedia/metadata-refresh';
    import { createDatabaseAccess } from './src/lib/db-access';
    export default { async fetch(req, env) {
      const db = createDatabaseAccess(env.DB);
      const ids = Array.from({ length: 33 }, (_, i) => 1000 + i);
      await enqueueManagedWork(db, ids.slice(0, 30), ids.slice(30));
      const seen = [];
      for (let i = 0; i < 6; i++) {
        const r = await drainManagedWork(db, 10);
        seen.push({ processed: r.processed, remaining: r.remaining, errors: r.errors.length });
        if (r.remaining === 0) break;
      }
      return Response.json({ finalPending: await managedPendingCount(db), seen });
    }};
  `);
  const mf = await runtime(script);
  try {
    await prepare(mf);
    const data = await (await mf.dispatchFetch("http://localhost/")).json() as { finalPending: number; seen: { processed: number; errors: number }[] };
    expect(data.finalPending).toBe(0);
    expect(data.seen.reduce((n, s) => n + s.processed, 0)).toBe(33);
    expect(data.seen.every((s) => s.errors === 0)).toBe(true);
  } finally { await mf.dispose(); }
}, 60000);
