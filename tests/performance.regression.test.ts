import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import { createRequire } from "node:module";
import { middleware } from "@/middleware";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Performance regression guards", () => {
  it("mengizinkan webpack eval hanya saat development agar hydration lokal berjalan", () => {
    vi.stubEnv("NODE_ENV", "development");
    const devResponse = middleware(new NextRequest("http://127.0.0.1:3000/"));
    expect(devResponse.headers.get("content-security-policy")).toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "production");
    const prodResponse = middleware(new NextRequest("https://axvara.pages.dev/"));
    expect(prodResponse.headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
  });

  it("tidak lagi mengizinkan koneksi runtime ke Iconify", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = middleware(new NextRequest("https://axvara.pages.dev/"));
    expect(response.headers.get("content-security-policy")).not.toContain("api.iconify.design");
  });
});

describe("predikat penjadwalan memakai index, bukan full scan", () => {
  // Seluruh query cron/lease membandingkan `datetime(kolom)` dan bukan kolomnya
  // langsung — pembungkus itu WAJIB karena baris lama berformat spasi dan baris
  // baru ISO (lihat D1_EXPIRY_PREDICATE). Efek sampingnya: index biasa pada
  // kolom TIDAK bisa dipakai planner untuk ekspresi fungsi, sehingga query
  // memindai tabel. Solusinya index atas ekspresi yang sama — tanpa mengubah
  // satu pun query. Test ini memakai EXPLAIN QUERY PLAN sebagai bukti.
  function plan(query: string): string {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
      DatabaseSync: new (path: string) => { exec: (sql: string) => void; prepare: (sql: string) => { all: () => { detail: string }[] } };
    };
    const db = new DatabaseSync(":memory:");
    db.exec(fs.readFileSync("drizzle/schema.sql", "utf8"));
    return db.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map((row) => row.detail).join(" | ");
  }

  it("fulfillment_jobs jatuh tempo memakai index ekspresi", () => {
    const detail = plan(
      `SELECT id FROM fulfillment_jobs
       WHERE status IN ('queued','retry') AND datetime(next_attempt_at) <= datetime('now') LIMIT 8`,
    );
    expect(detail).toContain("idx_fulfillment_jobs_next_dt");
    expect(detail).not.toContain("SCAN fulfillment_jobs");
  });

  it("fulfillment_items jatuh tempo memakai index ekspresi", () => {
    const detail = plan(
      `SELECT id FROM fulfillment_items WHERE status='queued' AND datetime(next_attempt_at) <= datetime('now')`,
    );
    expect(detail).toContain("idx_fulfillment_items_next_dt");
    expect(detail).not.toContain("SCAN fulfillment_items");
  });

  it("order kedaluwarsa memakai index ekspresi", () => {
    const detail = plan(
      `SELECT code FROM orders WHERE status='pending' AND datetime(expires_at) < datetime('now')`,
    );
    expect(detail).toContain("idx_orders_expires_dt");
    expect(detail).not.toContain("SCAN orders");
  });

  it("outbox WhatsApp jatuh tempo memakai index ekspresi", () => {
    const detail = plan(
      `SELECT id FROM whatsapp_outbox WHERE status='pending' AND datetime(next_attempt_at) <= datetime('now')`,
    );
    expect(detail).toContain("idx_whatsapp_outbox_next_dt");
    expect(detail).not.toContain("SCAN whatsapp_outbox");
  });
});
