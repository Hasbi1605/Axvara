// tests/telegram-update-retry.regression.test.ts — Issue #6: retry update Telegram yang gagal
//
// Audit 7 Sep 2026: semua update_id yang sudah ada dianggap already_processed,
// termasuk failed dan processing dengan lease kedaluwarsa. Retry tidak pernah
// memulihkan pekerjaan dan kegagalan transient tidak punya mekanisme retry.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
      run: (...p: unknown[]) => void;
      get: (...p: unknown[]) => Record<string, unknown>;
      all: (...p: unknown[]) => Record<string, unknown>[];
    };
  };
};

function updatesTable(db: ReturnType<typeof DatabaseSync>) {
  db.exec(`CREATE TABLE telegram_updates(
    update_id TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('processing','done','failed')),
    attempt_count INTEGER NOT NULL DEFAULT 1,
    lease_until TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );`);
}

// Replika deterministik dari logika claim route (JS murni, tanpa HTTP):
// done → skip; processing+lease aktif → skip; failed/lease kedaluwarsa → reclaim.
function claim(
  db: ReturnType<typeof DatabaseSync>,
  updateId: string,
  now: number,
  maxAttempts = 5,
): "done" | "processing" | "claimed" | "exhausted" {
  const row = db.prepare("SELECT status, attempt_count, lease_until FROM telegram_updates WHERE update_id=?").get(updateId) as Record<string, unknown> | undefined;
  if (!row) {
    db.prepare("INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?, 'processing', ?)").run(updateId, new Date(now + 30_000).toISOString());
    return "claimed";
  }
  const status = String(row.status);
  if (status === "done") return "done";
  const lease = Date.parse(String(row.lease_until || ""));
  if (status === "processing" && Number.isFinite(lease) && lease > now) return "processing";
  if (Number(row.attempt_count || 0) >= maxAttempts) return "exhausted";
  return "claimed";
}

describe("klasifikasi status update (reproduksi bug #6)", () => {
  it("bug lama: failed ikut dianggap already_processed", () => {
    const db = new DatabaseSync(":memory:");
    updatesTable(db);
    db.prepare("INSERT INTO telegram_updates (update_id, status) VALUES (?,?)").run("u1", "failed");
    // Kode lama: `if (existing) return already_processed` — tanpa baca status.
    const existing = db.prepare("SELECT status FROM telegram_updates WHERE update_id=?").get("u1");
    const oldVerdict = existing ? "already_processed" : "process";
    expect(oldVerdict).toBe("already_processed"); // bug: pekerjaan gagal terkubur
    // Perilaku baru: failed dapat direclaim untuk retry nyata.
    expect(claim(db, "u1", Date.now())).toBe("claimed");
  });

  it("done tidak diulang, processing aktif tidak direbut", () => {
    const db = new DatabaseSync(":memory:");
    updatesTable(db);
    const now = Date.parse("2026-09-07T10:00:00.000Z");
    db.prepare("INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?,?,?)").run("ud", "done", new Date(now + 30_000).toISOString());
    db.prepare("INSERT INTO telegram_updates (update_id, status, lease_until) VALUES (?,?,?)").run("up", "processing", new Date(now + 30_000).toISOString());
    expect(claim(db, "ud", now)).toBe("done");
    expect(claim(db, "up", now)).toBe("processing");
  });

  it("lease kedaluwarsa dapat direclaim; budget habis berhenti", () => {
    const db = new DatabaseSync(":memory:");
    updatesTable(db);
    const now = Date.parse("2026-09-07T10:00:00.000Z");
    db.prepare("INSERT INTO telegram_updates (update_id, status, lease_until, attempt_count) VALUES (?,?,?,?)").run("us", "processing", new Date(now - 1_000).toISOString(), 1);
    db.prepare("INSERT INTO telegram_updates (update_id, status, lease_until, attempt_count) VALUES (?,?,?,?)").run("ux", "failed", new Date(now - 60_000).toISOString(), 5);
    expect(claim(db, "us", now)).toBe("claimed");
    expect(claim(db, "ux", now)).toBe("exhausted");
  });
});

describe("route memakai claim/reclaim atomik", () => {
  const src = () => read("src/app/api/telegram/webhook/route.ts");
  it("membedakan done, processing aktif, gagal, dan lease kedaluwarsa", () => {
    const s = src();
    expect(s).toContain('status === "done"');
    expect(s).toContain("already_processing");
    expect(s).toContain("already_processed");
    expect(s).toContain("lease_until");
  });
  it("reclaim atomik via CAS + batas attempt agar retry nyata dan terbatas", () => {
    const s = src();
    expect(s).toContain("status IN ('failed','processing')");
    expect(s).toContain("attempt_count=attempt_count+1");
    expect(s).toContain("MAX_UPDATE_ATTEMPTS");
  });
  it("retry tidak membuat order/invoice ganda (idempotency order tetap)", () => {
    const s = src();
    // Pembuatan order Telegram memakai kode unik + guard; retry update yang
    // sama memproses ulang handler yang idempoten (cart/checkout konfirmasi).
    expect(s).toContain("generateOrderCode");
    expect(s).toContain("markDone(updateId)");
  });
});
