// tests/supplier-topups.test.ts — Invoice topup saldo supplier SK + TUNVN.
// Semua upstream di-mock; tidak ada panggilan tulis supplier nyata.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import {
  createSupplierTopup,
  createSupplierTopupRefId,
  refreshSupplierTopup,
  SupplierTopupError,
} from "@/lib/supplier/topup";
import { parseTunvnDeposit, parseTunvnDepositStatus } from "@/lib/tunvn/client";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

const ADDRESS = `0x${"a".repeat(40)}`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubSkEnv() {
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_SANDBOX", "false");
  vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
  vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "proxy-token");
}

function stubTunvnEnv() {
  vi.stubEnv("TUNVN_ENABLED", "true");
  vi.stubEnv("TUNVN_API_KEY", "tunvn-key");
  vi.stubEnv("TUNVN_BASE_URL", "https://tunvn.test");
}

function channel(overrides: Record<string, unknown> = {}) {
  return {
    service: "sk-topup",
    name: "Topup Saldo",
    type: "balance",
    status: "on",
    minimum: 10_000,
    maximum: 1_000_000,
    fee_flat: 0,
    fee_percentage: "0.7",
    sort_order: 1,
    updated_at: "2026-11-20T00:00:00Z",
    ...overrides,
  };
}

function skInvoice(overrides: Record<string, unknown> = {}) {
  return {
    invoice: "SK-INV-1",
    ref_id: "ignored",
    amount: 50_500,
    price: 50_000,
    fees: 500,
    payment_code: "QRIS",
    status: "pending",
    payment_link: "https://pay.test/inv",
    payment_url: "https://pay.test/inv",
    qr_link: "https://pay.test/qr",
    expired_at: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

describe("ref_id", () => {
  it("is server-generated AXVTU-YYYYMMDD-8hex and never starts with GW-", () => {
    const now = Date.UTC(2026, 10, 20);
    for (let i = 0; i < 25; i++) {
      const id = createSupplierTopupRefId(now);
      expect(id).toMatch(/^AXVTU-20261120-[0-9a-f]{8}$/);
      expect(id.startsWith("GW-")).toBe(false);
    }
  });
});

describe("Sekalipay topup", () => {
  it("stores invoice, pay vs credit amounts, fees and expiry", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const posts: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel()] });
        if (s.includes("/sk/v1/balance")) {
          posts.push(JSON.parse(String(init?.body ?? "{}")));
          return Response.json({ data: skInvoice() });
        }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      const item = await createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now });

      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ code: "sk-topup", amount: 50_000 });
      expect(String(posts[0].ref_id)).toMatch(/^AXVTU-20261120-[0-9a-f]{8}$/);
      expect(item).toMatchObject({
        supplier: "sekalipay",
        status: "pending",
        supplier_ref: "SK-INV-1",
        channel: "sk-topup",
        currency: "IDR",
        requested_amount: 50_000,
        pay_amount: 50_500,
        credit_amount: 50_000,
        fee_amount: 500,
        expires_at: Date.parse("2026-11-20T10:00:00Z"),
      });
      expect(item.payment).toMatchObject({ payment_link: "https://pay.test/inv", qr_link: "https://pay.test/qr" });
    } finally {
      fx.close();
    }
  });

  it("null payment link keeps pending then refresh re-POSTs the SAME ref_id", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const posts: Record<string, unknown>[] = [];
      let withLink = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel()] });
        if (s.includes("/sk/v1/balance")) {
          posts.push(JSON.parse(String(init?.body ?? "{}")));
          return Response.json({
            data: skInvoice(withLink
              ? { payment_link: "https://pay.test/inv", payment_url: null, qr_link: null }
              : { payment_link: null, payment_url: null, qr_link: null }),
          });
        }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now });
      expect(created.status).toBe("pending");
      expect(created.payment?.payment_link).toBeNull();

      withLink = true;
      const refreshed = await refreshSupplierTopup(db, created.id, { now: now + 11_000 });
      expect(posts).toHaveLength(2);
      expect(posts[1].ref_id).toBe(posts[0].ref_id);
      expect(refreshed.payment?.payment_link).toBe("https://pay.test/inv");
      expect(refreshed.status).toBe("pending");
    } finally {
      fx.close();
    }
  });

  it("rejects a channel that is off before any create POST", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const posts: unknown[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel({ status: "off" })] });
        posts.push(init?.body);
        throw new Error("create must not be called");
      }));
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now: 1 }),
      ).rejects.toMatchObject({ status: 409, code: "channel_unavailable" });
      expect(posts).toHaveLength(0);
      const row = fx.sql.prepare("SELECT status,error FROM supplier_topups").get() as { status: string; error: string };
      expect(row).toMatchObject({ status: "failed", error: "channel_unavailable" });
    } finally {
      fx.close();
    }
  });

  it("rejects an amount outside the channel range before any create POST", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const posts: unknown[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel({ maximum: 20_000 })] });
        posts.push(init?.body);
        throw new Error("create must not be called");
      }));
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now: 1 }),
      ).rejects.toMatchObject({ status: 400, code: "amount_out_of_range" });
      expect(posts).toHaveLength(0);
    } finally {
      fx.close();
    }
  });

  it("daily limit rejection marks failed and refresh does not retry", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      let calls = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        calls++;
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel()] });
        if (s.includes("/sk/v1/balance")) {
          return Response.json({ message: "TOPUP_DAILY_LIMIT" }, { status: 422 });
        }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now }),
      ).rejects.toMatchObject({ status: 502, code: "topup_daily_limit" });
      const row = fx.sql.prepare("SELECT id,status,error FROM supplier_topups").get() as {
        id: number; status: string; error: string;
      };
      expect(row).toMatchObject({ status: "failed", error: "topup_daily_limit" });
      const callsAfterCreate = calls;
      const item = await refreshSupplierTopup(db, row.id, { now: now + 60_000 });
      expect(item.status).toBe("failed");
      expect(calls).toBe(callsAfterCreate);
    } finally {
      fx.close();
    }
  });

  it("network timeout marks unknown", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel()] });
        if (s.includes("/sk/v1/balance")) {
          void init;
          throw new DOMException("aborted", "AbortError");
        }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now: 1 }),
      ).rejects.toBeInstanceOf(SupplierTopupError);
      const row = fx.sql.prepare("SELECT status,error FROM supplier_topups").get() as { status: string; error: string };
      expect(row.status).toBe("unknown");
      expect(row.error).toBe("sk_request_timeout");
    } finally {
      fx.close();
    }
  });

  it("H2-18: refresh re-validates channels before reposting after a channel-read failure", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      let channelsFail = true;
      const posts: unknown[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) {
          if (channelsFail) return new Response("{}", { status: 502 });
          return Response.json({ data: [channel({ status: "off" })] });
        }
        if (s.includes("/sk/v1/balance")) { posts.push(init?.body); return Response.json({ data: skInvoice() }); }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now }),
      ).rejects.toBeInstanceOf(SupplierTopupError);
      const row = fx.sql.prepare("SELECT id,status FROM supplier_topups").get() as { id: number; status: string };
      expect(row.status).toBe("unknown");

      channelsFail = false;
      const refreshed = await refreshSupplierTopup(db, row.id, { now: now + 11_000 });
      expect(posts).toHaveLength(0);
      expect(refreshed.status).toBe("failed");
      expect(refreshed.error).toBe("channel_unavailable");
    } finally {
      fx.close();
    }
  });

  it("refresh matches the credit mutation invoice and marks paid", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      let mutations = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.includes("/sk/v1/balance/channels")) return Response.json({ data: [channel()] });
        if (s.includes("/sk/v1/balance/mutations")) {
          mutations = true;
          return Response.json({ data: [
            { invoice: "OTHER", direction: "credit", type: "topup", amount: 1, balance_before: 0, balance_after: 1 },
            { invoice: "SK-INV-1", direction: "credit", type: "topup", amount: 50_000, balance_before: 100, balance_after: 50_100 },
          ], meta: { current_page: 1 } });
        }
        if (s.includes("/sk/v1/balance")) return Response.json({ data: skInvoice() });
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now });
      const refreshed = await refreshSupplierTopup(db, created.id, { now: now + 11_000 });
      expect(mutations).toBe(true);
      expect(refreshed.status).toBe("paid");
      expect(refreshed.paid_at).toBe(now + 11_000);
      expect(refreshed.credit_amount).toBe(50_000);
    } finally {
      fx.close();
    }
  });
});

describe("TUNVN topup", () => {
  function depositResponse(overrides: Record<string, unknown> = {}) {
    return {
      success: true,
      deposit: {
        id: "D-1",
        payment_code: "TUN-123",
        status: "pending",
        amount_usdt: 10,
        amount_vnd_equivalent: 250_000,
        expires_in_minutes: 30,
        wallet_transfer: {
          address: ADDRESS,
          network: "BEP20",
          exact_amount: 10.25,
          instruction: "Send exactly 10.25 USDT on BEP20",
        },
        ...overrides,
      },
      status_endpoint: "/api/deposit/status",
      note: "pay manually",
    };
  }

  it("creates a pending USDT BEP20 invoice with exact amount and expiry", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        expect(String(url)).toBe("https://tunvn.test/api/deposit");
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return Response.json(depositResponse());
      }));
      const db = createDatabaseAccess(fx.db);
      const item = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      expect(bodies).toEqual([{ amount: 10, currency: "usdt" }]);
      expect(item).toMatchObject({
        supplier: "tunvn",
        status: "pending",
        supplier_ref: "TUN-123",
        channel: "USDT_BEP20",
        currency: "USDT",
        requested_amount: 10,
        pay_amount: 10.25,
        credit_amount: 10,
        expires_at: now + 30 * 60_000,
      });
      expect(item.payment).toMatchObject({ address: ADDRESS, network: "BEP20", exact_amount: 10.25 });
    } finally {
      fx.close();
    }
  });

  it("rejects an unexpected network and an invalid address", async () => {
    for (const [overrides, expected] of [
      [{ wallet_transfer: { address: ADDRESS, network: "ERC20", exact_amount: 10.25, instruction: "" } }, "unexpected_network"],
      [{ wallet_transfer: { address: "0x123", network: "BEP20", exact_amount: 10.25, instruction: "" } }, "invalid_address"],
    ] as const) {
      const fx = createD1Fixture();
      try {
        stubTunvnEnv();
        vi.stubGlobal("fetch", vi.fn(async () => Response.json(depositResponse(overrides as Record<string, unknown>))));
        const db = createDatabaseAccess(fx.db);
        await expect(
          createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now: 1 }),
        ).rejects.toMatchObject({ status: 502, code: expected });
        const row = fx.sql.prepare("SELECT status,error FROM supplier_topups").get() as { status: string; error: string };
        expect(row).toMatchObject({ status: "failed", error: expected });
      } finally {
        fx.close();
      }
    }
  });

  it("401 is a config error and never retried", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
      vi.stubGlobal("fetch", fetchMock);
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now: 1 }),
      ).rejects.toMatchObject({ status: 502, code: "auth_401" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const row = fx.sql.prepare("SELECT status,error FROM supplier_topups").get() as { status: string; error: string };
      expect(row).toMatchObject({ status: "failed", error: "auth_401" });
    } finally {
      fx.close();
    }
  });

  it("status confirmed marks paid", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.includes("/api/deposit/status")) {
          return Response.json({ success: true, deposit: { status: "confirmed" }, paid: true, message: "ok" });
        }
        return Response.json(depositResponse());
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      const refreshed = await refreshSupplierTopup(db, created.id, { now: now + 11_000 });
      expect(refreshed.status).toBe("paid");
      expect(refreshed.paid_at).toBe(now + 11_000);
    } finally {
      fx.close();
    }
  });

  it("expires after the deadline, then a late status confirmation marks paid", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      let paid = false;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.includes("/api/deposit/status")) {
          return Response.json({ success: true, deposit: { status: paid ? "confirmed" : "pending" }, paid, message: "" });
        }
        return Response.json(depositResponse({ expires_in_minutes: 1 }));
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      const expired = await refreshSupplierTopup(db, created.id, { now: now + 70_000 });
      expect(expired.status).toBe("expired");

      paid = true;
      const late = await refreshSupplierTopup(db, created.id, { now: now + 140_000 });
      expect(late.status).toBe("paid");
    } finally {
      fx.close();
    }
  });

  it("H2-18: an undated invoice honours upstream status=expired", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        if (String(url).includes("/api/deposit/status")) {
          return Response.json({ success: true, deposit: { status: "expired" }, paid: false });
        }
        return Response.json(depositResponse({ expires_in_minutes: null }));
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      expect(created.expires_at).toBeNull();
      const refreshed = await refreshSupplierTopup(db, created.id, { now: now + 11_000 });
      expect(refreshed.status).toBe("expired");
    } finally {
      fx.close();
    }
  });

  it("a failed status check (401/404/5xx) keeps the invoice pending and records the error", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      let statusCode = 401;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        if (String(url).includes("/api/deposit/status")) return new Response("{}", { status: statusCode });
        return Response.json(depositResponse());
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      let at = now;
      for (const code of [401, 404, 503]) {
        statusCode = code;
        at += 11_000;
        await expect(refreshSupplierTopup(db, created.id, { now: at })).rejects.toMatchObject({ status: 502 });
        const row = fx.sql.prepare("SELECT status, error FROM supplier_topups WHERE id=?").get(created.id) as { status: string; error: string };
        expect(row.status).toBe("pending");
        expect(row.error).toBeTruthy();
      }
    } finally {
      fx.close();
    }
  });

  it("undated creating/unknown rows stop holding the pending quota after 30 minutes", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const insert = fx.sql.prepare(
        "INSERT INTO supplier_topups (supplier,ref_id,currency,requested_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      );
      const old = now - 31 * 60_000;
      for (let i = 0; i < 3; i++) insert.run("tunvn", `AXVTU-STALE-${i}`, "USDT", 10, i ? "unknown" : "creating", old, old);
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(depositResponse())));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      expect(created.status).toBe("pending");
    } finally {
      fx.close();
    }
  });
});

describe("guards", () => {
  it("rejects with too_many_pending (429) when 3 non-terminal rows are open", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const insert = fx.sql.prepare(
        "INSERT INTO supplier_topups (supplier,ref_id,currency,requested_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      );
      for (let i = 0; i < 3; i++) insert.run("tunvn", `AXVTU-OLD-${i}`, "USDT", 10, "pending", now - 1000, now - 1000);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const db = createDatabaseAccess(fx.db);
      await expect(
        createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now }),
      ).rejects.toMatchObject({ status: 429, code: "too_many_pending" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fx.close();
    }
  });

  it("rejects refresh within 10 seconds (429 too_soon)", async () => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      fx.sql.prepare(
        "INSERT INTO supplier_topups (supplier,ref_id,supplier_ref,currency,requested_amount,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run("tunvn", "AXVTU-1", "TUN-1", "USDT", 10, "pending", now, now);
      const id = Number((fx.sql.prepare("SELECT id FROM supplier_topups").get() as { id: number }).id);
      const db = createDatabaseAccess(fx.db);
      await expect(refreshSupplierTopup(db, id, { now: now + 5_000 })).rejects.toMatchObject({
        status: 429,
        code: "too_soon",
      });
    } finally {
      fx.close();
    }
  });
});

describe("TUNVN parsers", () => {
  it("rejects non-BEP20, bad address and out-of-range exact amount", () => {
    const base = {
      success: true,
      deposit: {
        payment_code: "TUN-1",
        status: "pending",
        amount_usdt: 10,
        expires_in_minutes: 30,
        wallet_transfer: { address: ADDRESS, network: "BEP20", exact_amount: 10.25, instruction: "" },
      },
    };
    expect(parseTunvnDeposit(base, 10)).toMatchObject({ ok: true });
    expect(parseTunvnDeposit({
      ...base, deposit: { ...base.deposit, wallet_transfer: { ...base.deposit.wallet_transfer, network: "TRC20" } },
    }, 10)).toEqual({ ok: false, error: "unexpected_network" });
    expect(parseTunvnDeposit({
      ...base, deposit: { ...base.deposit, wallet_transfer: { ...base.deposit.wallet_transfer, exact_amount: 11 } },
    }, 10)).toEqual({ ok: false, error: "invalid_exact_amount" });
    expect(parseTunvnDepositStatus({ success: true, deposit: { status: "confirmed" } })).toMatchObject({
      ok: true, paid: true,
    });
    expect(parseTunvnDepositStatus({ success: false })).toEqual({ ok: false, error: "status_shape" });
  });
});

describe("routes", () => {
  const get = (query = "") => new NextRequest(`http://localhost/api/admin/supplier-topups${query}`);
  const post = (body: unknown) => new NextRequest("http://localhost/api/admin/supplier-topups", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

  it("returns 401 without admin on all four routes", async () => {
    const fx = createD1Fixture();
    try {
      const { requireAdmin } = await import("@/lib/auth");
      vi.mocked(requireAdmin).mockResolvedValue(null);
      const list = await import("@/app/api/admin/supplier-topups/route");
      const channels = await import("@/app/api/admin/supplier-topups/sekalipay/channels/route");
      const refresh = await import("@/app/api/admin/supplier-topups/[id]/refresh/route");
      expect((await list.GET(get())).status).toBe(401);
      expect((await list.POST(post({ supplier: "tunvn", amount: 10 }))).status).toBe(401);
      expect((await channels.GET(get())).status).toBe(401);
      expect((await refresh.POST(get(), { params: Promise.resolve({ id: "1" }) })).status).toBe(401);
    } finally {
      fx.close();
    }
  });

  it("GET lists items with gates and POST create returns the item", async () => {
    const fx = createD1Fixture();
    try {
      const { requireAdmin } = await import("@/lib/auth");
      vi.mocked(requireAdmin).mockResolvedValue({ email: "fixture@example.test" } as never);
      stubTunvnEnv();
      vi.stubGlobal("fetch", vi.fn(async () =>
        Response.json({
          success: true,
          deposit: {
            payment_code: "TUN-ROUTE",
            status: "pending",
            amount_usdt: 10,
            expires_in_minutes: 30,
            wallet_transfer: { address: ADDRESS, network: "BEP20", exact_amount: 10.25, instruction: "" },
          },
        }),
      ));
      const route = await import("@/app/api/admin/supplier-topups/route");
      const created = await route.POST(post({ supplier: "tunvn", amount: 10 }));
      expect(created.status).toBe(200);
      const createdBody = (await created.json()) as { ok: boolean; item: { supplier_ref: string } };
      expect(createdBody).toMatchObject({ ok: true, item: { supplier_ref: "TUN-ROUTE" } });

      const listed = await route.GET(get("?supplier=tunvn"));
      expect(listed.status).toBe(200);
      const listedBody = (await listed.json()) as {
        ok: boolean; items: unknown[]; gates: { sekalipay: boolean; tunvn: boolean };
      };
      expect(listedBody.ok).toBe(true);
      expect(listedBody.items).toHaveLength(1);
      expect(listedBody.gates).toEqual({ sekalipay: false, tunvn: true });
    } finally {
      fx.close();
    }
  });

  it("POST create maps gates to 503 and bad input to 400", async () => {
    const fx = createD1Fixture();
    try {
      const { requireAdmin } = await import("@/lib/auth");
      vi.mocked(requireAdmin).mockResolvedValue({ email: "fixture@example.test" } as never);
      vi.stubEnv("TUNVN_ENABLED", "false");
      const route = await import("@/app/api/admin/supplier-topups/route");
      const gated = await route.POST(post({ supplier: "tunvn", amount: 10 }));
      expect(gated.status).toBe(503);
      expect(await gated.json()).toEqual({ ok: false, error: "tunvn_unavailable" });

      stubTunvnEnv();
      const invalid = await route.POST(post({ supplier: "tunvn", amount: 0.123 }));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ ok: false, error: "invalid_request" });
    } finally {
      fx.close();
    }
  });

  it("GET channels returns the channel catalogue", async () => {
    const fx = createD1Fixture();
    try {
      const { requireAdmin } = await import("@/lib/auth");
      vi.mocked(requireAdmin).mockResolvedValue({ email: "fixture@example.test" } as never);
      stubSkEnv();
      vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [channel()] })));
      const route = await import("@/app/api/admin/supplier-topups/sekalipay/channels/route");
      const res = await route.GET(get());
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; channels: { service: string }[] };
      expect(body.ok).toBe(true);
      expect(body.channels[0].service).toBe("sk-topup");
    } finally {
      fx.close();
    }
  });
});
