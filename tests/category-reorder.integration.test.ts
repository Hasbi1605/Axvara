import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

let fixture: ReturnType<typeof createD1Fixture>;
let authed = true;
vi.mock("@/lib/auth", () => ({ requireAdmin: () => Promise.resolve(authed ? { email: "admin@test" } : null) }));
beforeEach(() => {
  fixture = createD1Fixture();
  fixture.sql.exec("DELETE FROM categories; INSERT INTO categories(id,name,slug,sort_order) VALUES(1,'B','b',0),(2,'A','a',0),(3,'C','c',99)");
  authed = true;
});
afterEach(() => { fixture.close(); vi.unstubAllGlobals(); });
async function post(body: unknown) {
  const { POST } = await import("@/app/api/categories/reorder/route");
  return POST(new NextRequest("http://localhost/api/categories/reorder", { method: "POST", body: JSON.stringify(body) }));
}
it("requires admin, validates strict numeric input and known category", async () => {
  authed = false;
  expect((await post({ categoryId: 1, direction: 1 })).status).toBe(401);
  authed = true;
  for (const body of [{}, { categoryId: 1, direction: 0 }, { categoryId: "1", direction: 1 }, { categoryId: 1, direction: 1, extra: true }]) expect((await post(body)).status).toBe(400);
  expect((await post({ categoryId: 999, direction: 1 })).status).toBe(404);
});
it("moves one step in name-tied order, normalizes all keys atomically and returns private final order", async () => {
  const response = await post({ categoryId: 1, direction: -1 });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json() as { categories: { id: number; sort_order: number }[] };
  expect(body.categories.map(category => [category.id, category.sort_order])).toEqual([[1, 10], [2, 20], [3, 30]]);
  expect(fixture.sql.prepare("SELECT id, sort_order FROM categories ORDER BY sort_order").all()).toEqual(body.categories.map(({ id, sort_order }) => ({ id, sort_order })));
});
it("409 at either boundary leaves all keys unchanged", async () => {
  expect((await post({ categoryId: 2, direction: -1 })).status).toBe(409);
  expect((await post({ categoryId: 3, direction: 1 })).status).toBe(409);
  expect(fixture.sql.prepare("SELECT sort_order FROM categories ORDER BY id").all()).toEqual([{ sort_order: 0 }, { sort_order: 0 }, { sort_order: 99 }]);
});
it("batch failure rolls back normalized keys", async () => {
  fixture.control.fail = (query, params) => query.startsWith("UPDATE categories") && params[1] === 2;
  expect((await post({ categoryId: 1, direction: -1 })).status).toBe(500);
  expect(fixture.sql.prepare("SELECT sort_order FROM categories ORDER BY id").all()).toEqual([{ sort_order: 0 }, { sort_order: 0 }, { sort_order: 99 }]);
});
