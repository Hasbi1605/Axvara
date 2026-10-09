// tests/pedia-saldo-throttle.test.ts — Anti-spam notif saldo ProviderSMM.
//
// Insiden owner 2026-10-09: "Saldo ProviderSMM menipis" spam tiap jam
// (00:35→08:40, 9×/8 jam) saat saldo Rp 0 stagnan — gate cuma 1 jam tanpa
// syarat turun, state cuma timestamp. Dikunci 1:1 WR/SK: kirim ulang hanya
// bila (a) >6 jam sejak bunyi terakhir, atau (b) saldo TURUN melewati
// kelipatan Rp5.000. State `amount|ms` di store_settings.pedia_balance_alert_at.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { notifyPediaLowBalance } from "@/lib/pedia/notify";

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
      const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_balance_alert_at'").get() as { value: string };
      expect(String(row.value)).toMatch(/^0\|\d+$/);
    } finally {
      fx.close();
    }
  });

  it("saldo turun melewati kelipatan Rp5.000 → notifikasi kedua keluar; stagnan → bungkam", async () => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      expect(await notifyPediaLowBalance(41900, db)).toBe(true);
      // 41900 → 34500: melewati kelipatan 40000 (batas 35000) → bunyi lagi.
      expect(await notifyPediaLowBalance(34500, db)).toBe(true);
      expect(sent.length).toBe(2);
      // Stagnan di 34500 → bungkam.
      expect(await notifyPediaLowBalance(34500, db)).toBe(false);
      expect(sent.length).toBe(2);
      // Turun kecil 34500 → 34000 (belum lewati kelipatan 30000) → bungkam.
      expect(await notifyPediaLowBalance(34000, db)).toBe(false);
      expect(sent.length).toBe(2);
    } finally {
      fx.close();
    }
  });

  it(">6 jam sejak bunyi terakhir → bunyi lagi walau saldo sama (pengingat wajar)", async () => {
    const fx = createD1Fixture();
    try {
      env();
      const sent: unknown[] = [];
      telegramStub(sent);
      const db = createDatabaseAccess(fx.db);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
      expect(await notifyPediaLowBalance(0, db)).toBe(true);
      vi.setSystemTime(new Date("2026-10-09T06:00:01Z"));
      expect(await notifyPediaLowBalance(0, db)).toBe(true);
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
      fx.sql.prepare("INSERT INTO store_settings(key,value) VALUES('pedia_balance_alert_at', datetime('now'))").run();
      // Dalam 6 jam + amount lama tak diketahui → bungkam, tapi state
      // dimigrasi ke format baru (timestamp lama dipertahankan) agar cek
      // berikut konsisten.
      expect(await notifyPediaLowBalance(0, db)).toBe(false);
      expect(sent.length).toBe(0);
      const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='pedia_balance_alert_at'").get() as { value: string };
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
});
