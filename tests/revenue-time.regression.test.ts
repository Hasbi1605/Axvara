// tests/revenue-time.regression.test.ts — Issue #12: ketepatan laporan pendapatan
//
// Temuan audit 7 Sep 2026: revenue hari/bulan memakai `orders.updated_at`
// dalam zona UTC — pengiriman, catatan admin, dan retry notifikasi
// (semuanya UPDATE updated_at) memindahkan pendapatan ke hari/bulan lain.
//
// Perilaku yang seharusnya:
// - Pendapatan memakai WAKTU PEMBAYARAN TETAP (`paid_at`, WIB), ditulis sekali
//   saat transisi lunas dan tidak pernah diubah lagi.
// - Hierarki: ledger paid_at → orders.paid_at → reviewed_at bukti → updated_at.
// - Data lama dibackfill via migrasi 0016 dengan aturan eksplisit.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  currentWibMonthString,
  isSameWibDay,
  isSameWibMonth,
  REVENUE_TZ_OFFSET,
  revenueDateWibSql,
  revenueMonthWibSql,
  revenuePaidAtWibSql,
  todayWibDateString,
} from "@/lib/revenue";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      get: (...p: unknown[]) => Record<string, unknown> | undefined;
      all: (...p: unknown[]) => Record<string, unknown>[];
    };
  };
};

describe("helper zona WIB", () => {
  it("offset kanonis +7 jam dan bucket memakai paid_at hierarki", () => {
    expect(REVENUE_TZ_OFFSET).toBe("+7 hours");
    expect(revenuePaidAtWibSql()).toContain("COALESCE(pt.paid_at, o.paid_at, pp.reviewed_at, o.updated_at)");
    expect(revenuePaidAtWibSql()).toContain("'+7 hours'");
    expect(revenueDateWibSql()).toContain("date(");
    expect(revenueMonthWibSql()).toContain("strftime('%Y-%m'");
  });

  it("hari/bulan WIB dihitung dari UTC+7, bukan UTC server", () => {
    // 2026-09-07 17:30 UTC = 2026-09-08 00:30 WIB → hari/bulan ikut WIB.
    const sundayUtc = new Date("2026-09-07T17:30:00.000Z");
    expect(todayWibDateString(sundayUtc)).toBe("2026-09-08");
    expect(currentWibMonthString(sundayUtc)).toBe("2026-09");
    expect(todayWibDateString(new Date("2026-09-07T16:59:00.000Z"))).toBe("2026-09-07");
  });

  it("bukti SQLite: pembayaran 00:30 WIB masuk hari berikutnya, bukan hari UTC", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE t(paid_at TEXT);`);
    db.exec(`INSERT INTO t VALUES ('2026-09-07T17:30:00.000Z')`);
    const utcDay = db.prepare(`SELECT date(paid_at) AS d FROM t`).get()!;
    const wibDay = db.prepare(`SELECT date(datetime(paid_at, '+7 hours')) AS d FROM t`).get()!;
    expect(String(utcDay.d)).toBe("2026-09-07");
    expect(String(wibDay.d)).toBe("2026-09-08");
  });

  it("pengiriman/notifikasi (updated_at baru) tidak memindahkan bucket WIB", () => {
    const paidAt = Date.parse("2026-09-07T17:30:00.000Z"); // 00:30 WIB 8 Sep
    const laterTouch = Date.parse("2026-09-10T10:00:00.000Z"); // kirim 3 hari kemudian
    expect(isSameWibDay(paidAt, Date.parse("2026-09-08T05:00:00.000Z"))).toBe(true);
    expect(isSameWibMonth(paidAt, Date.parse("2026-09-08T05:00:00.000Z"))).toBe(true);
    // updated_at yang bergerak tidak dipakai — paid_at tetap:
    expect(isSameWibDay(laterTouch, Date.parse("2026-09-08T05:00:00.000Z"))).toBe(false);
  });
});

describe("overview memakai paid_at WIB, bukan updated_at UTC", () => {
  it("query revenue hari/bulan memakai bucket WIB + membandingkan tanggal WIB", () => {
    const src = read("src/app/api/admin/overview/route.ts");
    expect(src).toContain("revenuePaidAtWibSql");
    expect(src).toContain("revenueDateWibSql");
    expect(src).toContain("revenueMonthWibSql");
    expect(src).toContain("todayWibDateString");
    expect(src).not.toContain("date(o.updated_at)=date('now')");
    expect(src).not.toContain("strftime('%Y-%m',o.updated_at)");
  });

  it("respons menandai zona dan rentang agar audit mudah", () => {
    const src = read("src/app/api/admin/overview/route.ts");
    expect(src).toContain('revenue_timezone: "Asia/Jakarta"');
    expect(src).toContain("revenue_from");
    expect(src).toContain("revenue_to");
  });
});

describe("paid_at ditulis sekali dan tak berubah (semua jalur lunas)", () => {
  it("transisi QRIS + manual + bukti memakai COALESCE-guard", () => {
    const db = read("src/lib/db/orders-transition.ts");
    expect(db).toContain("paid_at=COALESCE(paid_at,?,datetime('now'))");
    expect(db).toContain("paid_at=COALESCE(paid_at,datetime('now'))");
    const proofs = read("src/app/api/admin/proofs/[id]/route.ts");
    expect(proofs).toContain("paid_at=COALESCE(paid_at,datetime('now'))");
  });

  it("bukti SQLite: COALESCE-guard mempertahankan waktu pembayaran pertama", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE orders(code TEXT, paid_at TEXT, updated_at TEXT);`);
    db.exec(`INSERT INTO orders VALUES ('AXV-1', '2026-09-07T10:00:00.000Z', '2026-09-07T10:00:00.000Z')`);
    db.exec(`UPDATE orders SET paid_at=COALESCE(paid_at,datetime('now')), updated_at='2026-09-09T10:00:00.000Z' WHERE code='AXV-1'`);
    const row = db.prepare(`SELECT paid_at, updated_at FROM orders WHERE code='AXV-1'`).get()!;
    expect(String(row.paid_at)).toBe("2026-09-07T10:00:00.000Z");
    expect(String(row.updated_at)).toBe("2026-09-09T10:00:00.000Z");
  });
});

describe("skema + backfill data lama", () => {
  it("schema dan migrasi 0016 menambah paid_at + index + backfill eksplisit", () => {
    expect(read("drizzle/schema.sql")).toContain("paid_at TEXT");
    expect(read("drizzle/schema.sql")).toContain("idx_orders_paid_at");
    const migration = read("drizzle/migrations/0016_revenue_paid_at.sql");
    expect(migration).toContain("ADD COLUMN paid_at");
    expect(migration).toContain("payment_transactions");
    expect(migration).toContain("payment_proofs");
    expect(migration).toContain("reviewed_at");
    expect(migration).toContain("paid_at IS NULL");
    expect(migration).toContain("idx_orders_paid_at");
  });

  it("backfill migrasi mengisi paid_at dari ledger/bukti/updated_at sesuai hierarki", () => {
    const migration = read("drizzle/migrations/0016_revenue_paid_at.sql");
    const updates = migration
      .split(/;\s*\n/)
      .map((block) => block.replace(/--[^\n]*\n/g, "").trim())
      .filter((block) => block.startsWith("UPDATE orders"));
    expect(updates.length).toBe(3);
    const db = new DatabaseSync(":memory:");
    db.exec(
      `CREATE TABLE orders(code TEXT, status TEXT, payment_status TEXT, paid_at TEXT, updated_at TEXT);
       CREATE TABLE payment_transactions(order_code TEXT, paid_at TEXT);
       CREATE TABLE payment_proofs(order_code TEXT, status TEXT, reviewed_at TEXT);`,
    );
    db.exec(
      `INSERT INTO orders VALUES
        ('AXV-QRIS','lunas','paid',NULL,'2026-09-05 10:00:00'),
        ('AXV-MANUAL','lunas','paid',NULL,'2026-09-06 10:00:00'),
        ('AXV-LEGACY','lunas','paid',NULL,'2026-09-03 10:00:00'),
        ('AXV-PENDING','pending','unpaid',NULL,'2026-09-04 10:00:00');`,
    );
    db.exec(`INSERT INTO payment_transactions VALUES ('AXV-QRIS','2026-09-01T10:00:00.000Z')`);
    db.exec(`INSERT INTO payment_proofs VALUES ('AXV-MANUAL','approved','2026-09-02 10:00:00')`);
    for (const update of updates) db.exec(update);
    const rows = db.prepare(`SELECT code, paid_at FROM orders ORDER BY code`).all();
    const byCode = Object.fromEntries(rows.map((row) => [String(row.code), row.paid_at]));
    expect(byCode["AXV-QRIS"]).toBe("2026-09-01T10:00:00.000Z");
    expect(byCode["AXV-MANUAL"]).toBe("2026-09-02 10:00:00");
    expect(byCode["AXV-LEGACY"]).toBe("2026-09-03 10:00:00");
    expect(byCode["AXV-PENDING"]).toBeNull();
    // Rerun idempoten: nilai yang sudah terisi tidak tertimpa.
    for (const update of updates) db.exec(update);
    const rerun = db.prepare(`SELECT code, paid_at FROM orders ORDER BY code`).all();
    expect(rerun).toEqual(rows);
  });
});

describe("R9: orders.paid_at kanonis mengalahkan reviewed_at/updated_at", () => {
  it("order lunas manual tanpa ledger memakai paid_at order, bukan reviewed_at", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE orders(code TEXT, paid_at TEXT, updated_at TEXT);
       CREATE TABLE payment_transactions(order_code TEXT, paid_at TEXT);
       CREATE TABLE payment_proofs(order_code TEXT, reviewed_at TEXT);`);
    // Order dibayar 1 Sep (paid_at kanonis), admin review bukti 7 Sep,
    // fulfillment/notifikasi menyentuh updated_at 9 Sep → bucket tetap 1 Sep.
    db.exec(`INSERT INTO orders VALUES ('R9','2026-09-01T10:00:00.000Z','2026-09-09T10:00:00.000Z')`);
    db.exec(`INSERT INTO payment_proofs VALUES ('R9','2026-09-07 10:00:00')`);
    const row = db.prepare(
      `SELECT o.paid_at, ${revenueDateWibSql()} AS reported_day FROM orders o
       LEFT JOIN payment_transactions pt ON pt.order_code=o.code
       LEFT JOIN payment_proofs pp ON pp.order_code=o.code`,
    ).get()!;
    expect(String(row.paid_at)).toBe("2026-09-01T10:00:00.000Z");
    expect(String(row.reported_day)).toBe("2026-09-01");
  });
});
