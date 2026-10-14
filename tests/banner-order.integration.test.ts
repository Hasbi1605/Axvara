import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Miniflare } from "miniflare";
import { createD1Fixture } from "./helpers/d1-fixture";
import { execRun, queryAll } from "@/lib/db";
import { BannerOrderConflict, writeBannerOrder } from "@/lib/banner-order";
import { POST, PUT as fullUpdate } from "@/app/api/banners/route";
import { PUT as patch } from "@/app/api/banners/[id]/route";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "admin" })) }));
let fixture: ReturnType<typeof createD1Fixture>;
const request = (body: unknown, url = "/api/banners", method = "POST") => new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const update = (id: number, body: unknown) => patch(request(body, `/api/banners/${id}`, "PUT"), { params: Promise.resolve({ id: String(id) }) });

beforeEach(() => { fixture = createD1Fixture(); });
afterEach(() => { fixture.close(); vi.restoreAllMocks(); });

describe("banner ordering writes on real SQLite", () => {
  it("allocates first free slots including inactive rows and returns actual order", async () => {
    expect(await (await POST(request({ title: "First", sort_order: 0 }))).json()).toMatchObject({ sort_order: 0 });
    expect(await (await POST(request({ title: "Third", sort_order: 2 }))).json()).toMatchObject({ sort_order: 2 });
    const response = await POST(request({ title: "Second", sort_order: 0, is_active: true }));
    expect(await response.json()).toMatchObject({ sort_order: 1 });
    expect(fixture.sql.prepare("SELECT sort_order FROM banners ORDER BY sort_order").all()).toEqual([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 2 }]);
    expect(() => fixture.sql.exec("INSERT INTO banners(title,sort_order) VALUES('Collision',1)")).toThrow(/UNIQUE/);
  });

  it("excludes self in both update routes; status-only patches keep content and order", async () => {
    await POST(request({ title: "First", sort_order: 3 }));
    await POST(request({ title: "Second", sort_order: 4 }));
    expect(await (await fullUpdate(request({ title: "Edited", sort_order: 3 }, "/api/banners?id=1", "PUT"))).json()).toMatchObject({ sort_order: 3 });
    expect(await (await update(2, { sort_order: 3 })).json()).toMatchObject({ sort_order: 4 });
    expect(await (await update(1, { is_active: true })).json()).toMatchObject({ banner: { title: "Edited", sort_order: 3, is_active: 1 } });
    expect(await (await fullUpdate(request({ title: "Edited", sort_order: 4 }, "/api/banners?id=1", "PUT"))).json()).toMatchObject({ sort_order: 5 });
  });

  it("resolves simultaneous inserts using the unique constraint and retry", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => POST(request({ title: `Banner ${i}` }))));
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    expect((await Promise.all(responses.map((response) => response.json()))).map((row) => row.sort_order).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns 409 at capacity and preserves 0..999 validation on every write route", async () => {
    await POST(request({ title: "Last", sort_order: 999 }));
    expect((await POST(request({ title: "Full", sort_order: 999 }))).status).toBe(409);
    await POST(request({ title: "First", sort_order: 0 }));
    expect((await update(2, { sort_order: 999 })).status).toBe(409);
    for (const sort_order of [-1, 1000, 1.5]) {
      expect((await POST(request({ title: "Invalid", sort_order }))).status).toBe(400);
      expect((await update(1, { sort_order })).status).toBe(400);
      expect((await fullUpdate(request({ title: "Invalid", sort_order }, "/api/banners?id=1", "PUT"))).status).toBe(400);
    }
  });

  it("bounds retries and does not retry unrelated failures", async () => {
    const collision = vi.fn(async () => { throw new Error("D1_ERROR: UNIQUE constraint failed: banners.sort_order: SQLITE_CONSTRAINT"); });
    await expect(writeBannerOrder(0, null, collision)).rejects.toBeInstanceOf(BannerOrderConflict);
    expect(collision).toHaveBeenCalledTimes(5);
    const failure = vi.fn(async () => { throw new Error("disk unavailable"); });
    await expect(writeBannerOrder(0, null, failure)).rejects.toThrow("disk unavailable");
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it("migration removes legacy duplicates deterministically without losing IDs/content", () => {
    fixture.sql.exec("DROP INDEX banners_sort_order_unique; INSERT INTO banners(id,title,sort_order,is_active) VALUES(2,'Older',0,1),(9,'Newer',0,0),(4,'Middle',1,1),(7,'Last',999,0)");
    fixture.sql.exec(readFileSync("drizzle/migrations/0064_banner_sort_order_unique.sql", "utf8"));
    expect(fixture.sql.prepare("SELECT id,title,sort_order FROM banners ORDER BY sort_order").all()).toEqual([
      { id: 9, title: "Newer", sort_order: 0 }, { id: 2, title: "Older", sort_order: 1 },
      { id: 4, title: "Middle", sort_order: 2 }, { id: 7, title: "Last", sort_order: 3 },
    ]);
    expect(() => fixture.sql.exec("UPDATE banners SET sort_order=0 WHERE id=7")).toThrow(/UNIQUE/);
  });

  it("migration and unique constraint work on D1 workerd, not only SQLite", async () => {
    const runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: "2024-11-01", d1Databases: ["DB"] });
    try {
      const db = await runtime.getD1Database("DB");
      await db.batch([
        db.prepare("CREATE TABLE banners(id INTEGER PRIMARY KEY,title TEXT,sort_order INTEGER,is_active INTEGER)"),
        db.prepare("INSERT INTO banners VALUES(2,'Older',0,1),(9,'Newer',0,0),(4,'Later',999,1)"),
      ]);
      const statements = readFileSync("drizzle/migrations/0064_banner_sort_order_unique.sql", "utf8").split(";").filter((statement) => statement.trim());
      await db.batch(statements.map((statement) => db.prepare(statement)));
      expect((await db.prepare("SELECT id,sort_order FROM banners ORDER BY sort_order").all()).results).toEqual([{ id: 9, sort_order: 0 }, { id: 2, sort_order: 1 }, { id: 4, sort_order: 2 }]);
      await expect(db.prepare("UPDATE banners SET sort_order=0 WHERE id=4").run()).rejects.toThrow(/UNIQUE/);
    } finally { await runtime.dispose(); }
  }, 15000);

  it("dev fallback enforces the same unique constraint without partial mutation", async () => {
    fixture.close();
    fixture = { ...fixture, close() {} };
    const state = process as unknown as { __AXVARA_BANNERS?: Record<string, unknown>[] };
    state.__AXVARA_BANNERS = [];
    try {
      await execRun("INSERT INTO banners (title,sort_order) VALUES (?,?)", "First", 0);
      await execRun("INSERT INTO banners (title,sort_order) VALUES (?,?)", "Second", 1);
      await expect(execRun("UPDATE banners SET title=?,sort_order=? WHERE id=?", "Lost", 0, 2)).rejects.toThrow(/UNIQUE/);
      expect(await queryAll("SELECT * FROM banners")).toMatchObject([{ title: "First", sort_order: 0 }, { title: "Second", sort_order: 1 }]);
      expect(await (await POST(request({ title: "Third" }))).json()).toMatchObject({ sort_order: 2 });
    } finally { delete state.__AXVARA_BANNERS; }
  });
});
