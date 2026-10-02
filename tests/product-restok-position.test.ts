import { describe, expect, it } from "vitest";
import {
  reinsertionKey,
  sortProductsForDisplay,
} from "@/lib/product-order";
import { maybeReinsertRestockedProduct } from "@/lib/restock-reinsert";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

// Restok kembali ke sekitar posisi semula (2026-10-02, keputusan owner):
// produk yang habis lalu restok tidak boleh terdampar di ekor bucket ready.

describe("reinsertionKey: selip kembali ke sekitar posisi semula", () => {
  it("slot lama kosong → key dipertahankan (tanpa write)", () => {
    // Tetangga 50, key lama 60, tidak ada penyerobot di antaranya.
    expect(reinsertionKey(60, [10, 20, 30, 40, 50, 70, 80])).toBe(60);
  });

  it("slot lama diserobot → tepat di belakang penyerobot (±1-2)", () => {
    // Produk baru menempati 60-61; pendatang key lama 60 selip ke 62.
    expect(reinsertionKey(60, [50, 60, 61, 70])).toBe(62);
  });

  it("tidak menimpa key tetangga yang rapat (60/61 → 62)", () => {
    expect(reinsertionKey(60, [50, 60, 61, 62, 63])).toBe(64);
  });

  it("key lama paling kecil → depan (min - 10, min 0)", () => {
    expect(reinsertionKey(5, [50, 60, 70])).toBe(40);
    // Slot 5 ditempati tetangga → selip tepat di belakangnya (6),
    // bukan depan yang ujug-ujug 0 dan menimpa urutan orang.
    expect(reinsertionKey(5, [5, 8])).toBe(6);
    expect(reinsertionKey(0, [10, 20])).toBe(0);
  });

  it("tanpa tetangga ready → key lama dipertahankan", () => {
    expect(reinsertionKey(60, [])).toBe(60);
  });

  it("input kotor dinormalisasi (NaN/tidak-hingga)", () => {
    expect(reinsertionKey(NaN, [10, 20])).toBe(0);
    expect(reinsertionKey(60, [10, Number.NaN])).toBe(60);
  });
});

describe("restok end-to-end (simulasi urutan tampil)", () => {
  type P = { id: number; stock: number; sortOrder: number; isActive: boolean };
  const names = ["A", "B", "C", "D", "E", "Netflix", "G", "Capcut", "I", "J"];
  const catalog = (): P[] =>
    names.map((_, i) => ({ id: i + 1, stock: 5, sortOrder: (i + 1) * 10, isActive: true }));

  function positionOf(list: P[], id: number): number {
    return sortProductsForDisplay(list).findIndex((p) => p.id === id) + 1;
  }

  it("Netflix posisi 6 habis → restok → kembali 6-8, bukan ekor", () => {
    const list = catalog();
    // Netflix id 6 di posisi 6, Capcut id 8 di posisi 8.
    expect(positionOf(list, 6)).toBe(6);
    expect(positionOf(list, 8)).toBe(8);
    // Besoknya: Netflix habis → turun ke bucket habis (posisi 10).
    list.find((p) => p.id === 6)!.stock = 0;
    expect(positionOf(list, 6)).toBe(10);
    // Besoknya lagi: restok + selip via reinsertionKey.
    const restocker = list.find((p) => p.id === 6)!;
    restocker.stock = 5;
    const readyKeys = list.filter((p) => p.id !== 6).map((p) => p.sortOrder);
    restocker.sortOrder = reinsertionKey(restocker.sortOrder, readyKeys);
    const pos = positionOf(list, 6);
    expect(pos).toBeGreaterThanOrEqual(6);
    expect(pos).toBeLessThanOrEqual(8);
  });

  it("produk baru di slot lama → pendatang tepat di belakangnya", () => {
    const list = catalog();
    const restocker = list.find((p) => p.id === 6)!;
    restocker.stock = 0;
    // Produk baru diatur manual tepat di key 60 (slot lama Netflix).
    list.push({ id: 99, stock: 5, sortOrder: 60, isActive: true });
    restocker.stock = 5;
    const readyKeys = list.filter((p) => p.id !== 6).map((p) => p.sortOrder);
    restocker.sortOrder = reinsertionKey(restocker.sortOrder, readyKeys);
    // Produk baru tetap di depan (posisi 6), pendatang tepat di belakangnya.
    const ordered = sortProductsForDisplay(list);
    const idxNew = ordered.findIndex((p) => p.id === 99);
    const idxBack = ordered.findIndex((p) => p.id === 6);
    expect(idxBack).toBe(idxNew + 1);
  });

  it("restok 3 sekaligus: stabil, tidak saling injak", () => {
    const list = catalog();
    for (const id of [2, 6, 8]) list.find((p) => p.id === id)!.stock = 0;
    for (const id of [2, 6, 8]) {
      const r = list.find((p) => p.id === id)!;
      r.stock = 5;
      // Selip berurutan: key yang sudah diselip ikut jadi tetangga.
      const readyKeys = list.filter((p) => p.id !== id && p.stock > 0).map((p) => p.sortOrder);
      r.sortOrder = reinsertionKey(r.sortOrder, readyKeys);
    }
    const keys = list.map((p) => p.sortOrder);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of [2, 6, 8]) {
      const pos = positionOf(list, id);
      expect(pos).toBeLessThanOrEqual(10);
    }
  });
});

describe("maybeReinsertRestockedProduct (DB)", () => {
  function seedDb() {
    const fx = createD1Fixture();
    // 5 produk aktif: key 10..50. Produk 3 (key 30) habis.
    for (let i = 1; i <= 5; i++) {
      fx.sql
        .prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,sort_order) VALUES(?,?,?,?,?,?,?)`)
        .run(i, `P${i}`, `p-${i}`, 1000, i === 3 ? 0 : 5, 1, i * 10);
    }
    return fx;
  }

  it("bukan transisi (parentWasEmpty=false) → 0 query tulis, tanpa read", async () => {
    const fx = seedDb();
    try {
      const db = createDatabaseAccess(fx.db);
      const before = fx.control.queries;
      const r = await maybeReinsertRestockedProduct(db, 1, false);
      expect(r.reinserted).toBe(false);
      expect(fx.control.queries).toBe(before);
    } finally {
      fx.close();
    }
  });

  it("transisi tapi masih habis → tanpa write", async () => {
    const fx = seedDb();
    try {
      const db = createDatabaseAccess(fx.db);
      const r = await maybeReinsertRestockedProduct(db, 3, true);
      expect(r.reinserted).toBe(false);
      const row = fx.sql.prepare(`SELECT sort_order FROM products WHERE id=3`).get() as { sort_order: number };
      expect(row.sort_order).toBe(30);
    } finally {
      fx.close();
    }
  });

  it("transisi habis→ready + slot kosong → key dipertahankan (tanpa write key)", async () => {
    const fx = seedDb();
    try {
      // Produk 3 restok (stok parent sudah ditulis sync sebelum helper).
      fx.sql.prepare(`UPDATE products SET stock=5 WHERE id=3`).run();
      const db = createDatabaseAccess(fx.db);
      const r = await maybeReinsertRestockedProduct(db, 3, true);
      // Tetangga 20/40, key lama 30, tidak ada penyerobot → 30 tetap.
      expect(r.reinserted).toBe(false);
      expect(r.newKey).toBe(30);
    } finally {
      fx.close();
    }
  });

  it("transisi + slot diserobot → selip di belakang penyerobot", async () => {
    const fx = seedDb();
    try {
      // Produk baru diatur manual tepat di key 30 (slot lama produk 3).
      fx.sql.prepare(`INSERT INTO products(id,name,slug,price,stock,is_active,sort_order) VALUES(99,'Baru','baru',1000,5,1,30)`).run();
      fx.sql.prepare(`UPDATE products SET stock=5 WHERE id=3`).run();
      const db = createDatabaseAccess(fx.db);
      const r = await maybeReinsertRestockedProduct(db, 3, true);
      expect(r.reinserted).toBe(true);
      expect(r.oldKey).toBe(30);
      // 31 longgar → selip 31 (bukan ekor 60+).
      expect(r.newKey).toBe(31);
      const row = fx.sql.prepare(`SELECT sort_order FROM products WHERE id=3`).get() as { sort_order: number };
      expect(row.sort_order).toBe(31);
    } finally {
      fx.close();
    }
  });

  it("produk nonaktif restok → diam (tidak tampil, selip tidak ada artinya)", async () => {
    const fx = seedDb();
    try {
      fx.sql.prepare(`UPDATE products SET stock=5, is_active=0 WHERE id=3`).run();
      const db = createDatabaseAccess(fx.db);
      const r = await maybeReinsertRestockedProduct(db, 3, true);
      expect(r.reinserted).toBe(false);
    } finally {
      fx.close();
    }
  });
});
