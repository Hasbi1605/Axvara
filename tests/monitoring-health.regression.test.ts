// tests/monitoring-health.regression.test.ts — Issue #13: monitoring & ketahanan notifikasi
//
// Temuan audit 7 Sep 2026:
// (a) indikator sehat hanya menunjukkan env tersedia — gateway mati/sesi
//     putus/antrean menumpuk tetap hijau;
// (b) notifikasi penting (mis. "Pembayaran Diterima" WA) hanya best-effort —
//     gagal sekali lalu hilang selamanya.
//
// Perilaku yang seharusnya:
// - Empat tingkat jujur: configured / healthy / degraded / unknown.
// - Kegagalan & usia antrean dipantau (bukan sekadar jumlah).
// - Notifikasi penting masuk antrean idempoten dengan retry CAS + backoff.
// - Gateway eksternal yang tak bisa diukur dinyatakan eksplisit, bukan hijau.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  evaluateQris,
  evaluateQueue,
  evaluateTelegram,
  evaluateWhatsApp,
  queueAgeMinutes,
  summarizeQueue,
} from "@/lib/service-health";

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

describe("empat tingkat status jujur", () => {
  it("env tak lengkap → unknown, bukan hijau", () => {
    expect(evaluateTelegram({ configured: false, enabled: false, webhookError: null, webhookPending: null, lastSendOkAt: null, lastSendFailAt: null, queue: { pending: 0, failed: 0, oldestPendingAt: null } }).level).toBe("unknown");
    expect(evaluateWhatsApp({ configured: true, enabled: false, gatewayReachable: null, lastSendOkAt: null, lastSendFailAt: null, queue: { pending: 0, failed: 0, oldestPendingAt: null } }).level).toBe("unknown");
    expect(evaluateQris({ configured: false, enabled: false, unmatched7d: 0, failed7d: 0, lastMatchAt: null }).level).toBe("unknown");
  });

  it("env lengkap tanpa pengukuran → configured, bukan healthy", () => {
    expect(evaluateTelegram({ configured: true, enabled: true, webhookError: null, webhookPending: null, lastSendOkAt: null, lastSendFailAt: null, queue: { pending: 0, failed: 0, oldestPendingAt: null } }).level).toBe("configured");
    expect(evaluateQris({ configured: true, enabled: true, unmatched7d: 0, failed7d: 0, lastMatchAt: null }).level).toBe("configured");
  });

  it("bukti sukses baru → healthy; bukti masalah → degraded", () => {
    const now = Date.now();
    const recent = new Date(now - 10 * 60_000).toISOString();
    expect(evaluateTelegram({ configured: true, enabled: true, webhookError: null, webhookPending: null, lastSendOkAt: recent, lastSendFailAt: null, queue: { pending: 0, failed: 0, oldestPendingAt: null } }).level).toBe("healthy");
    expect(evaluateTelegram({ configured: true, enabled: true, webhookError: "Unauthorized", webhookPending: null, lastSendOkAt: null, lastSendFailAt: null, queue: { pending: 0, failed: 0, oldestPendingAt: null } }).level).toBe("degraded");
    expect(evaluateQris({ configured: true, enabled: true, unmatched7d: 0, failed7d: 2, lastMatchAt: recent }).level).toBe("degraded");
    expect(evaluateQris({ configured: true, enabled: true, unmatched7d: 3, failed7d: 0, lastMatchAt: recent }).level).toBe("healthy");
    expect(evaluateQris({ configured: true, enabled: true, unmatched7d: 11, failed7d: 0, lastMatchAt: recent }).level).toBe("degraded");
  });

  it("gateway eksternal yang tak terjangkau → degraded dengan penyebutan eksplisit", () => {
    const status = evaluateWhatsApp({ configured: true, enabled: true, gatewayReachable: false, lastSendOkAt: null, lastSendFailAt: null, queue: { pending: 0, failed: 0, oldestPendingAt: null } });
    expect(status.level).toBe("degraded");
    expect(status.detail).toContain("Baileys");
  });
});

describe("pantau kegagalan & usia antrean", () => {
  it("ringkasan memisahkan pending vs gagal", () => {
    const sample = summarizeQueue(
      [{ status: "queued", count: 3 }, { status: "retry", count: 1 }, { status: "failed", count: 2 }, { status: "delivered", count: 9 }],
      null,
    );
    expect(sample.pending).toBe(4);
    expect(sample.failed).toBe(2);
  });

  it("gagal > 0 atau menua → degraded; kosong → healthy", () => {
    const now = Date.now();
    const old = new Date(now - 90 * 60_000).toISOString();
    expect(evaluateQueue({ pending: 0, failed: 1, oldestPendingAt: null }, { maxPending: 25, maxAgeMinutes: 30 }, "Q").level).toBe("degraded");
    expect(evaluateQueue({ pending: 30, failed: 0, oldestPendingAt: null }, { maxPending: 25, maxAgeMinutes: 30 }, "Q").level).toBe("degraded");
    expect(evaluateQueue({ pending: 2, failed: 0, oldestPendingAt: old }, { maxPending: 25, maxAgeMinutes: 30 }, "Q").level).toBe("degraded");
    expect(evaluateQueue({ pending: 0, failed: 0, oldestPendingAt: null }, { maxPending: 25, maxAgeMinutes: 30 }, "Q").level).toBe("healthy");
  });

  it("usia dihitung deterministik; nilai tak-parse → null", () => {
    expect(queueAgeMinutes(new Date(Date.now() - 61 * 60_000).toISOString(), Date.now())).toBeGreaterThanOrEqual(61);
    expect(queueAgeMinutes(null)).toBeNull();
    expect(queueAgeMinutes("bukan-tanggal")).toBeNull();
  });
});

describe("overview memakai pengukuran + system_details", () => {
  it("route mengambil antrean & sinyal kirim, mengembalikan empat tingkat", () => {
    const src = read("src/app/api/admin/overview/route.ts");
    expect(src).toContain("system_details");
    expect(src).toContain("whatsapp_outbox GROUP BY status");
    expect(src).toContain("fulfillment_jobs GROUP BY status");
    expect(src).toContain("evaluateTelegram");
    expect(src).toContain("evaluateWhatsApp");
    expect(src).toContain("evaluateQris");
    expect(src).toContain("summarizeQueue");
  });

  it("bot health memaparkan usia antrean + event QRIS 7 hari", () => {
    const src = read("src/app/api/admin/bot/health/route.ts");
    expect(src).toContain("fulfillment_queue_age");
    expect(src).toContain("whatsapp_outbox_age");
    expect(src).toContain("qris_events_7d");
    expect(src).toContain("oldest_due");
  });
});

describe("notifikasi penting retry idempoten via whatsapp_outbox", () => {
  it("webhook DANA antre (idempoten) lalu coba kirim; cron memproses due", () => {
    const webhook = read("src/app/api/webhook/dana/route.ts");
    expect(webhook).toContain("enqueueWhatsAppMessage");
    expect(webhook).toContain('waOutboxKey("payment_detected"');
    expect(webhook).not.toContain("Buyer notification is best-effort");
    const cron = read("src/app/api/cron/operations/route.ts");
    expect(cron).toContain("processDueWhatsAppOutbox");
    expect(cron).toContain("whatsapp_outbox_sent");
    const outbox = read("src/lib/whatsapp/outbox.ts");
    expect(outbox).toContain("INSERT OR IGNORE INTO whatsapp_outbox");
    expect(outbox).toContain("attempt_count=?");
    expect(outbox).toContain("WA_OUTBOX_MAX_ATTEMPTS");
  });

  it("bukti SQLite: enqueue idempoten + claim CAS + backoff + dead", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE whatsapp_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, idempotency_key TEXT UNIQUE, status TEXT DEFAULT 'pending', attempt_count INTEGER DEFAULT 0, next_attempt_at TEXT, last_error TEXT);`);
    db.exec(`INSERT OR IGNORE INTO whatsapp_outbox (idempotency_key, status, attempt_count) VALUES ('wa:payment_detected:AXV-1','pending',0)`);
    db.exec(`INSERT OR IGNORE INTO whatsapp_outbox (idempotency_key, status, attempt_count) VALUES ('wa:payment_detected:AXV-1','pending',0)`);
    expect(Number(db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_outbox`).get()!.n)).toBe(1);
    // Worker A menang claim, worker B kalah pada attempt yang sama.
    const claimA = db.prepare(`UPDATE whatsapp_outbox SET attempt_count=attempt_count+1 WHERE id=1 AND status IN ('pending','failed') AND attempt_count=0`).get();
    void claimA;
    expect(Number(db.prepare(`SELECT attempt_count AS n FROM whatsapp_outbox WHERE id=1`).get()!.n)).toBe(1);
    const loser = db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE id=1 AND status IN ('pending','failed') AND attempt_count=0`).get()!;
    expect(Number(loser.n)).toBe(0);
    // Backoff: next_attempt_at di masa depan menahan retry dini.
    db.exec(`UPDATE whatsapp_outbox SET status='failed', next_attempt_at=datetime('now','+60 minutes') WHERE id=1`);
    const dueNow = db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_outbox WHERE status IN ('pending','failed') AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))`).get()!;
    expect(Number(dueNow.n)).toBe(0);
  });
});
