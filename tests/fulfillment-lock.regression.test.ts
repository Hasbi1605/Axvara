// tests/fulfillment-lock.regression.test.ts — Issue #7: kunci pengiriman kedaluwarsa
//
// Audit 7 Sep 2026: locked_until ISO (toISOString) dibandingkan langsung
// dengan datetime('now') (space-separated). 'T' > ' ', sehingga lock 60 detik
// yang kedaluwarsa tidak pernah cocok → tertahan berjam-jam. datetime()
// menormalkan kedua format ke domain yang sama.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
// deliver.ts kini barrel; logika lock pindah ke delivery/*. Gabungkan seluruh
// modul delivery agar assertion "gerbang lock ternormalisasi" tetap menilai
// implementasi sebenarnya, bukan barrel kosong (refactor 2026-09-09).
const readDelivery = (): string => {
  const dir = path.join(process.cwd(), "src/lib/fulfillment/delivery");
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
};

type SqliteStatement = {
  run: (...p: unknown[]) => void;
  get: (...p: unknown[]) => Record<string, unknown> | undefined;
  all: (...p: unknown[]) => Record<string, unknown>[];
};
type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => SqliteDatabase;
};

function lockTable(db: SqliteDatabase) {
  db.exec(`CREATE TABLE t(id INT, status TEXT, locked_until TEXT, next_attempt_at TEXT);`);
}

describe("lock expiry lintas format waktu (reproduksi bug #7)", () => {
  it("bug lama: lock ISO kedaluwarsa tidak cocok dengan perbandingan mentah", () => {
    const db = new DatabaseSync(":memory:");
    lockTable(db);
    db.prepare("INSERT INTO t VALUES (?,?,?,?)").run(1, "sending", "2026-09-07T09:00:00.000Z", "2026-09-07T09:00:00.000Z");
    const buggy = db.prepare("SELECT (locked_until < '2026-09-07 09:01:00') AS c FROM t WHERE id=1").get()!;
    expect(Number(buggy.c)).toBe(0); // bug: lock kedaluwarsa tak pulih
    const fixed = db.prepare("SELECT (datetime(locked_until) < datetime('2026-09-07 09:01:00')) AS c FROM t WHERE id=1").get()!;
    expect(Number(fixed.c)).toBe(1); // fix: pulih sesuai waktu
  });

  it("lock aktif tidak direbut dalam kedua format (ISO + space + pergantian hari)", () => {
    const db = new DatabaseSync(":memory:");
    lockTable(db);
    // ISO aktif: 09:06 vs now 09:01 → jangan rebut.
    db.prepare("INSERT INTO t VALUES (?,?,?,?)").run(1, "sending", "2026-09-07T09:06:00.000Z", "2026-09-07T09:00:00.000Z");
    // Space kedaluwarsa lintas hari: 08 23:59 vs now 09-07 00:00 → rebut.
    db.prepare("INSERT INTO t VALUES (?,?,?,?)").run(2, "sending", "2026-09-06 23:59:00", "2026-09-06 23:59:00");
    // ISO tanpa millis kedaluwarsa.
    db.prepare("INSERT INTO t VALUES (?,?,?,?)").run(3, "sending", "2026-09-07T09:00:30Z", "2026-09-07T09:00:30Z");
    const rows = db.prepare("SELECT id, (datetime(locked_until) < datetime('2026-09-07 09:01:00')) AS expired FROM t ORDER BY id").all();
    expect(rows.map((r) => Number(r.expired))).toEqual([0, 1, 1]);
  });

  it("retry tidak menyebabkan pengiriman bersamaan (CAS claim)", () => {
    const db = new DatabaseSync(":memory:");
    lockTable(db);
    db.prepare("INSERT INTO t VALUES (?,?,?,?)").run(1, "queued", null!, "2026-09-07T09:00:00.000Z");
    // Worker A menang.
    db.exec(`UPDATE t SET status='sending', locked_until='2026-09-07T09:02:00.000Z' WHERE id=1 AND status IN ('queued','retry') AND (locked_until IS NULL OR datetime(locked_until) < datetime('2026-09-07 09:01:00'))`);
    // Worker B kalah: baris sudah sending + lock aktif.
    const loser = db.prepare("SELECT COUNT(*) AS n FROM t WHERE id=1 AND status IN ('queued','retry') AND (locked_until IS NULL OR datetime(locked_until) < datetime('2026-09-07 09:01:00'))").get()!;
    expect(Number(loser.n)).toBe(0);
  });
});

describe("semua gerbang lock memakai datetime() normalization", () => {
  const src = () => readDelivery();
  it("claimJob, getDueJobs, releaseStaleJobs ternormalisasi; item retry tak digate waktu", () => {
    const s = src();
    expect(s).toContain("datetime(locked_until) < datetime('now')");
    expect(s).not.toMatch(/locked_until < datetime\('now'\)/);
    expect(s).toContain("datetime(fj.locked_until) < datetime('now')");
    expect(s).toContain("datetime(fj.next_attempt_at) <= datetime('now')");
    // Perilaku R2: next_attempt_at hanya mengatur tempo cron (getDueJobs),
    // bukan menghalangi pengiriman item yang penyebab gagalnya sudah
    // diperbaiki — lihat tests/fulfillment-delivery.integration.test.ts.
    expect(s).not.toContain("AND datetime(next_attempt_at) <= datetime('now')");
  });
  it("in-memory fallback memakai Date komparasi (bukan string)", () => {
    const s = src();
    expect(s).toContain("new Date(String(job.locked_until)) < now");
    expect(s).toContain("new Date(String(row.locked_until)) < now");
  });
});
