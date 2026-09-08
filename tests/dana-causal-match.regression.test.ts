// tests/dana-causal-match.regression.test.ts — Issue #2: stale payment vs new order
//
// Audit 7 Sep 2026: event lama dapat melunasi invoice baru dengan nominal
// sama melalui retry_match. QRIS Hook tidak membawa stempel waktu tepercaya
// dari DANA, sehingga satu-satunya syarat kausalitas yang dapat ditegakkan
// secara deterministik adalah waktu observasi server:
//   event.created_at (diamati) >= invoice.created_at (diterbitkan).
// Event yang diamati SEBELUM invoice dibuat tidak mungkin membayarnya.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DANA_MATCH_CLOCK_SKEW_MS,
  isCausallyPlausiblePayment,
  parseDbTimeUtc,
} from "@/lib/payments/dana-qris";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("causal payment matching (event must not predate invoice)", () => {
  it("rejects an event observed before the invoice was issued", () => {
    // Event lama (diamati 10.00) vs invoice baru (terbit 10.05): tidak cocok.
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:00:00.000Z", "2026-09-07T10:05:00.000Z"),
    ).toBe(false);
  });

  it("accepts an event observed at or after the invoice was issued", () => {
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:05:00.000Z", "2026-09-07T10:05:00.000Z"),
    ).toBe(true);
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:06:00.000Z", "2026-09-07T10:05:00.000Z"),
    ).toBe(true);
  });

  it("does not tolerate events predating an invoice from the same database clock", () => {
    expect(DANA_MATCH_CLOCK_SKEW_MS).toBe(0);
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:04:30.000Z", "2026-09-07T10:05:00.000Z"),
    ).toBe(false);
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:00:00.000Z", "2026-09-07T10:05:00.000Z"),
    ).toBe(false);
  });

  it("fails closed on unparsable timestamps instead of force-matching", () => {
    expect(isCausallyPlausiblePayment(null, "2026-09-07T10:05:00.000Z")).toBe(false);
    expect(isCausallyPlausiblePayment("2026-09-07T10:06:00.000Z", null)).toBe(false);
    expect(isCausallyPlausiblePayment("bukan-tanggal", "juga-bukan")).toBe(false);
  });

  it("reads legacy space-separated D1 timestamps as UTC, not server-local", () => {
    // D1 datetime('now') is UTC; parsing it as WIB-local would shift the
    // invoice +7h and make a stale event look newer than the invoice.
    expect(parseDbTimeUtc("2026-09-07 10:05:00")).toBe(Date.parse("2026-09-07T10:05:00Z"));
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:04:30.000Z", "2026-09-07 10:05:00"),
    ).toBe(false);
    expect(
      isCausallyPlausiblePayment("2026-09-07T10:05:30.000Z", "2026-09-07 10:05:00"),
    ).toBe(true);
  });
});

describe("webhook + retry_match enforce causality, CAS, and triage", () => {
  const webhook = () => read("src/app/api/webhook/dana/route.ts");
  const retry = () => read("src/app/api/admin/payments/events/route.ts");

  it("both paths compare event observation time against invoice creation time", () => {
    for (const src of [webhook(), retry()]) {
      expect(src).toContain("isCausallyPlausiblePayment");
      expect(src).toContain("invoice_created_at");
      expect(src).toContain("event_predates_invoice");
    }
  });

  it("ambiguous candidates never settle an order (single plausible match required)", () => {
    expect(webhook()).toContain("plausible.length === 1");
    expect(retry()).toContain("matches.length !== 1");
    expect(retry()).toContain("multiple_active_exact_amount");
  });

  it("settling an event is compare-and-set so replays cannot double-fulfill", () => {
    expect(webhook()).toContain("WHERE id=? AND status='received'");
    expect(retry()).toContain("AND status IN ('received','ignored','failed')");
    expect(webhook()).toContain('status: "duplicate"');
  });

  it("late notifications and amount reuse stay visible in reconciliation", () => {
    // Alasan triase yang jelas, bukan pencocokan paksa diam-diam.
    expect(webhook()).toContain("event_predates_invoice");
    expect(webhook()).toContain("no_active_exact_amount");
    // Batasan kanal didokumentasikan pada helper (bukan disembunyikan).
    expect(read("src/lib/payments/dana-qris.ts")).toContain("Batasan yang diakui");
  });
});
