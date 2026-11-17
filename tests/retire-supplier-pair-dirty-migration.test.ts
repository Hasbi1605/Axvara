import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

const schemaSql = fs.readFileSync("drizzle/schema.sql", "utf8");
const m0068 = fs.readFileSync("drizzle/migrations/0068_d1_read_budget_phase2.sql", "utf8");
const m0078 = fs.readFileSync("drizzle/migrations/0078_supplier_pair_manual_active.sql", "utf8");
const m0134 = fs.readFileSync("drizzle/migrations/0134_retire_supplier_pair_dirty.sql", "utf8");

describe("0134_retire_supplier_pair_dirty", () => {
  it("schema.sql drops all 14 pair_dirty_* triggers while keeping shim tables", () => {
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS supplier_pair_dirty");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS supplier_pairs");
    expect(schemaSql).not.toMatch(/CREATE TRIGGER\b[^\n]*\bpair_dirty_/i);

    const fx = createD1Fixture();
    try {
      expect(fx.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pair_dirty_%'").all()).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("drops all 14 pair_dirty_* triggers, empties supplier_pair_dirty, and is idempotent", () => {
    const fx = createD1Fixture();
    try {
      // Simulate pre-0134 production state with all 14 triggers (13 from 0068 + 1 from 0078)
      // and legacy supplier_pairs + supplier_pair_dirty rows.
      const triggersSql = [
        ...m0068.matchAll(/CREATE TRIGGER IF NOT EXISTS pair_dirty_[\s\S]*?END;/g),
        ...m0078.matchAll(/CREATE TRIGGER IF NOT EXISTS pair_dirty_[\s\S]*?END;/g),
      ].map((m) => m[0]);
      expect(triggersSql).toHaveLength(14);
      fx.sql.exec(triggersSql.join("\n"));

      fx.sql.exec(`
        INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(101,'WR Prod','wr-prod-101',10000,5,1),(102,'SK Prod','sk-prod-102',10000,5,1);
        INSERT INTO supplier_pairs(id,wr_product_id,sk_product_id) VALUES(999,101,102);
      `);
      // Trigger from 0078/0068 should have populated supplier_pair_dirty before 0134.
      fx.sql.exec("UPDATE products SET is_active=0 WHERE id=101");
      expect(Number(fx.sql.prepare("SELECT COUNT(*) n FROM supplier_pair_dirty").get()?.n)).toBeGreaterThanOrEqual(1);
      expect(fx.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pair_dirty_%'").all()).toHaveLength(14);

      // Apply 0134 twice (idempotent)
      fx.sql.exec(m0134);
      fx.sql.exec(m0134);

      expect(fx.sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pair_dirty_%'").all()).toHaveLength(0);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM supplier_pair_dirty").get()?.n).toBe(0);
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM supplier_pairs WHERE id=999").get()?.n).toBe(1);

      // Mutations on products/variants/pairs no longer write to supplier_pair_dirty
      fx.sql.exec("UPDATE products SET is_active=1 WHERE id=101");
      fx.sql.exec("INSERT INTO products(id,name,slug,price,stock,is_active) VALUES(103,'New','new-p-103',5000,1,1)");
      fx.sql.exec("UPDATE supplier_pairs SET prefer='WR' WHERE id=999");
      expect(fx.sql.prepare("SELECT COUNT(*) n FROM supplier_pair_dirty").get()?.n).toBe(0);
    } finally {
      fx.close();
    }
  });
});
