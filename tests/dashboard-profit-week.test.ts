// tests/dashboard-profit-week.test.ts — Dashboard Fase 1 (2026-10-07).
//
// Minggu bisnis = Senin–Minggu WIB; Untung Produk = omzet − modal supplier
// (link WR/SK saat order lunas) − modal manual varian (0058). Label jujur:
// belum termasuk biaya operasional.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import {
  isSameWibWeek,
  revenueWeekWibSql,
  weekWibStartDateString,
} from "@/lib/revenue";
import { fillDailySeries, topProfitByItems } from "@/lib/dashboard-profit";

const read = (file: string) => fs.readFileSync(file, "utf8");
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

describe("minggu WIB Senin-start", () => {
  it("weekWibStartDateString mundur ke Senin terdekat", () => {
    // Min 4 Okt 2026 = Minggu → Senin 29 Sep.
    expect(weekWibStartDateString(new Date("2026-10-04T10:00:00.000Z"))).toBe("2026-09-28");
    // Sen 5 Okt 07:00 WIB (Min 4 Okt 24:00 UTC) → 5 Okt.
    expect(weekWibStartDateString(new Date("2026-10-04T17:00:00.000Z"))).toBe("2026-10-05");
    // Rab 7 Okt → Senin 5 Okt.
    expect(weekWibStartDateString(new Date("2026-10-07T10:00:00.000Z"))).toBe("2026-10-05");
    // Sab 10 Okt 23:59 WIB → Senin 5 Okt (belum ganti minggu).
    expect(weekWibStartDateString(new Date("2026-10-10T16:59:00.000Z"))).toBe("2026-10-05");
  });

  it("isSameWibWeek: Sabtu & Senin beda minggu, Senin & Minggu sama", () => {
    const mon = Date.parse("2026-10-05T01:00:00.000Z"); // Sen 08:00 WIB
    const sun = Date.parse("2026-10-11T10:00:00.000Z"); // Min 17:00 WIB
    const satPrev = Date.parse("2026-10-03T10:00:00.000Z"); // Sab 17:00 WIB
    expect(isSameWibWeek(mon, sun)).toBe(true);
    expect(isSameWibWeek(mon, satPrev)).toBe(false);
  });

  it("bukti SQLite: revenueWeekWibSql mengelompokkan Sen–Min yang sama", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE t(paid_at TEXT);`);
    db.exec(`INSERT INTO t VALUES
      ('2026-10-04T17:00:00.000Z'),
      ('2026-10-07T10:00:00.000Z'),
      ('2026-10-11T16:59:00.000Z'),
      ('2026-10-03T10:00:00.000Z')`);
    // Rumus minggu yang sama dipakai revenueWeekWibSql (Senin-start):
    // date(paid,'+7 hours','-' || ((strftime('%w',...)+6)%7) || ' days').
    const paid = `datetime(paid_at, '+7 hours')`;
    const rows = db.prepare(
      `SELECT date(${paid}, '-' || ((CAST(strftime('%w', ${paid}) AS INTEGER) + 6) % 7) || ' days') AS w,
        COUNT(*) n FROM t GROUP BY w ORDER BY w`,
    ).all();
    expect(revenueWeekWibSql()).toContain("strftime('%w'");
    expect(rows).toEqual([
      { w: "2026-09-28", n: 1 },
      { w: "2026-10-05", n: 3 },
    ]);
  });

  it("overview memakai bucket minggu + menandai zona", () => {
    const src = read("src/app/api/admin/overview/route.ts");
    expect(src).toContain("revenueWeekWibSql");
    expect(src).toContain("weekWibStartDateString");
    expect(src).toContain("revenue_week");
    expect(src).toContain("orders_week");
  });
});

describe("modal manual 0058 milik admin", () => {
  it("migrasi menambah manual_cost default 0 + CHECK, schema ikut", () => {
    const sql = read("drizzle/migrations/0058_variant_manual_cost.sql");
    expect(sql).toContain("ADD COLUMN manual_cost");
    expect(sql).toContain("DEFAULT 0");
    expect(sql).toContain("CHECK (manual_cost >= 0)");
    expect(read("drizzle/schema.sql")).toContain("manual_cost INTEGER NOT NULL DEFAULT 0");
  });

  it("migrasi jalan di DB + CHECK menolak negatif", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE product_variants(id INTEGER PRIMARY KEY, price INTEGER NOT NULL);`);
    db.exec(read("drizzle/migrations/0058_variant_manual_cost.sql"));
    db.exec(`INSERT INTO product_variants(id, price) VALUES (1, 50000)`);
    const row = db.prepare(`SELECT manual_cost m FROM product_variants WHERE id=1`).get()!;
    expect(Number(row.m)).toBe(0);
    expect(() => db.prepare(`UPDATE product_variants SET manual_cost=-1 WHERE id=1`).get()).toThrow();
  });

  it("manual_cost milik admin: tak masuk WR_OWNED, sync tak menyentuh", () => {
    const ownership = read("src/lib/warung-rebahan/ownership.ts");
    expect(ownership).toContain("manual_cost");
    // Blok array WR_OWNED_VARIANT_FIELDS berakhir di "] as const" pertama
    // setelah deklarasinya — manual_cost hanya boleh di komentar, bukan array.
    const fieldsStart = ownership.indexOf("export const WR_OWNED_VARIANT_FIELDS");
    const fieldsEnd = ownership.indexOf("] as const", fieldsStart);
    expect(ownership.slice(fieldsStart, fieldsEnd)).not.toContain("manual_cost");
    expect(read("src/lib/warung-rebahan/sync.ts")).not.toContain("manual_cost");
    expect(read("src/lib/sekalipay/sync.ts")).not.toContain("manual_cost");
  });

  it("jalur tulis varian menyimpan manual_cost", () => {
    expect(read("src/app/api/products/[id]/route.ts")).toContain("manual_cost");
    expect(read("src/app/api/products/route.ts")).toContain("manual_cost");
    expect(read("src/app/api/admin/variants/route.ts")).toContain("manual_cost");
    expect(read("src/components/admin/sections/ProductVariantRows.tsx")).toContain("manual_cost");
    expect(read("src/components/admin/sections/SingleVariantFields.tsx")).toContain("manual_cost");
  });
});

describe("agregat untung overview (murni, tanpa D1)", () => {
  it("topProfitByItems mengalokasikan modal proporsional + top 5", () => {
    const rows = [
      { items: JSON.stringify([{ name: "A", price: 80000, qty: 1 }, { name: "B", price: 20000, qty: 1 }]), revenue: 100000, supplier_cost: 50000 },
      { items: JSON.stringify([{ name: "A", price: 80000, qty: 1 }]), revenue: 80000, supplier_cost: 40000 },
    ];
    const top = topProfitByItems(rows);
    expect(top[0].name).toBe("A");
    // A: 80% x 50rb + 40rb = 80rb modal; omzet 80rb + 80rb = 160rb.
    expect(top[0].revenue).toBe(160000);
    expect(top[0].cost).toBe(80000);
    expect(top[0].profit).toBe(80000);
    expect(top[1].name).toBe("B");
    expect(top[1].profit).toBe(10000);
  });

  it("fillDailySeries mengisi tanggal kosong + 30 hari", () => {
    const series = fillDailySeries(
      [{ date: "2026-10-07", orders: 2, revenue: 100000, cost: 60000, profit: 40000 }],
      new Date("2026-10-07T10:00:00.000Z"),
    );
    expect(series).toHaveLength(30);
    expect(series[29]).toMatchObject({ date: "2026-10-07", orders: 2, profit: 40000 });
    expect(series[28]).toMatchObject({ date: "2026-10-06", orders: 0, profit: 0 });
    expect(series[0].date).toBe("2026-09-08");
  });
});

describe("kontrak respons overview Fase 1", () => {
  it("route + tipe admin membawa week/cost/profit/supplier/channel/series", () => {
    const route = read("src/app/api/admin/overview/route.ts");
    for (const key of ["profit_today", "profit_week", "profit_month", "profit_total", "cost_today", "cost_total", "profit_by_supplier", "top_profit_products", "profit_by_channel", "daily_series", "profit_estimated_orders", "orders_today"]) {
      expect(route).toContain(key);
    }
    const ui = read("src/components/admin/AdminOverview.tsx");
    for (const label of ["Untung Produk", "Minggu ini", "Untung per supplier", "Top 5 penyumbang untung", "Untung per channel", "Omzet vs Untung"]) {
      expect(ui).toContain(label);
    }
    // 3 card legacy + teks rumus terhapus dari Ringkasan (2026-10-07).
    for (const gone of ["Perlu tindakan", "Kinerja toko", "Kesehatan sistem", "Belum termasuk biaya operasional"]) {
      expect(ui).not.toContain(gone);
    }
  });
});
