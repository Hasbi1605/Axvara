// tests/payment-expiry.regression.test.ts — Issue #1: payment/order expiry consistency
//
// Audit 7 Sep 2026 menemukan 4 order kadaluarsa dengan payment_transactions
// masih pending. Akar masalah: `expires_at` ISO-8601 (`toISOString()`)
// dibandingkan langsung sebagai string dengan `datetime('now')`
// (`YYYY-MM-DD HH:MM:SS`); karena 'T' (0x54) > ' ' (0x20), invoice ISO yang
// sudah lewat TIDAK PERNAH cocok sehingga tetap pending, slot nominal unik
// QRIS tertahan, dan publish-scheduled dapat menutup order tanpa menutup
// transaksi (rekonsiliasi kemudian gagal karena mensyaratkan order pending).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { isExpiredIso, isFutureIso, parseExpiry } from "@/lib/expiry";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as {
  DatabaseSync: new (location: string) => { exec: (sql: string) => void; prepare: (sql: string) => { get: () => Record<string, unknown>; all: () => Record<string, unknown>[] } };
};

describe("canonical expiry semantics (ISO vs legacy)", () => {
  it("parses both ISO-8601 and legacy space-separated timestamps", () => {
    expect(parseExpiry("2026-09-07T07:16:59.000Z")).toBe(Date.parse("2026-09-07T07:16:59.000Z"));
    expect(parseExpiry("2026-09-07 07:16:59")).toBe(Date.parse("2026-09-07T07:16:59Z"));
    expect(parseExpiry(null)).toBeNull();
    expect(parseExpiry("not-a-date")).toBeNull();
  });

  it("marks past ISO timestamps expired and future ones alive", () => {
    const now = Date.parse("2026-09-07T08:00:00.000Z");
    expect(isExpiredIso("2026-09-07T07:59:59.000Z", now)).toBe(true);
    expect(isExpiredIso("2026-09-07T08:00:00.000Z", now)).toBe(true);
    expect(isExpiredIso("2026-09-07T08:00:01.000Z", now)).toBe(false);
    expect(isFutureIso("2026-09-07T08:00:01.000Z", now)).toBe(true);
    expect(isFutureIso("2026-09-07T07:59:59.000Z", now)).toBe(false);
    // Missing/unparsable expiry never counts as expired (fail-open for review).
    expect(isExpiredIso(null, now)).toBe(false);
  });

  it("proves the old raw-string SQL comparison misses expired ISO rows", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE pt(expires_at TEXT);`);
    db.exec(`INSERT INTO pt VALUES ('2026-09-07T07:16:59.000Z')`);
    // Bug lama: `expires_at < datetime('now')` — ISO 'T' > ' ' sehingga 0.
    const buggy = db.prepare(`SELECT (expires_at < '2026-09-07 08:00:00') AS c FROM pt`).get();
    expect(Number(buggy.c)).toBe(0);
    // Perbaikan: evaluasi JS kanonis dari helper yang sama dipakai cron.
    expect(isExpiredIso("2026-09-07T07:16:59.000Z", Date.parse("2026-09-07T08:00:00.000Z"))).toBe(true);
  });
});

describe("expiry paths use the canonical helper and guarded transitions", () => {
  it("operations cron evaluates expiry in JS and never raw-compares ISO strings", () => {
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("isExpiredIso");
    expect(cron).toContain("transitionPendingPaymentOrder");
    expect(cron).not.toContain("expires_at < datetime('now')");
    expect(cron).not.toContain("expires_at>datetime('now')");
  });

  it("publish-scheduled defers ledger-owned orders to the operations cron", () => {
    const route = read("src/app/api/cron/publish-scheduled/route.ts");
    expect(route).toContain("isExpiredIso");
    expect(route).toContain("payment_transactions WHERE order_code=?");
    expect(route).toContain("transitionPendingOrder");
  });

  it("webhook and admin retry share the canonical future-invoice check", () => {
    expect(read("src/app/api/webhook/dana/route.ts")).toContain("isFutureIso");
    expect(read("src/app/api/admin/payments/events/route.ts")).toContain("isFutureIso");
    expect(read("src/lib/telegram/order-notifications.ts")).toContain("isFutureIso");
  });

  it("paid and expiry guards are mutually exclusive so concurrent runs settle deterministically", () => {
    const db = read("src/lib/db/orders-transition.ts");
    // Paid wins only from a pending ledger; expiry wins only from a
    // pending/unpaid order — exactly one batch can commit.
    expect(db).toContain("AND EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=? AND status='pending')");
    expect(db).toContain("payment_status IN ('unpaid','pending')");
    // Guard ids are unique per attempt so concurrent batches never collide
    // on the operation_guards primary key.
    expect(db).toContain(":payment:paid:${Date.now()}");
  });

  it("operations cron repairs stranded terminal-order/pending-ledger rows and frees the amount slot", () => {
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("repaired_legacy_expiry");
    expect(cron).toContain("legacy_expiry_repair");
    expect(cron).toContain("o.status IN ('kadaluarsa','dibatalkan')");
  });
});
