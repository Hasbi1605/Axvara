// tests/supplier-topups.test.ts — Invoice topup saldo supplier SK + TUNVN + StoreBat.
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
import { parseStorebatDeposit, parseStorebatDepositMethod } from "@/lib/storebat/topup";

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

function stubStorebatEnv() {
  vi.stubEnv("STOREBAT_API_KEY", "storebat-key");
  vi.stubEnv("STOREBAT_BASE_URL", "https://storebat.test/api/reseller");
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

it.each(["sekalipay", "tunvn", "storebat"] as const)("%s refresh only checks for late credit on a failed invoice", async (supplier) => {
  const fx = createD1Fixture();
  try {
    const sk = supplier === "sekalipay";
    const sb = supplier === "storebat";
    if (sk) stubSkEnv();
    else if (sb) stubStorebatEnv();
    else stubTunvnEnv();
    const now = Date.UTC(2026, 10, 20, 8);
    const ref = sk ? "SK-INV-1" : sb ? "dep_late_123" : "TUN-123";
    const statusPath = sk ? "/sk/v1/balance/mutations" : sb ? `/api/reseller/wallet/deposits/${ref}` : "/api/deposit/status";
    let paid = false;
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = new URL(String(url));
      expect(target.pathname).toBe(statusPath);
      expect(init?.method ?? "GET").toBe("GET");
      if (sk) return Response.json({ data: paid ? [{ invoice: ref, direction: "credit", type: "topup", amount: 50_000 }] : [] });
      if (sb) {
        expect(target.searchParams.get("refresh")).toBe("true");
        return Response.json({
          success: true,
          deposit: {
            deposit_id: ref,
            status: paid ? "CREDITED" : "EXPIRED",
            wallet_credit_amount: 10,
            pay_amount: 10.02,
            pay_currency: "USDTBSC",
            network: "BEP20",
            address: ADDRESS,
          },
        });
      }
      expect(target.searchParams.get("code")).toBe(ref);
      return Response.json({ success: true, deposit: { status: paid ? "confirmed" : "expired" }, paid });
    });
    vi.stubGlobal("fetch", fetchMock);
    fx.sql.prepare(`INSERT INTO supplier_topups
      (supplier,ref_id,supplier_ref,channel,currency,requested_amount,status,error,created_at,updated_at,expires_at)
      VALUES (?,'AXVTU-late-credit',?,?,?,?,'failed','create_failed',?,?,?)`)
      .run(supplier, ref, sk ? "sk-topup" : sb ? "USDT_BEP20" : null, sk ? "IDR" : "USDT", sk ? 50_000 : 10, now, now, now + 60_000);
    const db = createDatabaseAccess(fx.db);
    for (const elapsed of [11_000, 61_000]) {
      const unpaid = await refreshSupplierTopup(db, 1, { now: now + elapsed });
      expect(unpaid).toMatchObject({ status: "failed", paid_at: null, error: "create_failed", updated_at: now + elapsed });
      await expect(refreshSupplierTopup(db, 1, { now: now + elapsed + 1 })).rejects.toMatchObject({ status: 429, code: "too_soon" });
    }
    paid = true;
    const paidAt = now + 72_000;
    const refreshed = await refreshSupplierTopup(db, 1, { now: paidAt });
    expect(refreshed).toMatchObject({ status: "paid", paid_at: paidAt, error: null });
    if (sk) expect(refreshed.credit_amount).toBe(50_000);
    if (sb) expect(refreshed.credit_amount).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await refreshSupplierTopup(db, 1, { now: paidAt + 11_000 })).toEqual(refreshed);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally { fx.close(); }
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
        if (s.includes("/sk/v1/balance/mutations")) return Response.json({ data: [] });
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
  it.each([true, false])("checks a known invoice with no link for credit (paid=%s), then expiry", async (paid) => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const fetchMock = vi.fn(async (url: unknown) => {
        const path = String(url);
        if (path.includes("/balance/channels")) return Response.json({ data: [channel()] });
        if (path.includes("/balance/mutations")) {
          return Response.json({ data: paid ? [{ invoice: "SK-INV-1", direction: "credit", type: "topup", amount: 50_000 }] : [] });
        }
        return Response.json({ message: "REF_ID_ALREADY_EXIST" }, { status: 400 });
      });
      vi.stubGlobal("fetch", fetchMock);
      fx.sql.prepare(`INSERT INTO supplier_topups
        (supplier,ref_id,supplier_ref,channel,currency,requested_amount,status,created_at,updated_at,expires_at)
        VALUES ('sekalipay','AXVTU-missing-link','SK-INV-1','sk-topup','IDR',50000,'pending',?,?,?)`).run(now, now, now + 60_000);
      const result = await refreshSupplierTopup(createDatabaseAccess(fx.db), 1, { now: now + 61_000 });
      expect(result).toMatchObject({ status: paid ? "paid" : "expired", paid_at: paid ? now + 61_000 : null });
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/sk/v1/balance/mutations"]);
    } finally { fx.close(); }
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

  it.each([true, false])("concurrent refresh preserves paid (paid resolves first=%s)", async (paidFirst) => {
    const fx = createD1Fixture();
    try {
      stubTunvnEnv();
      const now = Date.UTC(2026, 10, 20, 8);
      const paid = Promise.withResolvers<Response>();
      const unpaid = Promise.withResolvers<Response>();
      const status = vi.fn().mockReturnValueOnce(paid.promise).mockReturnValueOnce(unpaid.promise);
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("/api/deposit/status")
        ? status() : Response.json(depositResponse({ expires_in_minutes: 1 }))));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "tunvn", amount: 10 }, { now });
      fx.sql.exec(`CREATE TABLE paid_transitions (paid_at INTEGER);
        CREATE TRIGGER record_topup_payment AFTER UPDATE OF status ON supplier_topups
        WHEN OLD.status <> 'paid' AND NEW.status = 'paid'
        BEGIN INSERT INTO paid_transitions VALUES (NEW.paid_at); END;`);
      const confirmed = refreshSupplierTopup(db, created.id, { now: now + 70_000 });
      const expired = refreshSupplierTopup(db, created.id, { now: now + 71_000 });
      await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2));
      const resolvePaid = () => paid.resolve(Response.json({ success: true, deposit: { status: "confirmed" }, paid: true }));
      const resolveUnpaid = () => unpaid.resolve(Response.json({ success: true, deposit: { status: "expired" }, paid: false }));
      if (paidFirst) {
        resolvePaid();
        expect(await confirmed).toMatchObject({ status: "paid", paid_at: now + 70_000 });
        resolveUnpaid();
        expect(await expired).toMatchObject({ status: "paid", paid_at: now + 70_000 });
      } else {
        resolveUnpaid();
        expect(await expired).toMatchObject({ status: "expired", paid_at: null });
        resolvePaid();
        expect(await confirmed).toMatchObject({ status: "paid", paid_at: now + 70_000 });
      }
      expect(fx.sql.prepare("SELECT status,paid_at FROM supplier_topups").get()).toMatchObject({ status: "paid", paid_at: now + 70_000 });
      expect(fx.sql.prepare("SELECT paid_at FROM paid_transitions").all()).toEqual([{ paid_at: now + 70_000 }]);
    } finally { fx.close(); }
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
  it("reserves only three pending slots across simultaneous creates, before any supplier POST", async () => {
    const fx = createD1Fixture();
    try {
      stubSkEnv();
      let posted = 0;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => String(url).includes("/balance/channels")
        ? Response.json({ data: [channel()] })
        : Response.json({ data: skInvoice({ invoice: `SK-INV-${++posted}` }) })));
      const db = createDatabaseAccess(fx.db);
      const now = Date.UTC(2026, 10, 20, 8);
      const attempts = await Promise.allSettled(Array.from({ length: 6 }, () =>
        createSupplierTopup(db, { supplier: "sekalipay", code: "sk-topup", amount: 50_000 }, { now })));
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(3);
      for (const attempt of attempts) if (attempt.status === "rejected") {
        expect(attempt.reason).toMatchObject({ status: 429, code: "too_many_pending" });
      }
      expect(posted).toBe(3);
      expect(fx.sql.prepare("SELECT COUNT(*) AS n FROM supplier_topups").get()?.n).toBe(3);
    } finally { fx.close(); }
  });
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

describe("StoreBat topup", () => {
  function methodsResponse(overrides: Record<string, unknown> = {}) {
    return {
      success: true,
      methods: [{
        network: "BEP20",
        asset: "USDT",
        provider_currency: "USDTBSC",
        available: true,
        minimum_deposit_usd: 0.0661334,
        fee: { ventebot_fee_usd: 0, provider_quote_included: true },
        expiry_seconds: 300,
        error: null,
        ...overrides,
      }],
    };
  }

  function sbDepositResponse(overrides: Record<string, unknown> = {}, idempotent = false) {
    return {
      success: true,
      idempotent,
      deposit: {
        deposit_id: "dep_sb_001",
        status: "WAITING",
        provider_status: "waiting",
        wallet_credit_amount: 5,
        pay_amount: 5.012345,
        pay_currency: "USDTBSC",
        network: "BEP20",
        address: ADDRESS,
        actually_paid: 0,
        expires_at: "2026-11-25T08:05:00Z",
        ...overrides,
      },
    };
  }

  it("preflights deposit-methods and creates an idempotent USDT BEP20 deposit", async () => {
    const fx = createD1Fixture();
    try {
      stubStorebatEnv();
      const now = Date.UTC(2026, 10, 25, 8, 0, 0);
      const posts: Record<string, unknown>[] = [];
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        expect((init?.headers as Record<string, string>)["X-Reseller-Key"]).toBe("storebat-key");
        if (s.endsWith("/wallet/deposit-methods")) return Response.json(methodsResponse());
        if (s.endsWith("/wallet/deposits")) {
          posts.push(JSON.parse(String(init?.body ?? "{}")));
          return Response.json(sbDepositResponse(), { status: 201 });
        }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      const item = await createSupplierTopup(db, { supplier: "storebat", amount: 5 }, { now });
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({ amount_usd: 5, network: "BEP20", idempotency_key: item.ref_id, reference: item.ref_id });
      expect(item).toMatchObject({
        supplier: "storebat",
        status: "pending",
        supplier_ref: "dep_sb_001",
        channel: "USDT_BEP20",
        currency: "USDT",
        requested_amount: 5,
        pay_amount: 5.012345,
        credit_amount: 5,
        fee_amount: 0.012345,
        expires_at: Date.parse("2026-11-25T08:05:00Z"),
      });
      expect(item.payment).toMatchObject({ address: ADDRESS, network: "BEP20", exact_amount: 5.012345, pay_currency: "USDTBSC", upstream_status: "WAITING" });
    } finally {
      fx.close();
    }
  });

  it("blocks create before POST when BEP20 method is unavailable or below minimum", async () => {
    for (const [override, status, code] of [
      [{ available: false }, 409, "channel_unavailable"],
      [{ minimum_deposit_usd: 10 }, 400, "amount_out_of_range"],
    ] as const) {
      const fx = createD1Fixture();
      try {
        stubStorebatEnv();
        const posts: unknown[] = [];
        vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
          if (String(url).endsWith("/wallet/deposit-methods")) return Response.json(methodsResponse(override));
          posts.push(init?.body);
          throw new Error("POST must not be called");
        }));
        const db = createDatabaseAccess(fx.db);
        await expect(createSupplierTopup(db, { supplier: "storebat", amount: 5 }, { now: 1 })).rejects.toMatchObject({ status, code });
        expect(posts).toHaveLength(0);
      } finally {
        fx.close();
      }
    }
  });

  it("recovers an ambiguous create by replaying the SAME idempotency_key on refresh", async () => {
    const fx = createD1Fixture();
    try {
      stubStorebatEnv();
      const now = Date.UTC(2026, 10, 25, 8, 0, 0);
      const posts: Record<string, unknown>[] = [];
      let failPost = true;
      vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
        const s = String(url);
        if (s.endsWith("/wallet/deposit-methods")) return Response.json(methodsResponse());
        if (s.endsWith("/wallet/deposits")) {
          posts.push(JSON.parse(String(init?.body ?? "{}")));
          if (failPost) return new Response("{}", { status: 503 });
          return Response.json(sbDepositResponse({}, true), { status: 200 });
        }
        throw new Error(`Unexpected fetch ${s}`);
      }));
      const db = createDatabaseAccess(fx.db);
      await expect(createSupplierTopup(db, { supplier: "storebat", amount: 5 }, { now })).rejects.toMatchObject({ status: 502, code: "storebat_http_503" });
      const row = fx.sql.prepare("SELECT id,ref_id,status,supplier_ref FROM supplier_topups").get() as { id: number; ref_id: string; status: string; supplier_ref: string | null };
      expect(row).toMatchObject({ status: "unknown", supplier_ref: null });

      failPost = false;
      const recovered = await refreshSupplierTopup(db, row.id, { now: now + 11_000 });
      expect(posts).toHaveLength(2);
      expect(posts[1].idempotency_key).toBe(posts[0].idempotency_key);
      expect(posts[1].idempotency_key).toBe(row.ref_id);
      expect(recovered).toMatchObject({ status: "pending", supplier_ref: "dep_sb_001", pay_amount: 5.012345 });
    } finally {
      fx.close();
    }
  });

  it("tracks CREATING -> CONFIRMING -> CREDITED and handles UNDERPAID / EXPIRED -> late CREDITED", async () => {
    const fx = createD1Fixture();
    try {
      stubStorebatEnv();
      const now = Date.UTC(2026, 10, 25, 8, 0, 0);
      let state: Record<string, unknown> = { status: "CREATING", address: null, pay_amount: null };
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.endsWith("/wallet/deposit-methods")) return Response.json(methodsResponse());
        if (s.includes("/wallet/deposits/dep_sb_001?refresh=true")) return Response.json(sbDepositResponse(state));
        return Response.json(sbDepositResponse(state), { status: 201 });
      }));
      const db = createDatabaseAccess(fx.db);
      const created = await createSupplierTopup(db, { supplier: "storebat", amount: 5 }, { now });
      expect(created).toMatchObject({ status: "creating", supplier_ref: "dep_sb_001", payment: null });

      state = { status: "CONFIRMING", address: ADDRESS, pay_amount: 5.012345 };
      const confirming = await refreshSupplierTopup(db, created.id, { now: now + 11_000 });
      expect(confirming).toMatchObject({ status: "pending", pay_amount: 5.012345 });
      expect(confirming.payment?.upstream_status).toBe("CONFIRMING");

      state = { status: "UNDERPAID", address: ADDRESS, pay_amount: 5.012345 };
      const underpaid = await refreshSupplierTopup(db, created.id, { now: now + 22_000 });
      expect(underpaid).toMatchObject({ status: "unknown", error: "storebat_underpaid" });

      state = { status: "EXPIRED", address: ADDRESS, pay_amount: 5.012345 };
      const expired = await refreshSupplierTopup(db, created.id, { now: now + 33_000 });
      expect(expired).toMatchObject({ status: "expired" });

      state = { status: "CREDITED", address: ADDRESS, pay_amount: 5.012345, wallet_credit_amount: 5 };
      const credited = await refreshSupplierTopup(db, created.id, { now: now + 44_000 });
      expect(credited).toMatchObject({ status: "paid", paid_at: now + 44_000, credit_amount: 5, error: null });
    } finally {
      fx.close();
    }
  });

  it("validates StoreBat parsers strictly", () => {
    expect(parseStorebatDepositMethod(methodsResponse())).toMatchObject({ ok: true, method: { network: "BEP20", available: true } });
    expect(parseStorebatDepositMethod({ success: false })).toEqual({ ok: false, error: "storebat_methods_shape" });
    expect(parseStorebatDeposit(sbDepositResponse({ expires_at: "2026-11-25 08:05:00" }), 5)).toMatchObject({
      ok: true,
      deposit: { expires_at: Date.parse("2026-11-25T08:05:00Z") },
    });
    expect(parseStorebatDeposit(sbDepositResponse({ network: "TRC20" }), 5)).toMatchObject({ ok: false, error: "unexpected_network" });
    expect(parseStorebatDeposit(sbDepositResponse({ address: "0x123" }), 5)).toMatchObject({ ok: false, error: "invalid_address" });
    expect(parseStorebatDeposit(sbDepositResponse({ pay_amount: 999 }), 5)).toMatchObject({ ok: false, error: "invalid_pay_amount" });
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
        ok: boolean; items: unknown[]; gates: { sekalipay: boolean; tunvn: boolean; storebat: boolean };
      };
      expect(listedBody.ok).toBe(true);
      expect(listedBody.items).toHaveLength(1);
      expect(listedBody.gates).toEqual({ sekalipay: false, tunvn: true, storebat: false });
    } finally {
      fx.close();
    }
  });

  it("POST/GET supports storebat and maps unconfigured storebat to 503", async () => {
    const fx = createD1Fixture();
    try {
      const { requireAdmin } = await import("@/lib/auth");
      vi.mocked(requireAdmin).mockResolvedValue({ email: "fixture@example.test" } as never);
      const route = await import("@/app/api/admin/supplier-topups/route");
      const gated = await route.POST(post({ supplier: "storebat", amount: 5 }));
      expect(gated.status).toBe(503);
      expect(await gated.json()).toEqual({ ok: false, error: "storebat_unavailable" });

      stubStorebatEnv();
      vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
        const s = String(url);
        if (s.endsWith("/wallet/deposit-methods")) {
          return Response.json({
            success: true,
            methods: [{ network: "BEP20", asset: "USDT", provider_currency: "USDTBSC", available: true, minimum_deposit_usd: 0.07, expiry_seconds: 300 }],
          });
        }
        return Response.json({
          success: true,
          idempotent: false,
          deposit: {
            deposit_id: "dep_route_1",
            status: "WAITING",
            wallet_credit_amount: 5,
            pay_amount: 5.012345,
            pay_currency: "USDTBSC",
            network: "BEP20",
            address: ADDRESS,
            expires_at: "2026-11-25T04:00:00Z",
          },
        }, { status: 201 });
      }));
      const created = await route.POST(post({ supplier: "storebat", amount: 5 }));
      expect(created.status).toBe(200);
      expect(await created.json()).toMatchObject({ ok: true, item: { supplier: "storebat", supplier_ref: "dep_route_1", pay_amount: 5.012345 } });

      const listed = await route.GET(get("?supplier=storebat"));
      expect(listed.status).toBe(200);
      const body = (await listed.json()) as { ok: boolean; items: unknown[]; gates: { sekalipay: boolean; tunvn: boolean; storebat: boolean } };
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(1);
      expect(body.gates).toEqual({ sekalipay: false, tunvn: false, storebat: true });
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
