// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GamesManager } from "@/components/admin/GamesManager";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("renders the admin's conservative UTC nickname budget without new controls", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [], total: 0, brands: [], limit: 50, offset: 0,
    sync: { last_sync_at: null, counts: { total: 0, enabled: 0, seller_active: 0, with_reference: 0 } },
    nickname_checks: { today: { count: 2, cost: 10 }, week: { count: 5, cost: 25 } },
  })));
  render(<GamesManager />);
  expect((await screen.findByText(/Cek nickname \(UTC\): hari ini 2 cek/)).textContent).toMatch(/7 hari 5 cek/);
  expect(screen.getByText(/batas modal, bukan tagihan final/)).toBeTruthy();
});
