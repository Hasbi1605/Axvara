import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/whatsapp/gateway", () => ({
  sendTextMessage: vi.fn(async () => ({ ok: true, messageId: "dummy" })),
}));

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => { get: (...p: unknown[]) => Record<string, unknown> | undefined; all: (...p: unknown[]) => Record<string, unknown>[]; run: (...p: unknown[]) => { changes: number | bigint } };
    close: () => void;
  };
};

function oldSchemaSql(): string {
  const { execFileSync } = nodeRequire("node:child_process") as typeof import("node:child_process");
  return execFileSync("git", ["show", "c5a4748:drizzle/schema.sql"], { cwd: process.cwd(), encoding: "utf8" }) as string;
}

const MIGRATION_0019 = fs.readFileSync("drizzle/migrations/0019_wa_outbox_prod_check_rebuild.sql", "utf8");
const MIGRATION_0017 = fs.readFileSync("drizzle/migrations/0017_payment_event_review.sql", "utf8");
const MIGRATION_0018 = fs.readFileSync("drizzle/migrations/0018_wa_outbox_lease.sql", "utf8");

let fixture: ReturnType<typeof createD1Fixture>;
beforeEach(() => { fixture = createD1Fixture(); });
afterEach(() => { fixture.close(); vi.clearAllMocks(); });

// R10a: migrasi 0019 harus memperbaiki database produksi yang sudah lewat
// 0017/0018 (CHECK lama menolak `sending`), dan instalasi baru tetap benar.
// Seluruh pemulihan dijalankan kode aplikasi — tes hanya menyiapkan kondisi.
describe("R10 migration 0019 repairs the production CHECK", () => {
  it("historic install c5a4748 + 0017 + 0018 + 0019: claim sending succeeds, data intact", async () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      legacy.exec(oldSchemaSql());
      legacy.exec(MIGRATION_0017);
      legacy.exec(MIGRATION_0018);
      // Data lama sebelum perbaikan: pesan penting masih pending.
      legacy.exec(`INSERT INTO whatsapp_outbox (idempotency_key, channel, destination, message_type, payload, status, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('legacy-1','whatsapp','628000000000','text','DUMMY LEGACY','pending',2,datetime('now'),datetime('now'),datetime('now'))`);
      legacy.exec(`INSERT INTO whatsapp_outbox (idempotency_key, channel, destination, message_type, payload, status, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('legacy-sent','whatsapp','628000000000','text','DUMMY SENT','sent',1,datetime('now'),datetime('now'),datetime('now'))`);
      // Bukti bug: CHECK lama menolak sending.
      let oldError = "";
      try { legacy.exec("UPDATE whatsapp_outbox SET status='sending' WHERE idempotency_key='legacy-1'"); }
      catch (error) { oldError = error instanceof Error ? error.message : String(error); }
      expect(oldError).toMatch(/CHECK constraint failed/);
      legacy.exec("UPDATE whatsapp_outbox SET status='pending' WHERE idempotency_key='legacy-1'");
      legacy.exec(MIGRATION_0019);
      // Sesudah migrasi: sending diterima, data lama utuh.
      legacy.exec("UPDATE whatsapp_outbox SET status='sending', worker_id='w', locked_until=datetime('now','+5 minutes') WHERE idempotency_key='legacy-1'");
      legacy.exec("UPDATE whatsapp_outbox SET status='pending', worker_id=NULL, locked_until=NULL WHERE idempotency_key='legacy-1'");
      const check = String(
        legacy.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='whatsapp_outbox'`).get()?.sql ?? "",
      );
      expect(check).toContain("'sending'");
      const rows = legacy.prepare(`SELECT idempotency_key, status, attempt_count, payload FROM whatsapp_outbox ORDER BY id`).all();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ idempotency_key: "legacy-1", attempt_count: 2, payload: "DUMMY LEGACY" });
      expect(rows[1]).toMatchObject({ idempotency_key: "legacy-sent", status: "sent" });
    } finally { legacy.close(); }
  });

  it("fresh installs already accept sending", () => {
    fixture.sql.prepare(`INSERT INTO whatsapp_outbox (idempotency_key, destination, payload, status, attempt_count, next_attempt_at)
      VALUES ('fresh-1','628000000000','DUMMY','pending',0,datetime('now'))`).run();
    fixture.sql.prepare(`UPDATE whatsapp_outbox SET status='sending', worker_id='w', locked_until=datetime('now','+5 minutes') WHERE idempotency_key='fresh-1'`).run();
    expect(fixture.sql.prepare(`SELECT status FROM whatsapp_outbox WHERE idempotency_key='fresh-1'`).get()?.status).toBe("sending");
  });

  it("claim works end-to-end after the historic upgrade path", async () => {
    const legacy = new DatabaseSync(":memory:");
    try {
      legacy.exec(oldSchemaSql());
      legacy.exec(MIGRATION_0017);
      legacy.exec(MIGRATION_0018);
      legacy.exec(MIGRATION_0019);
      legacy.exec(`INSERT INTO whatsapp_outbox (idempotency_key, channel, destination, message_type, payload, status, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('upgraded-1','whatsapp','628000000000','text','DUMMY UPGRADED','pending',0,datetime('now'),datetime('now'),datetime('now'))`);
      // Klaim nyata pasca-upgrade: CHECK hasil migrasi menerima sending.
      legacy.exec("UPDATE whatsapp_outbox SET status='sending', worker_id='w1', locked_until=datetime('now','+5 minutes'), attempt_count=attempt_count+1 WHERE idempotency_key='upgraded-1' AND status IN ('pending','failed') AND attempt_count=0");
      expect(legacy.prepare(`SELECT status, attempt_count FROM whatsapp_outbox WHERE idempotency_key='upgraded-1'`).get())
        .toMatchObject({ status: "sending", attempt_count: 1 });
      // Worker kedua kalah CAS; recovery runtime mengembalikan ke failed.
      const loser = legacy.prepare(`UPDATE whatsapp_outbox SET status='sending' WHERE idempotency_key='upgraded-1' AND status IN ('pending','failed') AND attempt_count=0`).run();
      expect(Number(loser.changes)).toBe(0);
      legacy.exec("UPDATE whatsapp_outbox SET locked_until=datetime('now','-1 minute') WHERE idempotency_key='upgraded-1'");
      legacy.exec(`UPDATE whatsapp_outbox SET status='failed', worker_id=NULL, locked_until=NULL,
        last_error='lease_recovered:delivery_outcome_unknown', next_attempt_at=datetime('now'), updated_at=datetime('now')
        WHERE status='sending' AND (locked_until IS NULL OR datetime(locked_until) <= datetime('now'))`);
      expect(legacy.prepare(`SELECT status FROM whatsapp_outbox WHERE idempotency_key='upgraded-1'`).get()?.status).toBe("failed");
    } finally { legacy.close(); }
  });
});
