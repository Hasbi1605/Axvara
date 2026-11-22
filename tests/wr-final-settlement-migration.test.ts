import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import type { D1 } from "@/lib/db/types";
import { createD1Fixture } from "./helpers/d1-fixture";

const predecessor = readFileSync("drizzle/migrations/0153_product_group_member_update_guard.sql", "utf8");
const migration = readFileSync("drizzle/migrations/0154_wr_final_settlement_markers.sql", "utf8");
const markers = [
  { table: "wr_order_links", key: "id", marker: "wr_final_settle_token", index: "idx_wr_final_settle_pending" },
  { table: "orders", key: "code", marker: "wr_aggregate_refresh_token", index: "idx_wr_aggregate_refresh_pending" },
];
const fixtureOrder = `INSERT INTO orders(id,code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,fulfillment_status)
  VALUES(?,?,'Fixture','000','[]',100,'qris','lunas','paid',?)`;
const fixtureLink = `INSERT INTO wr_order_links(id,order_code,wr_variant_id,wr_cost,status,attempt_count,last_error)
  VALUES(?,?,'variant',75,?,3,'fixture')`;
const rows = async (db: D1, sql: string, ...values: unknown[]) =>
  (await db.prepare(sql).bind(...values).all()).results as Record<string, unknown>[];

function removeSnapshotAdditions(sql: ReturnType<typeof createD1Fixture>["sql"]) {
  // Unseeded snapshot → predecessor structure. 0153 is then applied from its file exactly once.
  for (const { table, index, marker } of markers) {
    sql.exec(`DROP INDEX ${index}; ALTER TABLE ${table} DROP COLUMN ${marker}`);
  }
  sql.exec("DROP TRIGGER pg_member_valid_update");
}

async function markerSchema(db: D1) {
  return Promise.all(markers.map(async ({ table, key, marker, index }) => {
    const column = (await rows(db, `PRAGMA table_info(${table})`)).find(row => row.name === marker);
    expect(column).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: "NULL", pk: 0 });
    expect((await rows(db, `PRAGMA index_list(${table})`)).find(row => row.name === index))
      .toMatchObject({ unique: 0, partial: 1 });
    expect(await rows(db, `PRAGMA index_info(${index})`)).toMatchObject([{ name: key }]);
    const [{ sql }] = await rows(db, "SELECT sql FROM sqlite_master WHERE name=?", index);
    expect(String(sql)).toMatch(new RegExp(`WHERE ${marker} IS NOT NULL$`, "i"));
    // Column positions in a historical D1 db need not match snapshot positions.
    return { marker, key, type: column!.type, nullable: column!.notnull, default: column!.dflt_value };
  }));
}

async function seedLegacy(db: D1) {
  await db.batch([
    db.prepare(fixtureOrder).bind(11, "A-failed", "failed"),
    db.prepare(fixtureOrder).bind(12, "B-historical", "delivered"),
    db.prepare(fixtureLink).bind(21, "A-failed", "failed"),
    db.prepare(fixtureLink).bind(22, "B-historical", "completed"),
    db.prepare(`INSERT INTO fulfillment_items(id,order_code,item_index,product_id,status,wr_link_id)
      VALUES(31,'A-failed',0,1,'failed',21)`),
    db.prepare("UPDATE wr_order_links SET fulfillment_item_id=31 WHERE id=21"),
  ]);
}

async function verifyForward(db: D1, migrate: () => Promise<void>) {
  await seedLegacy(db);
  const oldRows = await Promise.all(markers.map(async ({ table, marker }) => {
    expect((await rows(db, `PRAGMA table_info(${table})`)).map(row => row.name)).not.toContain(marker);
    return rows(db, `SELECT * FROM ${table} ORDER BY id`);
  }));
  const oldItems = await rows(db, "SELECT * FROM fulfillment_items");
  await migrate();
  for (const [i, { table, marker }] of markers.entries()) {
    expect(await rows(db, `SELECT * FROM ${table} ORDER BY id`))
      .toEqual(oldRows[i].map(row => ({ ...row, [marker]: null })));
  }
  expect(await rows(db, "SELECT * FROM fulfillment_items")).toEqual(oldItems);

  await db.batch([
    db.prepare(fixtureOrder).bind(13, "C-new", "queued"),
    db.prepare(fixtureLink).bind(23, "C-new", "pending"),
    db.prepare("UPDATE orders SET admin_note=? WHERE id=?").bind("legacy-note", 11),
    db.prepare("UPDATE wr_order_links SET last_error=? WHERE id=?").bind("legacy-error", 21),
  ]);
  expect(await rows(db, "SELECT id,admin_note,wr_aggregate_refresh_token FROM orders WHERE id IN (11,13) ORDER BY id")).toEqual([
    { id: 11, admin_note: "legacy-note", wr_aggregate_refresh_token: null },
    { id: 13, admin_note: null, wr_aggregate_refresh_token: null },
  ]);
  expect(await rows(db, "SELECT id,last_error,wr_final_settle_token FROM wr_order_links WHERE id IN (21,23) ORDER BY id")).toEqual([
    { id: 21, last_error: "legacy-error", wr_final_settle_token: null },
    { id: 23, last_error: "fixture", wr_final_settle_token: null },
  ]);
  expect(await rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  await expect(db.prepare(fixtureLink).bind(24, "missing-order", "failed").run()).rejects.toThrow(/FOREIGN KEY/i);

  // Fixture-only writes prove the two markers can advance and clear independently.
  await db.prepare("UPDATE wr_order_links SET wr_final_settle_token='fixture-link' WHERE id IN (21,23)").run();
  expect(await rows(db, "SELECT code FROM orders WHERE wr_aggregate_refresh_token IS NOT NULL")).toEqual([]);
  await db.prepare("UPDATE orders SET wr_aggregate_refresh_token='fixture-order' WHERE id IN (11,13)").run();
  for (const { table, key, marker, index } of markers) {
    const scan = `SELECT ${key} FROM ${table} WHERE ${marker} IS NOT NULL ORDER BY ${key} LIMIT ?`;
    const plan = (await rows(db, `EXPLAIN QUERY PLAN ${scan}`, 1)).map(row => row.detail).join(" ");
    expect(plan).toContain(index);
    expect(plan).not.toMatch(/TEMP B-TREE/i);
    expect(await rows(db, scan, 1)).toEqual([table === "orders" ? { code: "A-failed" } : { id: 21 }]);
    expect(await rows(db, scan, 9)).toEqual(table === "orders" ? [{ code: "A-failed" }, { code: "C-new" }] : [{ id: 21 }, { id: 23 }]);
  }
  await db.prepare("UPDATE wr_order_links SET wr_final_settle_token=NULL WHERE id=21").run();
  expect(await rows(db, `SELECT l.wr_final_settle_token, o.wr_aggregate_refresh_token
    FROM wr_order_links l JOIN orders o ON o.code=l.order_code WHERE l.id=21`))
    .toEqual([{ wr_final_settle_token: null, wr_aggregate_refresh_token: "fixture-order" }]);
  return markerSchema(db);
}

it("0154 preserves legacy data and matches the schema snapshot in SQLite", async () => {
  const fixture = createD1Fixture();
  try {
    const snapshot = await markerSchema(fixture.db);
    await seedLegacy(fixture.db);
    for (const { table, marker } of markers) {
      expect(await rows(fixture.db, `SELECT ${marker} FROM ${table} ORDER BY id`))
        .toEqual([{ [marker]: null }, { [marker]: null }]);
    }
    fixture.sql.exec("DELETE FROM fulfillment_items; DELETE FROM wr_order_links; DELETE FROM orders");
    removeSnapshotAdditions(fixture.sql);
    fixture.sql.exec(predecessor);
    expect(await verifyForward(fixture.db, async () => fixture.sql.exec(migration))).toEqual(snapshot);
  } finally {
    fixture.close();
  }
});

it("0154 applies once to a pristine predecessor in native Workerd D1", async () => {
  const fixture = createD1Fixture();
  let runtime: Miniflare | undefined;
  try {
    const snapshot = await markerSchema(fixture.db);
    removeSnapshotAdditions(fixture.sql);
    const ddl = fixture.sql.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      AND (type='table' OR (type='index' AND tbl_name IN ('orders','wr_order_links','fulfillment_items')))
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`).all();
    runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", d1Databases: ["DB"],
      script: "export default { fetch() { return new Response(null); } }" });
    const db: D1 = await runtime.getD1Database("DB");
    await db.batch(ddl.map(row => db.prepare(String(row.sql))));
    await db.prepare(predecessor).run();
    expect(await verifyForward(db, async () => {
      // 0154 is plain DDL (only statement terminators, no trigger bodies).
      const statements = migration.replace(/^--.*$/gm, "").split(";").map(sql => sql.trim()).filter(Boolean);
      await db.batch(statements.map(sql => db.prepare(sql)));
    })).toEqual(snapshot);
  } finally {
    try { await runtime?.dispose(); } finally { fixture.close(); }
  }
}, 30_000);
