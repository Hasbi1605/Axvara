// tests/pedia-saldo-throttle.test.ts — Anti-spam notif saldo IndoSMM.
//
// Kebijakan owner 2026-11-27: kirim sekali saat pertama turun di bawah ambang;
// tidak mengulang saat saldo stagnan; bunyi lagi hanya bila saldo turun ≥ Rp25.000
// dari alert terakhir, atau sesudah pulih (>= ambang, marker direset via
// `clearPediaLowBalanceMarker`) lalu menipis lagi. State `amount|ms` di
// `store_settings.pedia_indosmm_balance_alert_at`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess, QueryBudgetExceeded } from "@/lib/db-access";
import { clearPediaLowBalanceMarker, notifyPediaLowBalance } from "@/lib/pedia/notify";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function telegramStub(sent: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("api.telegram.org")) {
        sent.push(url);
        return { ok: true, json: async () => ({ ok: true, result: {} }) };
      }
      throw new Error(`unexpected fetch ${String(url)}`);
    }),
  );
}

function env() {
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
}

describe("throttle notif saldo SMM (cermin WR/SK 1:1)", () => {
  it("saldo Rp 0 stagnan 3× cek → hanya 1 notifikasi (kasus screenshot owner)", async () => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      expect(await notifyPediaLowBalance(0, db)).toBe(true);
      expect(await notifyPediaLowBalance(0, db)).toBe(false);
      expect(await notifyPediaLowBalance(0, db)).toBe(false);
      expect(sent.length).toBe(1);
      // State format baru amount|ms.
      const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_alert_at'").get() as { value: string };
      expect(String(row.value)).toMatch(/^0\|\d+$/);
    } finally {
      fx.close();
    }
  });

  it("saldo turun ≥Rp25.000 → notifikasi kedua keluar; turun kecil / stagnan → bungkam", async () => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      expect(await notifyPediaLowBalance(80000, db)).toBe(true);
      // Turun 80000 → 60000 (selisih 20000 < 25000) → bungkam.
      expect(await notifyPediaLowBalance(60000, db)).toBe(false);
      expect(sent.length).toBe(1);
      // Turun 80000 → 55000 (selisih 25000) → bunyi lagi.
      expect(await notifyPediaLowBalance(55000, db)).toBe(true);
      expect(sent.length).toBe(2);
      // Stagnan di 55000 → bungkam.
      expect(await notifyPediaLowBalance(55000, db)).toBe(false);
      expect(sent.length).toBe(2);
      // Turun kecil 55000 → 31000 (selisih 24000 < 25000) → bungkam.
      expect(await notifyPediaLowBalance(31000, db)).toBe(false);
      expect(sent.length).toBe(2);
    } finally {
      fx.close();
    }
  });

  it("saldo stagnan tetap bungkam setelah >6 jam & >48 jam; pulih (clearPediaLowBalanceMarker) membuka episode baru", async () => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
      expect(await notifyPediaLowBalance(10000, db)).toBe(true);
      vi.setSystemTime(new Date("2026-10-09T06:00:01Z"));
      expect(await notifyPediaLowBalance(10000, db)).toBe(false);
      vi.setSystemTime(new Date("2026-10-11T00:00:01Z"));
      expect(await notifyPediaLowBalance(10000, db)).toBe(false);
      expect(sent.length).toBe(1);

      // Saldo top up >= ambang -> marker dibersihkan -> menipis berikutnya bunyi sekali lagi.
      await clearPediaLowBalanceMarker(db, "indosmm");
      const cleared = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_alert_at'").get() as { value: string };
      expect(cleared.value).toBe("");
      expect(await notifyPediaLowBalance(90000, db)).toBe(true);
      expect(sent.length).toBe(2);
    } finally {
      vi.useRealTimers();
      fx.close();
    }
  });

  it("format lama (datetime ISO, tanpa amount) → migrasi tanpa spam ganda", async () => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      // State prod lama: datetime ISO (ditulis gate 1 jam yang lama).
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('pedia_indosmm_balance_alert_at', datetime('now'))").run();
      // Dalam 6 jam + amount lama tak diketahui → bungkam, tapi state
      // dimigrasi ke format baru (timestamp lama dipertahankan) agar cek
      // berikut konsisten.
      expect(await notifyPediaLowBalance(0, db)).toBe(false);
      expect(sent.length).toBe(0);
      const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_alert_at'").get() as { value: string };
      expect(String(row.value)).toMatch(/^\d+\|\d+$/);
      // Cek berikut (format baru, stagnan) → tetap bungkam.
      expect(await notifyPediaLowBalance(0, db)).toBe(false);
      expect(sent.length).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("tanpa TELEGRAM_ADMIN_CHAT_ID → false, tanpa kirim", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
      const sent: unknown[] = [];
      telegramStub(sent);
      expect(await notifyPediaLowBalance(0, createDatabaseAccess(fx.db))).toBe(false);
      expect(sent.length).toBe(0);
    } finally {
      fx.close();
    }
  });

  it.each(["indosmm"] as const)("D1 read/write failure or missing DB never sends an unthrottled %s message", async supplier => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      const quota = new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.");
      for (const error of [quota, new QueryBudgetExceeded()]) {
        const readFailure = { ...db, queryFirst: vi.fn().mockRejectedValue(error), execRun: vi.fn() };
        expect(await notifyPediaLowBalance(0, readFailure, supplier)).toBe(false);
        expect(readFailure.execRun).not.toHaveBeenCalled();
        const writeFailure = { ...db, execRun: vi.fn().mockRejectedValue(error) };
        expect(await notifyPediaLowBalance(0, writeFailure, supplier)).toBe(false);
      }
      expect(await notifyPediaLowBalance(0, undefined, supplier)).toBe(false);
      expect(sent).toHaveLength(0);
      // Recovery: a later successful durable claim can notify normally.
      expect(await notifyPediaLowBalance(0, db, supplier)).toBe(true);
      expect(sent).toHaveLength(1);
    } finally { fx.close(); }
  });

  it("twelve five-minute quota failures send nothing, then recovery allows one reminder", async () => {
    const fx = createD1Fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      env(); const sent: unknown[] = []; telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      const blocked = { ...db, queryFirst: vi.fn().mockRejectedValue(new Error("D1 quota")) };
      for (let tick = 0; tick < 12; tick++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 16, 22, tick * 5)));
        expect(await notifyPediaLowBalance(0, blocked)).toBe(false);
      }
      expect(sent).toHaveLength(0);
      expect(await notifyPediaLowBalance(0, db)).toBe(true);
      expect(await notifyPediaLowBalance(0, db)).toBe(false);
      expect(sent).toHaveLength(1);
    } finally { vi.useRealTimers(); fx.close(); }
  });

  it("two cron invocations race on a new or cleared marker: only the atomic claim winner sends", async () => {
    const fx = createD1Fixture();
    try {
      env(); const sent: unknown[] = []; telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      const results = await Promise.all(Array.from({ length: 5 }, () => notifyPediaLowBalance(80000, db)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(sent).toHaveLength(1);
      // Concurrent invocations racing on a ≥Rp25.000 drop -> still exactly 1 winner.
      const next = await Promise.all(Array.from({ length: 5 }, () => notifyPediaLowBalance(50000, db)));
      expect(next.filter(Boolean)).toHaveLength(1);
      expect(sent).toHaveLength(2);
    } finally { fx.close(); }
  });

  it("one marker throttles the only supplier and Telegram rejection is not reported as delivered", async () => {
    const fx = createD1Fixture();
    try {
      env(); const sent: unknown[] = []; telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      expect(await notifyPediaLowBalance(80000, db, "indosmm")).toBe(true);
      expect(await notifyPediaLowBalance(80000, db, "indosmm")).toBe(false);
      expect(sent).toHaveLength(1);
      const fetch = vi.fn(async () => ({ ok: false, json: async () => ({ ok: false, error_code: 429, description: "retry later" }) }));
      vi.stubGlobal("fetch", fetch);
      // Drop ≥Rp25.000 triggers claim + attempt, rejected by Telegram -> returns false and keeps claim.
      expect(await notifyPediaLowBalance(50000, db)).toBe(false);
      expect(await notifyPediaLowBalance(50000, db)).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fx.close(); }
  });

  it("cron/lite pedia_orders clears pedia_indosmm_balance_alert_at when balance recovers >= threshold", async () => {
    const fx = createD1Fixture();
    try {
      env();
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("PEDIA_ENABLED", "true");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
      vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "tok");
      vi.stubEnv("PEDIA_BALANCE_ALERT_RP", "100000");
      const sent: unknown[] = [];
      let liveBalance = 50000;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.includes("api.telegram.org")) {
          sent.push(s);
          return Response.json({ ok: true, result: { message_id: sent.length } });
        }
        return Response.json({ balance: String(liveBalance), currency: "IDR" });
      }));
      const { POST } = await import("@/app/api/cron/lite/route");
      const { NextRequest } = await import("next/server");
      const runJob = () => POST(new NextRequest("http://localhost/api/cron/lite?job=pedia_orders", {
        method: "POST",
        headers: { authorization: "Bearer s" },
      }));

      // 1) Low balance alerts once.
      expect((await runJob()).status).toBe(200);
      expect(sent).toHaveLength(1);
      // 2) Top up >= 100.000 clears marker without alerting.
      liveBalance = 250000;
      fx.sql.exec("DELETE FROM store_settings WHERE key='pedia_indosmm_balance_checked_at'");
      expect((await runJob()).status).toBe(200);
      expect(sent).toHaveLength(1);
      expect(fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_indosmm_balance_alert_at'").get()).toEqual({ value: "" });
      // 3) Drops below 100.000 again -> alerts once for the new episode.
      liveBalance = 90000;
      fx.sql.exec("DELETE FROM store_settings WHERE key='pedia_indosmm_balance_checked_at'");
      expect((await runJob()).status).toBe(200);
      expect(sent).toHaveLength(2);
    } finally { fx.close(); }
  });
});
