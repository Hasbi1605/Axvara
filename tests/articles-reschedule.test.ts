// tests/articles-reschedule.test.ts — Audit AU-H2-17 (21 Nov 2026).
//
// PUT /api/articles?id= dulu memvalidasi scheduled_at tetapi hanya menulisnya
// di dalam cabang status=… — mengirim {scheduled_at} tanpa {status} menjawab
// 200 tanpa menyimpan. Sibling PUT /api/articles/[id] benar; disamakan.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

let fx: ReturnType<typeof createD1Fixture>;
beforeEach(() => {
  fx = createD1Fixture();
  fx.sql.exec(`INSERT INTO articles(id,slug,title,content,status,author_type,author_name)
    VALUES(7,'reschedule-me','Reschedule','Body yang cukup panjang untuk artikel fixture.','scheduled','admin','AXVARA')`);
});
afterEach(() => { fx.close(); vi.restoreAllMocks(); });

const put = (body: unknown) => import("@/app/api/articles/route").then(({ PUT }) => PUT(new NextRequest("https://axvara.test/api/articles?id=7", {
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
})));
const scheduledAt = () => (fx.sql.prepare("SELECT scheduled_at FROM articles WHERE id=7").get() as { scheduled_at: string | null }).scheduled_at;

describe("AU-H2-17 — PUT /api/articles?id= writes scheduled_at without status", () => {
  it("persists scheduled_at when status is omitted", async () => {
    expect(await scheduledAt()).toBeNull();
    const res = await put({ scheduled_at: "2099-06-01T10:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(await scheduledAt()).toBe("2099-06-01T10:00:00.000Z");
  });

  it("still persists via the status branch and rejects a past schedule", async () => {
    expect((await put({ status: "scheduled", scheduled_at: "2099-12-31T00:00:00.000Z" })).status).toBe(200);
    expect(await scheduledAt()).toBe("2099-12-31T00:00:00.000Z");
    expect((await put({ scheduled_at: "2000-01-01T00:00:00.000Z" })).status).toBe(400);
  });
});
