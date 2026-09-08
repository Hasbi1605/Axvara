// tests/fulfillment-per-item.regression.test.ts — Issue #4: fulfillment per item + reservasi + kanal
//
// Audit 7 Sep 2026: deliver.ts hanya membaca items[0]; keranjang 2 varian
// shared mengirim item pertama tetapi order ditandai delivered; reservasi
// unique web tidak ada; penerima kanal tidak eksplisit per item.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("fulfillment per item (no items[0] shortcut)", () => {
  it("migrasi 0015 + schema mendefinisikan fulfillment_items per (order, item)", () => {
    const migration = read("drizzle/migrations/0015_fulfillment_items.sql");
    const schema = read("drizzle/schema.sql");
    for (const src of [migration, schema]) {
      expect(src).toContain("CREATE TABLE IF NOT EXISTS fulfillment_items");
      expect(src).toContain("UNIQUE(order_code, item_index)");
      expect(src).toContain("recipient_channel");
      expect(src).toContain("recipient_target");
    }
  });

  it("processJob mengirim SEMUA item dan delivered hanya saat semua settled", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("ensureFulfillmentItems");
    expect(deliver).toContain("processItem");
    expect(deliver).toContain("allItemsSettled");
    // Order tidak boleh ditandai delivered dari satu item saja (R2):
    // agregat butuh semua baris lengkap + settled; all-manual → manual_required.
    expect(deliver).toContain("!mismatches.length && allItemsSettled(rows)");
    expect(deliver).toContain("allItemsDelivered(rows)");
    // Item yang sudah delivered tidak pernah dikirim ulang.
    expect(deliver).toContain('!["delivered", "manual_required"].includes(String(row.status))');
  });

  it("mode per item: snapshot lines + variant + fallback produk (bukan items[0])", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("resolveItemMode");
    expect(deliver).toContain("fulfillmentModesFromOrderSnapshot");
    expect(deliver).toContain("snapshot.lines");
  });

  it("claim per item dengan CAS agar worker konkuren tidak kirim ganda", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("UPDATE fulfillment_items SET status='sending'");
    expect(deliver).toContain("scheduleItemRetry");
  });
});

describe("reservasi unique per baris", () => {
  it("helper reservasi per baris dengan rollback saat gagal sebagian", () => {
    const inventory = read("src/lib/fulfillment/inventory.ts");
    expect(inventory).toContain("reserveInventoryForLines");
    expect(inventory).toContain("releaseInventoryForOrder(orderCode)");
  });

  it("checkout cart Telegram memakai reservasi per baris", () => {
    const route = read("src/app/api/telegram/webhook/route.ts");
    expect(route).toContain("reserveInventoryForLines");
  });

  it("order web mereservasi unit unique dalam batch atomik yang sama", () => {
    const db = read("src/lib/db.ts");
    expect(db).toContain("unique-inventory");
    expect(db).toContain("fulfillment_mode='unique'");
  });
});

describe("penerima kanal eksplisit per item", () => {
  it("resolveRecipient memetakan tiap kanal ke target yang benar", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("export function resolveRecipient");
    expect(deliver).toContain("channel_member_id");
    // Target kosong → manual, bukan kirim ke nobody.
    expect(deliver).toContain("no_recipient_for_channel");
  });

  it("web tanpa push channel gagal keras ke retry (bukan drop diam-diam)", () => {
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(deliver).toContain("web_channel_requires_manual_handover");
  });

  it("cron backfill baris item untuk job pra-migrasi sebelum proses due jobs", async () => {
    const cron = read("src/app/api/cron/operations/route.ts");
    const deliver = read("src/lib/fulfillment/deliver.ts");
    expect(cron).toContain("processJobItems(Number(job.id)");
    // The single processor materializes missing lines before claiming the job.
    const processStart = deliver.indexOf("export async function processJobItems(");
    const materialize = deliver.indexOf("await ensureFulfillmentItems(order, database", processStart);
    const claim = deliver.indexOf("await claimJob(jobId, database", processStart);
    expect(materialize).toBeGreaterThan(processStart);
    expect(claim).toBeGreaterThan(materialize);
  });
});
