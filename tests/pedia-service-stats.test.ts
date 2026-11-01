import { describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import { parsePediaStats, pediaServiceHealth, refreshPediaServiceStats, PEDIA_STATS_URL } from "@/lib/pedia/service-stats";

const payload = { periodHours: 168, analyzedAt: "2026-11-01T00:00:00Z", services: [
  { id: "10", orderCount: 50, successRate: 99, cancelRate: 1, refillRate: 1, aiScore: 88 },
  { id: "11", orderCount: 9, successRate: 22, cancelRate: 78, refillRate: 50, aiScore: 25 },
  { id: "99", orderCount: 5, successRate: 100, cancelRate: 0, refillRate: 0, aiScore: 90 },
  { id: "bad", orderCount: 1 },
] };
const ok = () => vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));

describe("Pedia service stats", () => {
  it("classifies health from 7-day supplier data", () => {
    expect(pediaServiceHealth({ orders_7d: 50, success_rate: 99, cancel_rate: 1, ai_score: 88 })).toBe("sehat");
    expect(pediaServiceHealth({ orders_7d: 5, success_rate: 92, cancel_rate: 8, ai_score: 70 })).toBe("cukup");
    expect(pediaServiceHealth({ orders_7d: 9, success_rate: 22, cancel_rate: 78, ai_score: 25 })).toBe("berisiko");
    expect(pediaServiceHealth({ orders_7d: 0 })).toBe("belum_ada_data");
    expect(pediaServiceHealth(null)).toBe("belum_ada_data");
    expect(parsePediaStats({ ...payload, periodHours: 24 })).toBeNull();
    expect(parsePediaStats({})).toBeNull();
  });

  it("upserts only services used by tiers, once per hour, and ignores a broken source", async () => {
    const f = createD1Fixture();
    try {
      f.sql.exec("INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name) VALUES(1,'p','instagram','followers','profile','P')");
      f.sql.exec("INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp) VALUES(1,1,'standar','indosmm',10,'G3',20,1000),(2,1,'standar','indosmm',11,'G3',20,1000)");
      f.sql.exec("INSERT INTO pedia_service_stats(supplier,service_id,avg_time,orders_7d) VALUES('indosmm',10,'19 menit',1)");
      const db = createDatabaseAccess();
      const fetcher = ok();
      expect(await refreshPediaServiceStats(db, fetcher as never)).toBe(2);
      expect((fetcher.mock.calls[0] as unknown[])[0]).toBe(PEDIA_STATS_URL);
      expect(f.sql.prepare("SELECT service_id,avg_time,orders_7d,success_rate,ai_score FROM pedia_service_stats ORDER BY service_id").all()).toEqual([
        { service_id: 10, avg_time: "19 menit", orders_7d: 50, success_rate: 99, ai_score: 88 },
        { service_id: 11, avg_time: null, orders_7d: 9, success_rate: 22, ai_score: 25 },
      ]);
      expect(await refreshPediaServiceStats(db, fetcher as never)).toBe("not_due");
      expect(fetcher).toHaveBeenCalledTimes(1);
      f.sql.exec("UPDATE store_settings SET value=datetime('now','-2 hours') WHERE key='pedia_service_stats_refreshed_at'");
      const broken = vi.fn(async () => new Response("oops", { status: 502 }));
      expect(await refreshPediaServiceStats(db, broken as never)).toBe("unavailable");
      expect(f.sql.prepare("SELECT orders_7d FROM pedia_service_stats WHERE service_id=10").get()?.orders_7d).toBe(50);
    } finally { f.close(); }
  });
});
