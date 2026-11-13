// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GamesManager } from "@/components/admin/GamesManager";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("renders SK catalogue stats without Oura columns or bulk-wave controls", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [], total: 0, brands: [], limit: 50, offset: 0,
    sync: { last_sync_at: null, counts: { total: 0, enabled: 0, supplier_active: 0, seller_active: 0, with_reference: 0, contract_supported: 0 } },
    nickname_checks: { today: { count: 2, cost: 10 }, week: { count: 5, cost: 25 } },
  })));
  render(<GamesManager />);
  expect(await screen.findByText("Total varian")).toBeTruthy();
  expect(screen.getAllByText("Bisa dijual").length).toBeGreaterThan(0);
  expect(screen.getByText("Supplier aktif")).toBeTruthy();
  expect(screen.queryByText(/Digiflazz/)).toBeNull();
  expect(screen.queryByText(/Oura/)).toBeNull();
  expect(screen.queryByRole("button", { name: /gelombang 1/i })).toBeNull();
});
