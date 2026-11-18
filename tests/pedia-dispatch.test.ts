// tests/pedia-dispatch.test.ts — PEDIA M4: dispatch exactly-once + poll + kredit.
// Dikunci (caller diinjeksi, tanpa VPS): AC-10 (queued→submitted + supplier
// id), AC-11 (timeout add → needs_check + TANPA add kedua), AC-12 (dua tick
// paralel tidak dobel — klaim lease atomik), AC-13 (partial 40/100 total 10rb
// → kredit 4rb tepat sekali walau poll diulang), AC-14 (konsumsi kredit
// atomik — dua request bersamaan, satu menang).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedPaidItem(over: Record<string, unknown> = {}) {
  const { db: d1 } = createD1Fixture();
  const db = createDatabaseAccess(d1);
  await db.execRun(
    `INSERT INTO orders (code, customer_name, customer_wa, customer_email, items, subtotal,
       payment_method, status, payment_status, sales_channel, order_kind, paid_at)
     VALUES ('AXP-T1', '', '62812', 't@t.com', '[]', 10000,
       'qris', 'lunas', 'paid', 'web', 'pedia', datetime('now'))`,
  );
  await db.execRun(
    `INSERT INTO pedia_products (slug, platform, metric, target_kind, name, packages_json, step, is_active)
     VALUES ('followers-instagram','instagram','followers','profile','Followers Instagram','[100]',10,1)`,
  );
  const p = await db.queryFirst(`SELECT id FROM pedia_products WHERE slug='followers-instagram'`);
  await db.execRun(
    `INSERT INTO pedia_tiers (product_id, tier, supplier, supplier_service_id, price_group,
       markup_pct, min_profit_rp, refill_days, package_prices_json, is_active)
     VALUES (?, 'standar', 'indosmm', 86, 'G3', 20, 1000, 30, '{"100":5000}', 1)`,
    Number(p?.id),
  );
  await db.execRun(
    `INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type,
       rate_idr_per_1k, min_qty, max_qty, present)
     VALUES ('indosmm', 86, 'IG', 'IG', 'Default', 38750, 100, 1000, 1)`,
  );
  await db.execRun(
    `INSERT INTO pedia_order_items
       (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
        quantity, unit_price, total, credit_used, supplier, supplier_service_id,
        supplier_rate_snapshot, status, submit_attempts)
     VALUES ('AXP-T1', ?, 1, '{}', 'https://www.instagram.com/x/',
       'https://www.instagram.com/x/', 100, 100, 10000, 0, 'indosmm', 86, 38750,
       'queued', 0)`,
    Number(p?.id),
  );
  if (over.status) {
    await db.execRun(`UPDATE pedia_order_items SET status=? WHERE order_code='AXP-T1'`, String(over.status));
  }
  if (over.supplier_order_id) {
    await db.execRun(`UPDATE pedia_order_items SET supplier_order_id=?, lease_until=NULL WHERE order_code='AXP-T1'`, String(over.supplier_order_id));
  }
  if (over.start_count !== undefined) {
    await db.execRun(`UPDATE pedia_order_items SET start_count=? WHERE order_code='AXP-T1'`, over.start_count as number | null);
  }
  return db;
}

describe("dispatch exactly-once AC-10/11/12", () => {
  it("queue scope never dispatches another order and an expired deadline does no work", async () => {
    const db = await seedPaidItem();
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const call = vi.fn(async () => ({ ok: true as const, data: { order: "SUP-SCOPE" }, status: 200 }) as never);
    expect(await processPediaPaidOrders(call, db, { orderCode: "AXP-OTHER" })).toMatchObject({ dispatched: 0 });
    expect(await processPediaPaidOrders(call, db, { orderCode: "AXP-T1", deadlineMs: Date.now() - 1 })).toMatchObject({ dispatched: 0 });
    expect(call).not.toHaveBeenCalled();
    expect(await processPediaPaidOrders(call, db, { orderCode: "AXP-T1", deadlineMs: Date.now() + 40000 })).toMatchObject({ dispatched: 1 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(await db.queryFirst("SELECT status FROM pedia_order_items WHERE order_code='AXP-T1'")).toMatchObject({ status: "submitted" });
  });
  it("AC-10: queued → submitted + supplier_order_id tersimpan", async () => {
    const db = await seedPaidItem();
    const calls: string[] = [];
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const out = await processPediaPaidOrders(async (action: string) => {
      calls.push(action);
      return { ok: true as const, data: { order: "SUP-1" }, status: 200 } as never;
    });
    expect(out.dispatched).toBe(1);
    const item = await db.queryFirst(`SELECT status, supplier_order_id FROM pedia_order_items WHERE order_code='AXP-T1'`);
    expect(item?.status).toBe("submitted");
    expect(item?.supplier_order_id).toBe("SUP-1");
    expect(calls[0]).toBe("add");
  });

  it("AC-11: timeout add → needs_check, TANPA add kedua + alert sekali", async () => {
    const db = await seedPaidItem();
    let adds = 0;
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    for (let i = 0; i < 7; i++) {
      await processPediaPaidOrders(async () => {
        adds++;
        return { ok: false as const, kind: "timeout" } as never;
      });
    }
    const item = await db.queryFirst(`SELECT status, submit_attempts FROM pedia_order_items WHERE order_code='AXP-T1'`);
    // Ambiguous submit never retries automatically, regardless of provider.
    expect(item?.status).toBe("needs_check");
    expect(Number(item?.submit_attempts)).toBe(1);
    // Tick ke-7 (sudah needs_check) TIDAK memanggil add lagi.
    expect(adds).toBe(1);
  });

  it("AC-12: dua tick paralel tidak mengirim dobel (klaim lease atomik)", async () => {
    const db = await seedPaidItem();
    let adds = 0;
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const caller = async () => {
      adds++;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true as const, data: { order: "SUP-X" }, status: 200 } as never;
    };
    await Promise.all([processPediaPaidOrders(caller), processPediaPaidOrders(caller)]);
    // SQLite serial: pemenang klaim duluan; pecundang tidak dapat baris.
    expect(adds).toBe(1);
    const item = await db.queryFirst(`SELECT supplier_order_id FROM pedia_order_items WHERE order_code='AXP-T1'`);
    expect(item?.supplier_order_id).toBe("SUP-X");
  });
});

describe("poll + kredit AC-13/14", () => {
  it("parallel ticks claim one supplier GET and an active order waits one minute before polling again", async () => {
    const db=await seedPaidItem({status:"submitted",supplier_order_id:"SUP-POLL"});
    const {processPediaPaidOrders}=await import("@/lib/pedia/dispatch");
    const caller=vi.fn(async()=>{await new Promise(r=>setTimeout(r,5));return {ok:true,data:{status:"Processing"},status:200} as never;});
    await Promise.all([processPediaPaidOrders(caller),processPediaPaidOrders(caller)]);
    expect(caller).toHaveBeenCalledTimes(1);
    const item=await db.queryFirst("SELECT status, (julianday(lease_until)-julianday('now'))*86400 AS wait FROM pedia_order_items WHERE order_code='AXP-T1'");
    expect(item?.status).toBe("in_progress");expect(Number(item?.wait)).toBeGreaterThan(58);expect(Number(item?.wait)).toBeLessThanOrEqual(60);
    await processPediaPaidOrders(caller);expect(caller).toHaveBeenCalledTimes(1);
  });

  it.each([[20,120],[90,300]])("long-running orders aged %i minutes back off to %i seconds",async(age,seconds)=>{
    const db=await seedPaidItem({status:"in_progress",supplier_order_id:"SUP-OLD"});
    await db.execRun("UPDATE pedia_order_items SET created_at=datetime('now',?) WHERE order_code='AXP-T1'",`-${age} minutes`);
    const {processPediaPaidOrders}=await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders(async()=>({ok:true,data:{status:"Processing"},status:200}) as never);
    const row=await db.queryFirst("SELECT (julianday(lease_until)-julianday('now'))*86400 AS wait FROM pedia_order_items WHERE order_code='AXP-T1'");
    expect(Number(row?.wait)).toBeGreaterThan(seconds-2);expect(Number(row?.wait)).toBeLessThanOrEqual(seconds);
  });

  it("a failed supplier status request backs off five minutes without resubmitting",async()=>{
    const db=await seedPaidItem({status:"submitted",supplier_order_id:"SUP-DOWN"});
    const {processPediaPaidOrders}=await import("@/lib/pedia/dispatch");
    const call=vi.fn(async(_action:string)=>({ok:false,kind:"timeout"}) as never);
    await processPediaPaidOrders(call);await processPediaPaidOrders(call);
    expect(call).toHaveBeenCalledTimes(1);expect(call.mock.calls[0][0]).toBe("status");
    const row=await db.queryFirst("SELECT status,(julianday(lease_until)-julianday('now'))*86400 AS wait FROM pedia_order_items WHERE order_code='AXP-T1'");
    expect(row?.status).toBe("submitted");expect(Number(row?.wait)).toBeGreaterThan(298);
  });
  it("partial preserves supplier count and creates one manual follow-up without credit", async () => {
    const db = await seedPaidItem({ status: "submitted", supplier_order_id: "SUP-9" });
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const caller = async () => ({
      ok: true as const, data: { status: "Partial", start_count: "100", remains: "40" }, status: 200,
    }) as never;
    await processPediaPaidOrders(caller);
    await processPediaPaidOrders(caller); // poll diulang — kredit tetap sekali
    const item = await db.queryFirst(`SELECT status, refund_credit_code FROM pedia_order_items WHERE order_code='AXP-T1'`);
    expect(item?.status).toBe("partial");
    expect(item?.refund_credit_code).toBeNull();
    const credits = await db.queryAll(`SELECT * FROM pedia_credits WHERE source_order_code='AXP-T1'`);
    expect(credits).toHaveLength(0);
    expect(await db.queryAll("SELECT state FROM pedia_followups WHERE order_code='AXP-T1'")).toEqual([{state:"open"}]);
  });

  it("credit issuance and redemption are retired without writes", async () => {
    const db = await seedPaidItem();
    const { issuePediaCredit, consumePediaCredit } = await import("@/lib/pedia/credits");
    await expect(issuePediaCredit(db,{email:"t@t.com",amount:10000,sourceKind:"admin"})).rejects.toThrow("credits_retired");
    await expect(consumePediaCredit(db,"PDK-TEST-TEST","AXP-T1",10000)).rejects.toThrow("credits_retired");
    expect(await db.queryAll("SELECT * FROM pedia_credits")).toEqual([]);
  });
});

describe("start_count validation + conditional correction PEDIA-IMPL-ORDER", () => {
  it("Pending start 0 → Completed 8278 corrects the stored slot without guessing", async () => {
    const db = await seedPaidItem({ status: "submitted", supplier_order_id: "SUP-22042392", start_count: 0 });
    await db.execRun(`UPDATE pedia_order_items SET quantity=?, lease_until=NULL WHERE order_code='AXP-T1'`, 50);
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const caller = async () => ({ ok: true as const, data: { status: "Completed", start_count: 8278, remains: 0 }, status: 200 }) as never;
    await processPediaPaidOrders(caller);
    const item = await db.queryFirst(`SELECT status, start_count FROM pedia_order_items WHERE order_code='AXP-T1'`);
    expect(item?.status).toBe("completed");
    expect(item?.start_count).toBe(8278);
  });

  it("blank/missing/invalid/negative/fractional/boolean/object start_count never writes or zeroes", async () => {
    for (const raw of ["", "   ", null, undefined, "abc", -3, 12.5, true, false, { v: 1 }, [5]]) {
      const db = await seedPaidItem({ status: "submitted", supplier_order_id: "SUP-GUARD", start_count: null });
      const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
      const caller = raw === undefined
        ? async () => ({ ok: true as const, data: { status: "In progress", remains: 40 }, status: 200 }) as never
        : async () => ({ ok: true as const, data: { status: "In progress", start_count: raw as never, remains: 40 }, status: 200 }) as never;
      await processPediaPaidOrders(caller);
      const item = await db.queryFirst(`SELECT start_count FROM pedia_order_items WHERE order_code='AXP-T1'`);
      expect(item?.start_count).toBeNull();
    }
  });

  it("real reported 0 is valid; confirmed positive preserved against later conflict", async () => {
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    // Real 0 persists.
    const zero = await seedPaidItem({ status: "submitted", supplier_order_id: "SUP-ZERO", start_count: null });
    await processPediaPaidOrders(async () => ({ ok: true as const, data: { status: "In progress", start_count: 0, remains: 50 }, status: 200 }) as never);
    expect((await zero.queryFirst(`SELECT start_count FROM pedia_order_items WHERE order_code='AXP-T1'`))?.start_count).toBe(0);
    // Confirmed positive 8278 never moves on a later conflicting value.
    const pos = await seedPaidItem({ status: "in_progress", supplier_order_id: "SUP-POS", start_count: 8278 });
    await pos.execRun(`UPDATE pedia_order_items SET lease_until=NULL WHERE order_code='AXP-T1'`);
    await processPediaPaidOrders(async () => ({ ok: true as const, data: { status: "In progress", start_count: 9000, remains: 10 }, status: 200 }) as never);
    expect((await pos.queryFirst(`SELECT start_count FROM pedia_order_items WHERE order_code='AXP-T1'`))?.start_count).toBe(8278);
  });

});

describe("operator recount", () => {
  it("runs only explicit dry-run/apply on historical unmarked rows with CAS protection", async () => {
    const { main } = await import("../scripts/pedia-recount-start-count.mjs");
    const db = await seedPaidItem({ status: "completed", supplier_order_id: "SUP-HISTORY", start_count: 0 });
    const call = vi.fn(async (supplier: string, order: string) => {
      expect([supplier, order]).toEqual(["indosmm", "SUP-HISTORY"]);
      return { status: "Completed", start_count: "8278" };
    });
    const args = ["--database", "fixture", "--code", "AXP-T1", "--limit", "1"];
    expect(await main(args, { db, call })).toMatchObject({ mode: "dry-run", corrected: 1 });
    expect((await db.queryFirst("SELECT start_count,last_error FROM pedia_order_items WHERE order_code='AXP-T1'"))).toEqual({ start_count: 0, last_error: null });
    expect(await main([...args, "--apply"], { db, call })).toMatchObject({ corrected: 1 });
    expect((await db.queryFirst("SELECT start_count FROM pedia_order_items WHERE order_code='AXP-T1'"))?.start_count).toBe(8278);
    await db.execRun("UPDATE pedia_order_items SET start_count=NULL WHERE order_code='AXP-T1'");
    const race = async () => { await db.execRun("UPDATE pedia_order_items SET start_count=99 WHERE order_code='AXP-T1'"); return { status: "Completed", start_count: 123 }; };
    expect(await main([...args, "--apply"], { db, call: race })).toMatchObject({ corrected: 0, skipped: 1 });
    expect((await db.queryFirst("SELECT start_count FROM pedia_order_items WHERE order_code='AXP-T1'"))?.start_count).toBe(99);
    expect(await db.queryAll("SELECT * FROM buyer_notice_log WHERE order_code='AXP-T1'")).toHaveLength(0);
  });

  it("bounds failures and rejects invalid and nonterminal payloads without writes or automatic retry", async () => {
    const { main } = await import("../scripts/pedia-recount-start-count.mjs");
    const db = await seedPaidItem({ status: "completed", supplier_order_id: "SUP-ZERO", start_count: null });
    const args = ["--database=fixture", "--code=AXP-T1", "--limit=1", "--apply"];
    const zero = vi.fn(async () => ({ status: "Completed", start_count: 0 }));
    expect(await main(args, { db, call: zero })).toMatchObject({ zero: 1 });
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    await processPediaPaidOrders(zero as never, db);
    expect(zero).toHaveBeenCalledTimes(1);
    const fail = vi.fn(async () => { throw Error("outage"); });
    await expect(main(args, { db, call: fail })).rejects.toThrow("3 attempts");
    expect(fail).toHaveBeenCalledTimes(3);
    for (const data of [{ status: "Processing", start_count: 4 }, { status: "Completed", start_count: true }, { status: "Completed", start_count: "" }]) {
      expect(await main(args, { db, call: async () => data })).toMatchObject({ skipped: 1 });
    }
    expect((await db.queryFirst("SELECT start_count,last_error FROM pedia_order_items WHERE order_code='AXP-T1'"))).toEqual({ start_count: null, last_error: null });
    await expect(main(["--database=fixture", "--code=AXP-T1", "--limit=bad"], { db, call: zero })).rejects.toThrow();
    await expect(main(["--database=fixture", "--code=AXP-T1", "--unknown"], { db, call: zero })).rejects.toThrow();
    await expect(main(args, { db: { queryAll: async () => { throw Error("SQL failure"); } }, call: zero })).rejects.toThrow("SQL failure");
    await expect(main(args, { db: { queryAll: async () => [{ order_code: "AXP-T1", supplier: "indosmm", supplier_order_id: "1" }], execRun: async () => { throw Error("write failure"); } }, call: async () => ({ status: "Completed", start_count: 1 }) })).rejects.toThrow("write failure");
  });

  it("does not touch timestamps or errors when a shortfall transition guard fails", async () => {
    const db = await seedPaidItem({ status: "completed", supplier_order_id: "SUP-DONE", start_count: null });
    await db.execRun("UPDATE pedia_order_items SET updated_at='2000-01-01 00:00:00' WHERE order_code='AXP-T1'");
    const { finishWithFollowup } = await import("@/lib/pedia/followup");
    expect(await finishWithFollowup(db, "AXP-T1", "partial", "test")).toBe(false);
    expect(await db.queryFirst("SELECT updated_at,last_error FROM pedia_order_items WHERE order_code='AXP-T1'")).toEqual({ updated_at: "2000-01-01 00:00:00", last_error: null });
  });
});
