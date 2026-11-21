// tests/supplier-saldo-alert-cas.test.ts — Alert saldo rendah SK/WR fail-closed.
//
// Insiden 21 Nov 2026 02:00 & 02:01 WIB: "Saldo Sekalipay menipis" terkirim dua
// kali selagi D1 error. Penyebab: gate baca state menganggap error = "belum
// pernah kirim", dan tulis marker AFTER send tanpa CAS bisa gagal tanpa jejak.
// Kontrak baru: state WAJIB terbaca dan diklaim atomik (CAS) sebelum Telegram;
// error baca/tulis atau kalah CAS = tidak kirim; reservasi dipertahankan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkAndLogSaldo } from "@/lib/warung-rebahan/saldo";
import { checkAndLogSkSaldo } from "@/lib/sekalipay/saldo";
import { createD1Fixture } from "./helpers/d1-fixture";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Clock that only moves when we say so; both suppliers use Date.now(). */
function frozenClock(start: number) {
  let current = start;
  vi.spyOn(Date, "now").mockImplementation(() => current);
  return { advance: (ms: number) => { current += ms; } };
}

function stubTelegram() {
  const sent: unknown[] = [];
  let failNext = false;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const target = String(url);
    if (target.includes("api.telegram.org")) {
      sent.push(target);
      if (failNext) {
        failNext = false;
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    }
    const balance = Number((globalThis as unknown as { __saldo?: number }).__saldo ?? 0);
    return { ok: true, json: async () => ({ success: true, message: "ok", data: { balance, currency: "IDR" } }) };
  }));
  return { sent, failNextSend: () => { failNext = true; } };
}

function setBalance(balance: number) {
  (globalThis as unknown as { __saldo?: number }).__saldo = balance;
}

function skEnv() {
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
  vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
  vi.stubEnv("SEKALIPAY_SALDO_ALERT_THRESHOLD", "250000");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
}

function wrEnv() {
  vi.stubEnv("WARUNG_REBAHAN_ENABLED", "true");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_URL", "https://proxy.test");
  vi.stubEnv("WARUNG_REBAHAN_PROXY_TOKEN", "tok");
  vi.stubEnv("WARUNG_REBAHAN_SALDO_ALERT_THRESHOLD", "250000");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
}

type Supplier = {
  name: string;
  env: () => void;
  check: (db: ReturnType<typeof createDatabaseAccess>) => Promise<unknown>;
  stateTable: string;
};
const suppliers: Supplier[] = [
  { name: "SK", env: skEnv, check: (db) => checkAndLogSkSaldo(db), stateTable: "sk_sync_state" },
  { name: "WR", env: wrEnv, check: (db) => checkAndLogSaldo(db), stateTable: "wr_sync_state" },
];

describe.each(suppliers)("alert saldo $name fail-closed", ({ env, check, stateTable }) => {
  beforeEach(() => env());

  it("D1 read error on the marker → 0 sends", async () => {
    const fx = createD1Fixture();
    const clock = frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(10000);
      const tg = stubTelegram();
      fx.control.fail = (query) => query.includes(stateTable);
      await check(createDatabaseAccess(fx.db));
      expect(tg.sent).toHaveLength(0);
      clock.advance(0);
    } finally {
      fx.close();
    }
  });

  it("CAS write error → 0 sends and no marker reserved", async () => {
    const fx = createD1Fixture();
    frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(10000);
      const tg = stubTelegram();
      fx.control.fail = (query) => query.startsWith(`INSERT INTO ${stateTable}`);
      await check(createDatabaseAccess(fx.db));
      expect(tg.sent).toHaveLength(0);
      const row = fx.sql.prepare(`SELECT COUNT(*) AS n FROM ${stateTable} WHERE key='low_saldo_notified'`).get() as { n: number };
      expect(Number(row.n)).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("two concurrent checks on the same balance → exactly 1 send", async () => {
    const fx = createD1Fixture();
    frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(10000);
      const tg = stubTelegram();
      const db = createDatabaseAccess(fx.db);
      await Promise.all([check(db), check(db)]);
      expect(tg.sent).toHaveLength(1);
    } finally {
      fx.close();
    }
  });

  it("same balance next minute and next hour → 0 further sends; after 6 h → 1", async () => {
    const fx = createD1Fixture();
    const clock = frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(10000);
      const tg = stubTelegram();
      const db = createDatabaseAccess(fx.db);
      await check(db);
      expect(tg.sent).toHaveLength(1);
      clock.advance(MINUTE);
      await check(db);
      clock.advance(HOUR);
      await check(db);
      expect(tg.sent).toHaveLength(1);
      clock.advance(6 * HOUR);
      await check(db);
      expect(tg.sent).toHaveLength(2);
    } finally {
      fx.close();
    }
  });

  it("a further downward step of ≥Rp5.000 re-alerts; a smaller drift does not", async () => {
    const fx = createD1Fixture();
    frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(41900);
      const tg = stubTelegram();
      const db = createDatabaseAccess(fx.db);
      await check(db);
      expect(tg.sent).toHaveLength(1);
      setBalance(38000); // still in the 40000 bucket
      await check(db);
      expect(tg.sent).toHaveLength(1);
      setBalance(34500); // crosses into the 35000 bucket
      await check(db);
      expect(tg.sent).toHaveLength(2);
    } finally {
      fx.close();
    }
  });

  it("Telegram timeout on the first send → no resend on the next tick", async () => {
    const fx = createD1Fixture();
    const clock = frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(10000);
      const tg = stubTelegram();
      tg.failNextSend();
      const db = createDatabaseAccess(fx.db);
      await check(db);
      expect(tg.sent).toHaveLength(1);
      clock.advance(MINUTE);
      await check(db);
      expect(tg.sent).toHaveLength(1);
    } finally {
      fx.close();
    }
  });

  it("recovered balance sends nothing", async () => {
    const fx = createD1Fixture();
    frozenClock(Date.UTC(2026, 10, 21, 1, 0));
    try {
      setBalance(300000);
      const tg = stubTelegram();
      await check(createDatabaseAccess(fx.db));
      expect(tg.sent).toHaveLength(0);
    } finally {
      fx.close();
    }
  });
});
