import { afterEach, describe, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess, QueryBudgetExceeded } from "@/lib/db-access";
import {
  aivaultBalanceAlertThreshold,
  checkAivaultLowBalance,
  checkSupplierLowBalance,
  checkTunvnLowBalance,
  parseBalanceThreshold,
  tunvnBalanceAlertThreshold,
} from "@/lib/supplier-balance-alert";
import { createD1Fixture } from "./helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubTelegramEnv(enabled = "true") {
  vi.stubEnv("TELEGRAM_BOT_ENABLED", enabled);
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
}

function stubTelegramFetch() {
  const messages: { chat_id: string; text: string; parse_mode?: string }[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("api.telegram.org")) {
      messages.push(JSON.parse(String(init?.body ?? "{}")));
      return Response.json({ ok: true, result: { message_id: messages.length } });
    }
    throw new Error(`Unexpected fetch ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { messages, fetchMock };
}

async function callCronLite(job: "tunvn_orders" | "aivault_orders") {
  const { POST } = await import("@/app/api/cron/lite/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest(`http://localhost/api/cron/lite?job=${job}`, {
      method: "POST",
      headers: { authorization: "Bearer s" },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("checkSupplierLowBalance", () => {
  it("below threshold alerts once, uses <=5 D1 statements, and repeats within 6h only on drop >= step", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegramEnv();
      const { messages } = stubTelegramFetch();
      const t0 = 1_800_000_000_000;
      const thirtyOneMin = 31 * 60 * 1000;
      const format = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} USDT`;

      const budgeted = createBudgetedDatabase(5, 0, fx.db);
      const r1 = await checkSupplierLowBalance(budgeted.access, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => 4.1,
        threshold: 5,
        step: 1,
        format,
        now: t0,
      });
      expect(r1).toEqual({ checked: true, balance: 4.1, alerted: true });
      expect(budgeted.used).toBeLessThanOrEqual(5);
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe(
        "💰 <b>Saldo TUNVN menipis</b>\nSisa 4.10 USDT (ambang 5 USDT). Top up agar auto-order TUNVN tidak tertahan.",
      );
      expect(messages[0].parse_mode).toBe("HTML");

      // Repeat after 30m checkpoint without further drop (within 6h) -> no alert.
      const db = createDatabaseAccess(fx.db);
      const r2 = await checkSupplierLowBalance(db, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => 3.5,
        threshold: 5,
        step: 1,
        format,
        now: t0 + thirtyOneMin,
      });
      expect(r2).toEqual({ checked: true, balance: 3.5, alerted: false });
      expect(messages).toHaveLength(1);

      // Drop >= step (4.1 -> 3.1, float-safe) within 6h -> alerts again.
      const r3 = await checkSupplierLowBalance(db, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => 3.1,
        threshold: 5,
        step: 1,
        format,
        now: t0 + 2 * thirtyOneMin,
      });
      expect(r3).toEqual({ checked: true, balance: 3.1, alerted: true });
      expect(messages).toHaveLength(2);
    } finally {
      fx.close();
    }
  });

  it("alerts again after 6h even without further balance drop", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegramEnv();
      const { messages } = stubTelegramFetch();
      const db = createDatabaseAccess(fx.db);
      const t0 = 1_800_000_000_000;
      const opts = {
        supplier: "aivault" as const,
        label: "AIVault",
        fetchBalance: async () => 3.2,
        threshold: 5,
        step: 1,
        format: (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`,
      };

      expect(await checkSupplierLowBalance(db, { ...opts, now: t0 })).toMatchObject({ alerted: true });
      expect(await checkSupplierLowBalance(db, { ...opts, now: t0 + 5 * 60 * 60 * 1000 })).toMatchObject({ alerted: false });
      expect(await checkSupplierLowBalance(db, { ...opts, now: t0 + 6 * 60 * 60 * 1000 })).toMatchObject({ alerted: true });
      expect(messages).toHaveLength(2);
    } finally {
      fx.close();
    }
  });

  it("above or equal to threshold sends no alert", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegramEnv();
      const { messages } = stubTelegramFetch();
      const db = createDatabaseAccess(fx.db);

      const res = await checkSupplierLowBalance(db, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => 5,
        threshold: 5,
        step: 1,
        format: (n) => `${n} USDT`,
        now: 1_800_000_000_000,
      });
      expect(res).toEqual({ checked: true, balance: 5, alerted: false });
      expect(messages).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("checkpoint prevents API call within 30 minutes and runs again after 30 minutes", async () => {
    const fx = createD1Fixture();
    try {
      const db = createDatabaseAccess(fx.db);
      const fetchBalance = vi.fn(async () => 10);
      const t0 = 1_800_000_000_000;

      expect(
        await checkSupplierLowBalance(db, {
          supplier: "tunvn",
          label: "TUNVN",
          fetchBalance,
          threshold: 5,
          step: 1,
          format: (n) => `${n} USDT`,
          now: t0,
        }),
      ).toEqual({ checked: true, balance: 10, alerted: false });
      expect(fetchBalance).toHaveBeenCalledTimes(1);

      expect(
        await checkSupplierLowBalance(db, {
          supplier: "tunvn",
          label: "TUNVN",
          fetchBalance,
          threshold: 5,
          step: 1,
          format: (n) => `${n} USDT`,
          now: t0 + 29 * 60 * 1000,
        }),
      ).toEqual({ checked: false });
      expect(fetchBalance).toHaveBeenCalledTimes(1);

      expect(
        await checkSupplierLowBalance(db, {
          supplier: "tunvn",
          label: "TUNVN",
          fetchBalance,
          threshold: 5,
          step: 1,
          format: (n) => `${n} USDT`,
          now: t0 + 30 * 60 * 1000,
        }),
      ).toEqual({ checked: true, balance: 10, alerted: false });
      expect(fetchBalance).toHaveBeenCalledTimes(2);
    } finally {
      fx.close();
    }
  });

  it("records error and sends no alert when fetch fails or returns null", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegramEnv();
      const { messages } = stubTelegramFetch();
      const db = createDatabaseAccess(fx.db);
      const t0 = 1_800_000_000_000;

      const r1 = await checkSupplierLowBalance(db, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => null,
        threshold: 5,
        step: 1,
        format: (n) => `${n} USDT`,
        now: t0,
      });
      expect(r1).toEqual({ checked: true, alerted: false, error: "balance_unavailable" });

      const r2 = await checkSupplierLowBalance(db, {
        supplier: "aivault",
        label: "AIVault",
        fetchBalance: async () => {
          throw new Error("ambiguous");
        },
        threshold: 5,
        step: 1,
        format: (n) => `$${n}`,
        now: t0,
      });
      expect(r2).toEqual({ checked: true, alerted: false, error: "ambiguous" });
      expect(messages).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("does not send Telegram when TELEGRAM_ADMIN_CHAT_ID is missing or bot is disabled", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
      vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot-token");
      const { messages } = stubTelegramFetch();
      const db = createDatabaseAccess(fx.db);

      const r1 = await checkSupplierLowBalance(db, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => 2,
        threshold: 5,
        step: 1,
        format: (n) => `${n} USDT`,
        now: 1_800_000_000_000,
      });
      expect(r1).toEqual({ checked: true, balance: 2, alerted: false });

      vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
      vi.stubEnv("TELEGRAM_BOT_ENABLED", "false");
      const r2 = await checkSupplierLowBalance(db, {
        supplier: "aivault",
        label: "AIVault",
        fetchBalance: async () => 2,
        threshold: 5,
        step: 1,
        format: (n) => `$${n}`,
        now: 1_800_000_000_000,
      });
      expect(r2).toEqual({ checked: true, balance: 2, alerted: false });
      expect(messages).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("migrates legacy datetime alert state without spamming and prevents concurrent duplicate sends via CAS", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegramEnv();
      const { messages } = stubTelegramFetch();
      const db = createDatabaseAccess(fx.db);
      const t0 = 1_800_000_000_000;

      // Legacy datetime within 6h of t0 -> silenced + migrated to amount|ms.
      fx.sql
        .prepare("INSERT INTO store_settings(key,value) VALUES('tunvn_balance_alert_at', ?)")
        .run(new Date(t0 - 60 * 60 * 1000).toISOString());
      const migrated = await checkSupplierLowBalance(db, {
        supplier: "tunvn",
        label: "TUNVN",
        fetchBalance: async () => 2.5,
        threshold: 5,
        step: 1,
        format: (n) => `${n} USDT`,
        now: t0,
      });
      expect(migrated).toEqual({ checked: true, balance: 2.5, alerted: false });
      expect(messages).toHaveLength(0);
      const row = fx.sql.prepare("SELECT value FROM store_settings WHERE key='tunvn_balance_alert_at'").get() as {
        value: string;
      };
      expect(row.value).toMatch(/^2\.5\|\d+$/);

      // Concurrent alerts racing on fresh aivault state -> CAS ensures only 1 Telegram message.
      const raced = await Promise.all(
        Array.from({ length: 4 }, () =>
          checkSupplierLowBalance(db, {
            supplier: "aivault",
            label: "AIVault",
            fetchBalance: async () => 1.5,
            threshold: 5,
            step: 1,
            format: (n) => `$${n}`,
            now: t0,
          }),
        ),
      );
      expect(raced.filter((r) => r.alerted === true)).toHaveLength(1);
      expect(messages).toHaveLength(1);
    } finally {
      fx.close();
    }
  });

  it("rethrows QueryBudgetExceeded rather than swallowing budget exhaustion", async () => {
    const fx = createD1Fixture();
    try {
      const budgeted = createBudgetedDatabase(1, 0, fx.db);
      await expect(
        checkSupplierLowBalance(budgeted.access, {
          supplier: "tunvn",
          label: "TUNVN",
          fetchBalance: async () => 1,
          threshold: 5,
          step: 1,
          format: (n) => `${n} USDT`,
        }),
      ).rejects.toBeInstanceOf(QueryBudgetExceeded);
    } finally {
      fx.close();
    }
  });
});

describe("env threshold parsing and supplier adapters", () => {
  it("parses finite >= 0 thresholds and falls back to 5 otherwise", () => {
    expect(parseBalanceThreshold(undefined, 5)).toBe(5);
    expect(parseBalanceThreshold("", 5)).toBe(5);
    expect(parseBalanceThreshold("   ", 5)).toBe(5);
    expect(parseBalanceThreshold("-1", 5)).toBe(5);
    expect(parseBalanceThreshold("abc", 5)).toBe(5);
    expect(parseBalanceThreshold("Infinity", 5)).toBe(5);
    expect(parseBalanceThreshold("0", 5)).toBe(0);
    expect(parseBalanceThreshold("2.5", 5)).toBe(2.5);

    vi.stubEnv("TUNVN_BALANCE_ALERT_USDT", "7.5");
    vi.stubEnv("AIVAULT_BALANCE_ALERT_USD", "bad");
    expect(tunvnBalanceAlertThreshold()).toBe(7.5);
    expect(aivaultBalanceAlertThreshold()).toBe(5);
  });

  it("formats TUNVN and AIVault alert messages per spec", async () => {
    const fx = createD1Fixture();
    try {
      stubTelegramEnv();
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_API_KEY", "k");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_API_KEY", "k");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");

      const sent: { text: string }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: unknown, init?: RequestInit) => {
          const s = String(url);
          if (s.includes("api.telegram.org")) {
            sent.push(JSON.parse(String(init?.body ?? "{}")));
            return Response.json({ ok: true, result: { message_id: sent.length } });
          }
          if (s.includes("tunvn.test/api/balance")) {
            return Response.json({ success: true, username: "u", balance_vnd: 0, balance_usdt: 3.2 });
          }
          if (s.includes("aivault.test/api/v1/me")) {
            return Response.json({ balance: 3.2, currency: "USD" });
          }
          throw new Error(`Unexpected fetch ${s}`);
        }),
      );

      const db = createDatabaseAccess(fx.db);
      expect(await checkTunvnLowBalance(db, 1_800_000_000_000)).toEqual({
        checked: true,
        balance: 3.2,
        alerted: true,
      });
      expect(await checkAivaultLowBalance(db, 1_800_000_000_000)).toEqual({
        checked: true,
        balance: 3.2,
        alerted: true,
      });
      expect(sent.map((m) => m.text)).toEqual([
        "💰 <b>Saldo TUNVN menipis</b>\nSisa 3.20 USDT (ambang 5 USDT). Top up agar auto-order TUNVN tidak tertahan.",
        "💰 <b>Saldo AIVault menipis</b>\nSisa $3.20 (ambang $5). Top up agar auto-order AIVault tidak tertahan.",
      ]);
    } finally {
      fx.close();
    }
  });
});

describe("/api/cron/lite supplier balance wiring", () => {
  it("skips balance checks with 0 network calls when TUNVN and AIVault are not configured", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      vi.stubEnv("TUNVN_ENABLED", "false");
      vi.stubEnv("AIVAULT_ENABLED", "false");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const t = await callCronLite("tunvn_orders");
      expect(t).toEqual({
        status: 200,
        body: { ok: true, job: "tunvn_orders", tunvn_orders_processed: 0 },
      });

      const a = await callCronLite("aivault_orders");
      expect(a).toEqual({
        status: 200,
        body: { ok: true, job: "aivault_orders", aivault_orders_processed: 0 },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fx.close();
    }
  });

  it("checks balance in tunvn_orders and aivault_orders, throttles 30m, and surfaces fetch errors safely", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("CRON_SECRET", "s");
      stubTelegramEnv();
      vi.stubEnv("TUNVN_ENABLED", "true");
      vi.stubEnv("TUNVN_SYNC_ENABLED", "false");
      vi.stubEnv("TUNVN_API_KEY", "k");
      vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
      vi.stubEnv("AIVAULT_ENABLED", "true");
      vi.stubEnv("AIVAULT_SYNC_ENABLED", "false");
      vi.stubEnv("AIVAULT_API_KEY", "k");
      vi.stubEnv("AIVAULT_BASE_URL", "https://aivault.test");

      let tunvnOk = true;
      let aivaultOk = true;
      const sent: string[] = [];
      const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("api.telegram.org")) {
          sent.push(JSON.parse(String(init?.body ?? "{}")).text);
          return Response.json({ ok: true, result: { message_id: sent.length } });
        }
        if (s.includes("tunvn.test/api/balance")) {
          return tunvnOk
            ? Response.json({ success: true, username: "u", balance_vnd: 0, balance_usdt: 2.5 })
            : new Response("", { status: 502 });
        }
        if (s.includes("aivault.test/api/v1/me")) {
          return aivaultOk
            ? Response.json({ balance: 1.75, currency: "USD" })
            : Response.json({ balance: 10, currency: "INR" });
        }
        throw new Error(`Unexpected fetch ${s}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const t1 = await callCronLite("tunvn_orders");
      expect(t1).toEqual({
        status: 200,
        body: {
          ok: true,
          job: "tunvn_orders",
          tunvn_orders_processed: 0,
          tunvn_balance: 2.5,
          tunvn_balance_alerted: true,
        },
      });

      // Within 30m checkpoint: no second API call, no balance fields.
      const t2 = await callCronLite("tunvn_orders");
      expect(t2).toEqual({
        status: 200,
        body: { ok: true, job: "tunvn_orders", tunvn_orders_processed: 0 },
      });

      const a1 = await callCronLite("aivault_orders");
      expect(a1).toEqual({
        status: 200,
        body: {
          ok: true,
          job: "aivault_orders",
          aivault_orders_processed: 0,
          aivault_balance: 1.75,
          aivault_balance_alerted: true,
        },
      });
      expect(sent).toHaveLength(2);

      // Simulate expired checkpoints with upstream failures -> error recorded, 200 ok, no alert.
      tunvnOk = false;
      aivaultOk = false;
      fx.sql.exec("DELETE FROM store_settings WHERE key IN ('tunvn_balance_checked_at','aivault_balance_checked_at')");

      const tErr = await callCronLite("tunvn_orders");
      expect(tErr).toEqual({
        status: 200,
        body: {
          ok: true,
          job: "tunvn_orders",
          tunvn_orders_processed: 0,
          tunvn_balance_alerted: false,
          tunvn_balance_error: "ambiguous",
        },
      });

      const aErr = await callCronLite("aivault_orders");
      expect(aErr).toEqual({
        status: 200,
        body: {
          ok: true,
          job: "aivault_orders",
          aivault_orders_processed: 0,
          aivault_balance_alerted: false,
          aivault_balance_error: "balance_shape",
        },
      });
      expect(sent).toHaveLength(2);
    } finally {
      fx.close();
    }
  });
});
