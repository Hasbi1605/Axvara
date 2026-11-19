// Migration 0144 mirrors drizzle/schema.sql and parses/applies cleanly in D1.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";

const migration = fs.readFileSync("drizzle/migrations/0144_telegram_restock_alerts.sql", "utf8");
const schema = fs.readFileSync("drizzle/schema.sql", "utf8");

const tableBlock = (sql: string) => sql.match(/CREATE TABLE IF NOT EXISTS telegram_restock_alerts \([\s\S]*?\n\);/)?.[0];
const indexBlock = (sql: string) => sql.match(/CREATE INDEX IF NOT EXISTS idx_telegram_restock_alerts_status[\s\S]*?;/)?.[0];

describe("migrasi 0144 — telegram_restock_alerts", () => {
  it("table body and indexes are identical to drizzle/schema.sql", () => {
    expect(tableBlock(migration)).toBeTruthy();
    expect(tableBlock(migration)).toBe(tableBlock(schema));
    expect(indexBlock(migration)).toBe(indexBlock(schema));
    expect(schema).toContain("CREATE INDEX IF NOT EXISTS idx_telegram_restock_alerts_user");
  });

  it("is forward-only CREATE TABLE/INDEX IF NOT EXISTS (no destructive DDL)", () => {
    expect(migration).not.toMatch(/DROP TABLE|ALTER TABLE|DELETE FROM|DROP INDEX/i);
    expect((migration.match(/CREATE TABLE/gi) ?? []).length).toBe(1);
  });

  it("applies + re-applies and enforces the UNIQUE(user_id, product_id) idempotency", () => {
    const f = createD1Fixture();
    try {
      f.sql.exec(migration);
      f.sql.exec(migration);
      f.sql.prepare("INSERT INTO telegram_restock_alerts (user_id, product_id) VALUES ('1', 5)").run();
      // Duplicate tap must not create a second row.
      const dup = f.sql.prepare(`INSERT INTO telegram_restock_alerts (user_id, product_id) VALUES ('1', 5)
        ON CONFLICT(user_id, product_id) DO UPDATE SET status='pending'`).run();
      expect(Number(dup.changes)).toBeGreaterThanOrEqual(0);
      expect(f.sql.prepare("SELECT COUNT(*) n FROM telegram_restock_alerts").get()?.n).toBe(1);
      // CHECK constraint rejects unknown status.
      expect(() => f.sql.prepare("UPDATE telegram_restock_alerts SET status='bogus'").run()).toThrow();
    } finally {
      f.close();
    }
  });

  it("D1/workerd parses and applies 0144 cleanly", async () => {
    const runtime = new Miniflare({
      modules: true,
      compatibilityDate: "2024-11-01",
      d1Databases: ["DB"],
      script: 'export default {fetch(){return new Response("ok")}}',
    });
    try {
      const db = await runtime.getD1Database("DB");
      const statements = migration
        .replace(/^--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (let run = 0; run < 2; run++) {
        await db.batch(statements.map((sql) => db.prepare(sql)));
      }
      const res = await db.prepare("SELECT COUNT(*) AS n FROM telegram_restock_alerts").first();
      expect(res?.n).toBe(0);
    } finally {
      await runtime.dispose();
    }
  }, 30000);
});
