// src/lib/pedia/metadata-refresh.ts — Orkestrasi metadata auto-catalog
// ProviderSMM (PSMM-P2/P3, 2026-11-12; revisi review-1).
//
// Aturan keras:
// - Snapshot deskripsi ditulis ATOMIK sebagai satu nilai JSON tervalidasi
//   (≤1 MiB) di `store_settings`. Penanda kesegaran (6 jam) HANYA ditulis
//   setelah seluruh snapshot tervalidasi tersimpan; kegagalan apa pun
//   mempertahankan last-good lama sebagai otoritatif dan tetap bisa diulang.
// - Snapshot baru TANPA deskripsi untuk suatu ID menandai ID itu `empty`
//   (invalidasi eksplisit), bukan membiarkan deskripsi lama selamanya.
// - Fetch HANYA dari jalur admin/heartbeat terautentikasi (tidak per pembeli,
//   tidak per batch delta), throttle >6 jam.
// - Materialisasi dikerjakan lewat antrean durable di `store_settings`
//   (`pedia_managed_pending`) sehingga batch > kapasitas per-request tidak
//   hilang: apa pun yang belum selesai tetap pending dan dikerjakan ulang
//   (tanpa memutar ulang awalan yang sudah selesai).

import type { DatabaseAccess } from "@/lib/db-access";
import { materializeManagedCatalog, planManagedService, MANAGED_PER_CALL, type ManagedService } from "@/lib/pedia/auto-catalog";
import { fetchSupplierDescriptions, sanitizeSupplierDescription, DESCRIPTIONS_SOURCE_URL, type ParsedDescriptions } from "@/lib/pedia/supplier-descriptions";
import { PEDIA_SALE_PROVIDER } from "@/lib/pedia/sales-policy";

/** Jendela throttle refresh metadata (ms). */
export const METADATA_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Batas ukuran snapshot JSON tervalidasi (D1 store_settings). */
export const METADATA_SNAPSHOT_MAX_BYTES = 1024 * 1024;
/** Jumlah layanan yang dimaterialisasi per drain (batas statement per request). */
export const MANAGED_DRAIN_PER_CALL = 20;

const REFRESH_MARKER = "pedia_psmm_desc_last_at";
const SNAPSHOT_KEY = "pedia_psmm_desc_snapshot";

export type MetadataRefreshResult =
  | { status: "refreshed"; rows: number; described: number; fetchedAt: string }
  | { status: "throttled"; lastAt: string | null }
  | { status: "kept_last_good"; error: string };

type SnapshotEntry = { status: "ok" | "empty" | "oversize"; text: string };
type Snapshot = { fetched_at: string; source_url: string; entries: Record<string, SnapshotEntry> };

function parseStored(raw: unknown): Snapshot | null {
  try {
    const v = JSON.parse(String(raw ?? ""));
    if (!v || typeof v !== "object" || typeof v.entries !== "object" || !v.entries) return null;
    const entries: Record<string, SnapshotEntry> = {};
    for (const [id, entry] of Object.entries(v.entries as Record<string, unknown>)) {
      if (!/^\d+$/.test(id)) return null;
      const e = entry as Partial<SnapshotEntry>;
      if (!e || !["ok", "empty", "oversize"].includes(String(e.status))) return null;
      if (typeof e.text !== "string") return null;
      entries[id] = { status: e.status as SnapshotEntry["status"], text: e.text };
    }
    if (typeof v.fetched_at !== "string" || typeof v.source_url !== "string") return null;
    return { fetched_at: v.fetched_at, source_url: v.source_url, entries };
  } catch {
    return null;
  }
}

async function readSetting(db: DatabaseAccess, key: string): Promise<string | null> {
  const row = await db.queryFirst(`SELECT value FROM store_settings WHERE key=?`, key).catch(() => null);
  return row?.value == null ? null : String(row.value);
}

async function lastRefreshedAt(db: DatabaseAccess): Promise<number | null> {
  const raw = await readSetting(db, REFRESH_MARKER);
  if (!raw) return null;
  const ms = Date.parse(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Deskripsi last-good yang boleh dipakai menjual: hanya entri `ok` dari
 * snapshot tervalidasi. `empty`/`oversize` tidak pernah muncul → pemanggil
 * fail-closed.
 */
export async function loadSupplierDescriptions(db: DatabaseAccess): Promise<Map<number, string>> {
  return (await loadSupplierSnapshot(db)).descriptions;
}

/** Status per ID pada snapshot tersimpan (diagnostik/admin, bukan untuk jual). */
export async function loadSupplierDescriptionStatus(db: DatabaseAccess): Promise<Map<number, SnapshotEntry["status"]>> {
  return (await loadSupplierSnapshot(db)).statuses;
}

/** Versi snapshot aktif (`fetched_at`) atau null bila belum ada snapshot valid. */
export async function loadSupplierSnapshotVersion(db: DatabaseAccess): Promise<string | null> {
  return (await loadSupplierSnapshot(db)).fetchedAt;
}

/**
 * Baca snapshot ATOMIK sekali untuk deskripsi + status + versi. Versi dipakai
 * gate syarat material: baris auto yang belum direkonsiliasi ke versi ini tidak
 * boleh dijual memakai syarat lama.
 */
export async function loadSupplierSnapshot(db: DatabaseAccess): Promise<{
  descriptions: Map<number, string>;
  statuses: Map<number, SnapshotEntry["status"]>;
  fetchedAt: string | null;
}> {
  const snapshot = parseStored(await readSetting(db, SNAPSHOT_KEY));
  const descriptions = new Map<number, string>();
  const statuses = new Map<number, SnapshotEntry["status"]>();
  if (!snapshot) return { descriptions, statuses, fetchedAt: null };
  for (const [id, entry] of Object.entries(snapshot.entries)) {
    statuses.set(Number(id), entry.status);
    if (entry.status === "ok" && entry.text) descriptions.set(Number(id), entry.text);
  }
  return { descriptions, statuses, fetchedAt: snapshot.fetched_at };
}

function buildSnapshot(parsed: ParsedDescriptions, fetchedAt: string): Snapshot {
  const entries: Record<string, SnapshotEntry> = {};
  for (const id of parsed.ids) {
    const entry = parsed.entries.get(id);
    if (!entry) { entries[String(id)] = { status: "empty", text: "" }; continue; }
    if (entry.status === "oversize") { entries[String(id)] = { status: "oversize", text: "" }; continue; }
    entries[String(id)] = { status: entry.status, text: entry.status === "ok" ? sanitizeSupplierDescription(entry.text) : "" };
  }
  return { fetched_at: fetchedAt, source_url: DESCRIPTIONS_SOURCE_URL, entries };
}

/**
 * Refresh metadata deskripsi bila belum throttle. Satu fetch, satu penulisan
 * snapshot atomik, penanda kesegaran hanya sesudah sukses penuh.
 */
export async function refreshSupplierDescriptions(
  db: DatabaseAccess,
  catalogCount: number,
  options: { force?: boolean; now?: number } = {},
): Promise<MetadataRefreshResult> {
  const now = options.now ?? Date.now();
  if (!options.force) {
    const last = await lastRefreshedAt(db);
    if (last != null && now - last < METADATA_REFRESH_INTERVAL_MS) {
      return { status: "throttled", lastAt: new Date(last).toISOString() };
    }
  }
  const fetched = await fetchSupplierDescriptions(catalogCount);
  if (!fetched.ok) return { status: "kept_last_good", error: fetched.error };
  const snapshot = buildSnapshot(fetched.parsed, fetched.fetchedAt);
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).byteLength > METADATA_SNAPSHOT_MAX_BYTES) {
    // Jangan pernah membuang/memotong baris material: tolak snapshot.
    return { status: "kept_last_good", error: "snapshot_too_large" };
  }
  // PSMM-LASTGOOD-PAUSE A: snapshot baru, antrean materialisasi semua layanan
  // present, dan penanda kesegaran WAJIB menjadi SATU transaksi D1. Bila salah
  // satu gagal, last-good lama (snapshot + penanda + antrean) tetap otoritatif —
  // bukan snapshot baru dengan penanda lama (itu menggagalkan version gate
  // seluruh katalog). Tanpa D1 native tidak ada atomisitas → fail closed.
  try {
    await commitSnapshotAtomically(db, serialized, fetched.fetchedAt);
  } catch {
    return { status: "kept_last_good", error: "persist_failed" };
  }
  const described = Object.values(snapshot.entries).filter((e) => e.status === "ok").length;
  return { status: "refreshed", rows: fetched.parsed.ids.size, described, fetchedAt: fetched.fetchedAt };
}

/**
 * Commit snapshot + enqueue-all + marker sebagai satu `batch` D1 (transaksi
 * atomik: semua atau tidak sama sekali). Urutan dalam batch tidak penting untuk
 * atomisitas; dipertahankan snapshot → antrean → penanda agar mudah dibaca.
 * Kegagalan salah satu statement menggagalkan seluruh batch (D1 me-rollback).
 */
async function commitSnapshotAtomically(db: DatabaseAccess, snapshotJson: string, fetchedAt: string): Promise<void> {
  const d1 = db.d1;
  if (!d1) throw new Error("atomic_batch_unavailable");
  const statement = (sql: string, ...params: unknown[]) => d1.prepare(sql).bind(...params);
  await d1.batch([
    statement(
      `INSERT INTO store_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      SNAPSHOT_KEY, snapshotJson,
    ),
    statement(
      `INSERT INTO store_settings (key,value,updated_at)
       SELECT ? || s.service_id, lower(hex(randomblob(16))), datetime('now')
         FROM pedia_supplier_services s
        WHERE s.supplier=? AND s.present=1
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      PENDING_PREFIX, PEDIA_SALE_PROVIDER,
    ),
    statement(
      `INSERT INTO store_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,
      REFRESH_MARKER, fetchedAt,
    ),
  ]);
}

// ── Antrean materialisasi durable ───────────────────────────────────────────
//
// PSMM-FINAL-PATCH A: SATU baris per layanan (`pedia_pending:<id>`) berisi
// TOKEN GENERASI acak. Enqueue = upsert token baru; drain membaca {id, token}
// lalu meng-ack `DELETE ... WHERE key=? AND value=?` (CAS) sehingga enqueue
// untuk ID yang sama di antara pembacaan cermin dan ack TIDAK ikut terhapus.
// "Tambah" vs "hapus" tidak lagi disimpan sebagai dua antrean: drain selalu
// menanyakan kebenaran cermin terkini (`present`), jadi urutan add/remove yang
// datang tidak berurutan tidak pernah menghidupkan layanan `present=0`.

const PENDING_PREFIX = "pedia_pending:";
const pendingKey = (id: number) => `${PENDING_PREFIX}${id}`;

export type DrainResult = { processed: number; remaining: number; errors: string[] };

/**
 * Tambahkan pekerjaan materialisasi secara ATOMIK di DB (satu statement
 * `INSERT…SELECT … json_each`), bukan loop query per ID. Setiap ID mendapat
 * token generasi baru — enqueue ulang setelah snapshot berubah selalu
 * menang atas token lama. ID unik divalidasi di SQL (`j.type='integer'`).
 */
export async function enqueueManagedWork(db: DatabaseAccess, ids: number[], removed: number[] = []): Promise<void> {
  const clean = (arr: number[]) => [...new Set(arr.filter((n) => Number.isSafeInteger(n) && n > 0 && (n as unknown) !== null))];
  // `removed` kini hanya menandai "rekonsiliasi ID ini"; keputusan aktif/hapus
  // diambil drain dari `present` cermin. Union mencegah kehilangan sisi mana pun.
  const all = clean([...ids, ...removed]);
  if (!all.length) return;
  // Kegagalan WAJIB naik ke pemanggil (tidak di-ack).
  await db.execRun(
    `INSERT INTO store_settings (key,value,updated_at)
     SELECT ? || j.value, lower(hex(randomblob(16))), datetime('now') FROM json_each(?) AS j
      WHERE j.type='integer' AND j.value>0
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    PENDING_PREFIX, JSON.stringify(all),
  );
}

/** Pasangan {id, token} pending saat ini (bounded), tanpa filter status. */
async function listPending(db: DatabaseAccess, limit: number): Promise<{ id: number; token: string }[]> {
  const rows = await db.queryAll(
    `SELECT key,value FROM store_settings WHERE key LIKE ? ORDER BY key LIMIT ?`, `${PENDING_PREFIX}%`, limit,
  );
  return rows
    .map((r) => ({ id: Number(String(r.key).slice(PENDING_PREFIX.length)), token: String(r.value ?? "") }))
    .filter((p) => Number.isSafeInteger(p.id) && p.id > 0);
}

/** Hapus TEPAT generasi yang dibaca; token baru (enqueue balapan) bertahan. */
async function ackPending(db: DatabaseAccess, id: number, token: string): Promise<void> {
  await db.execRun(`DELETE FROM store_settings WHERE key=? AND value=?`, pendingKey(id), token);
}

/**
 * Kuras sebagian antrean (bounded). Kegagalan query/tulis diteruskan sebagai
 * `errors` (tidak pernah dianggap "selesai diam-diam"); baris yang belum
 * di-ack tetap pending. `remaining` dihitung ulang dari DB.
 */
export async function drainManagedWork(db: DatabaseAccess, limit = MANAGED_DRAIN_PER_CALL): Promise<DrainResult> {
  const errors: string[] = [];
  const take = await listPending(db, Math.max(1, Math.floor(limit)));
  if (!take.length) return { processed: 0, remaining: 0, errors };
  // Snapshot resmi dibaca SEKALI; versinya ikut dicap agar baris yang baru
  // direkonsiliasi memakai syarat yang sama dengan yang akan dijual.
  const snapshot = await loadSupplierSnapshot(db);
  const ids = take.map((p) => p.id);
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await db.queryAll(
      `SELECT service_id,name,category,type,rate_idr_per_1k,min_qty,max_qty,api_refill,present
         FROM pedia_supplier_services WHERE supplier=? AND service_id IN (${ids.map(() => "?").join(",")})`,
      PEDIA_SALE_PROVIDER, ...ids,
    );
  } catch (e) {
    // B3: kegagalan baca BUKAN "tidak ada baris"; sisa tetap pending.
    errors.push(`mirror_read:${e instanceof Error ? e.message.slice(0, 60) : "failed"}`);
    return { processed: 0, remaining: await managedPendingCount(db), errors };
  }
  const byId = new Map<number, Record<string, unknown>>();
  for (const r of rows) byId.set(Number(r.service_id), r);
  let processed = 0;
  for (const { id, token } of take) {
    const row = byId.get(id);
    try {
      // A: `present=0` (atau hilang) WAJIB dinonaktifkan, bukan dimaterialisasi
      // sebagai aktif. Cermin adalah kebenaran terkini, bukan urutan antrean.
      if (!row || Number(row.present) !== 1) {
        const res = await materializeManagedCatalog(db, [], snapshot.descriptions, [id], undefined, snapshot.fetchedAt);
        if (res.errors.length) { errors.push(`${id}:${res.errors[0]}`); continue; }
      } else {
        const svc: ManagedService = {
          service_id: id,
          name: String(row.name ?? ""), category: String(row.category ?? ""), type: String(row.type ?? ""),
          rate: Number(row.rate_idr_per_1k), min_qty: Number(row.min_qty), max_qty: Number(row.max_qty),
          api_refill: Number(row.api_refill) === 1 ? 1 : 0,
        };
        const result = await materializeManagedCatalog(
          db, [svc], snapshot.descriptions, [], snapshot.statuses, snapshot.fetchedAt,
        );
        if (result.errors.length) { errors.push(`${id}:${result.errors[0]}`); continue; }
      }
      // Ack CAS hanya untuk token yang dibaca; DELETE gagal → tetap pending.
      await ackPending(db, id, token);
      processed++;
    } catch (e) {
      errors.push(`${id}:${e instanceof Error ? e.message.slice(0, 80) : "drain_failed"}`);
    }
  }
  const remaining = await managedPendingCount(db);
  return { processed, remaining, errors };
}

/** Ringkasan antrean (tanpa mengubah). */
export async function managedPendingCount(db: DatabaseAccess): Promise<number> {
  const row = await db.queryFirst(
    `SELECT COUNT(*) AS n FROM store_settings WHERE key LIKE ?`, `${PENDING_PREFIX}%`,
  );
  return Number(row?.n ?? 0);
}

/**
 * Temukan layanan present yang belum punya tier AUTO dan antrekan sebagian
 * (bounded). PSMM-CORE-FIX B4: keberadaan tier KURASI tidak boleh membuat
 * layanan auto dilewati — cek harus khusus `managed='auto'`.
 */
export async function enqueueUnmaterialized(db: DatabaseAccess, limit = MANAGED_DRAIN_PER_CALL): Promise<number> {
  const rows = await db.queryAll(
    `SELECT s.service_id FROM pedia_supplier_services s
      WHERE s.supplier=? AND s.present=1
        AND NOT EXISTS (SELECT 1 FROM pedia_tiers t
                         WHERE t.supplier=s.supplier AND t.supplier_service_id=s.service_id AND t.managed='auto')
      ORDER BY s.service_id LIMIT ?`,
    PEDIA_SALE_PROVIDER, Math.max(1, Math.floor(limit)),
  );
  const ids = rows.map((r) => Number(r.service_id)).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (ids.length) await enqueueManagedWork(db, ids, []);
  return ids.length;
}

/**
 * PSMM-CORE-FIX B4 + FINAL-PATCH B: setelah snapshot deskripsi baru tersimpan,
 * SEMUA layanan present (620-an) harus direncanakan ulang — bukan hanya 20
 * pertama. Satu statement `INSERT…SELECT` menulis token untuk SETIAP ID present
 * di DB (tanpa mematerialisasi semuanya sekaligus); drain tetap dibatasi per
 * request sehingga ekor antrean tidak hilang. Kegagalan tulis diteruskan.
 */
export async function enqueueAllManaged(db: DatabaseAccess): Promise<number> {
  const result = await db.execRun(
    `INSERT INTO store_settings (key,value,updated_at)
     SELECT ? || s.service_id, lower(hex(randomblob(16))), datetime('now')
       FROM pedia_supplier_services s
      WHERE s.supplier=? AND s.present=1
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    PENDING_PREFIX, PEDIA_SALE_PROVIDER,
  );
  return Number(result.changes ?? 0);
}

/** Materialisasi sinkron satu jendela resync admin (tetap dibatasi budget). */
export async function applyProviderCatalogChunk(
  db: DatabaseAccess,
  services: ManagedService[],
  removed: number[],
): Promise<{ managed: DrainResult }> {
  await enqueueManagedWork(db, services.map((s) => s.service_id), removed);
  const drained = await drainManagedWork(db, MANAGED_PER_CALL);
  return { managed: drained };
}

/** Dipakai rencana materialisasi untuk diagnosa admin. */
export { planManagedService };
