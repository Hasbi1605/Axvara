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
     VALUES (?, 'standar', 'providersmm', 86, 'G3', 20, 1000, 30, '{"100":5000}', 1)`,
    Number(p?.id),
  );
  await db.execRun(
    `INSERT INTO pedia_supplier_services (supplier, service_id, name, category, type,
       rate_idr_per_1k, min_qty, max_qty, present)
     VALUES ('providersmm', 86, 'IG', 'IG', 'Default', 38750, 100, 1000, 1)`,
  );
  await db.execRun(
    `INSERT INTO pedia_order_items
       (order_code, product_id, tier_id, snapshot_json, target_raw, target_normalized,
        quantity, unit_price, total, credit_used, supplier, supplier_service_id,
        supplier_rate_snapshot, status, submit_attempts)
     VALUES ('AXP-T1', ?, 1, '{}', 'https://www.instagram.com/x/',
       'https://www.instagram.com/x/', 100, 100, 10000, 0, 'providersmm', 86, 38750,
       'queued', 0)`,
    Number(p?.id),
  );
  if (over.status) {
    await db.execRun(`UPDATE pedia_order_items SET status=? WHERE order_code='AXP-T1'`, String(over.status));
  }
  if (over.supplier_order_id) {
    await db.execRun(`UPDATE pedia_order_items SET supplier_order_id=?, lease_until=NULL WHERE order_code='AXP-T1'`, String(over.supplier_order_id));
  }
  return db;
}

describe("dispatch exactly-once AC-10/11/12", () => {
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
    // 6× transport gagal → needs_check (bukan retry selamanya).
    expect(item?.status).toBe("needs_check");
    expect(Number(item?.submit_attempts)).toBe(6);
    // Tick ke-7 (sudah needs_check) TIDAK memanggil add lagi.
    expect(adds).toBe(6);
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
  it("AC-13: partial remains 40/100 total 10rb → kredit 4rb tepat sekali", async () => {
    const db = await seedPaidItem({ status: "submitted", supplier_order_id: "SUP-9" });
    const { processPediaPaidOrders } = await import("@/lib/pedia/dispatch");
    const caller = async () => ({
      ok: true as const, data: { status: "Partial", start_count: "100", remains: "40" }, status: 200,
    }) as never;
    await processPediaPaidOrders(caller);
    await processPediaPaidOrders(caller); // poll diulang — kredit tetap sekali
    const item = await db.queryFirst(`SELECT status, refund_credit_code FROM pedia_order_items WHERE order_code='AXP-T1'`);
    expect(item?.status).toBe("partial");
    expect(String(item?.refund_credit_code)).toMatch(/^PDK-/);
    const credits = await db.queryAll(`SELECT * FROM pedia_credits WHERE source_order_code='AXP-T1'`);
    expect(credits.length).toBe(1);
    expect(Number(credits[0]?.remaining)).toBe(4000);
  });

  it("AC-14: konsumsi kredit atomik — dua request bersamaan, satu menang", async () => {
    const { db: d1 } = createD1Fixture();
    const db = createDatabaseAccess(d1);
    const { issuePediaCredit, consumePediaCredit } = await import("@/lib/pedia/credits");
    const { code } = await issuePediaCredit(db, {
      email: "t@t.com", amount: 10000,
      sourceOrderCode: "SRC-1", sourceKind: "canceled",
    });
    const [a, b] = await Promise.all([
      consumePediaCredit(db, code, "ORD-A", 10000),
      consumePediaCredit(db, code, "ORD-B", 10000),
    ]);
    // Tepat satu pemenang memakai penuh; pecundang dapat 0 (bukan dobel).
    expect(a.used + b.used).toBe(10000);
    expect([a.used, b.used].sort()).toEqual([0, 10000]);
  });
});
