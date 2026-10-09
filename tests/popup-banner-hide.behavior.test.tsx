// @vitest-environment jsdom
// PopupBanner "Jangan tampilkan lagi" (permintaan owner 09 Okt 2026):
// checkbox kecil di bawah banner menyembunyikan banner itu selama 24 jam
// (localStorage per banner id), tanpa penjelasan durasi ke pembeli.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import {
  BANNER_HIDE_DURATION_MS,
  PopupBanner,
  bannerHideKey,
  hideBannerFor24h,
  isBannerHidden,
  unhideBanner,
} from "@/components/storefront/PopupBanner";

const BANNER = {
  id: 7,
  title: "Promo Spesial",
  body: "Diskon besar",
  image_url: null,
  cta_label: "Beli",
  cta_href: "/produk/demo",
  is_active: 1,
  delay_ms: 0,
  max_show_per_session: 10,
};

function stubFetch(banners: unknown[] = [BANNER]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ banners }) })),
  );
  // Panggil fetch langsung tanpa menunggu idle browser (real timers).
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
    cb();
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => {});
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("helper sembunyi 24 jam", () => {
  it("durasi tepat 24 jam dan key per banner id", () => {
    expect(BANNER_HIDE_DURATION_MS).toBe(24 * 60 * 60 * 1000);
    expect(bannerHideKey(7)).toBe("axvara-banner-7-hide-until");
    expect(bannerHideKey(8)).not.toBe(bannerHideKey(7));
  });

  it("isBannerHidden false sebelum disembunyikan, true sesudahnya", () => {
    expect(isBannerHidden(7)).toBe(false);
    hideBannerFor24h(7);
    expect(isBannerHidden(7)).toBe(true);
  });

  it("sembunyi kedaluwarsa setelah 24 jam", () => {
    const now = Date.now();
    hideBannerFor24h(7, now);
    expect(isBannerHidden(7, now + BANNER_HIDE_DURATION_MS - 1)).toBe(true);
    expect(isBannerHidden(7, now + BANNER_HIDE_DURATION_MS + 1)).toBe(false);
  });

  it("unhide menghapus penanda sehingga banner boleh tampil lagi", () => {
    hideBannerFor24h(7);
    expect(isBannerHidden(7)).toBe(true);
    unhideBanner(7);
    expect(isBannerHidden(7)).toBe(false);
  });
});

describe("PopupBanner — checkbox Jangan tampilkan lagi", () => {
  it("menampilkan checkbox kecil tanpa menyebut durasi", async () => {
    stubFetch();
    await act(async () => {
      render(<PopupBanner />);
    });
    const checkbox = await screen.findByRole("checkbox", { name: "Jangan tampilkan lagi" });
    expect(checkbox).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/24 jam/i);
  });

  it("mencentang langsung menyimpan penanda 24 jam (tanpa menunggu tutup)", async () => {
    stubFetch();
    await act(async () => {
      render(<PopupBanner />);
    });
    const checkbox = await screen.findByRole("checkbox", { name: "Jangan tampilkan lagi" });
    expect(localStorage.getItem(bannerHideKey(7))).toBeNull();
    fireEvent.click(checkbox);
    const stored = Number(localStorage.getItem(bannerHideKey(7)));
    expect(stored).toBeGreaterThan(Date.now());
    expect(stored - Date.now()).toBeLessThanOrEqual(BANNER_HIDE_DURATION_MS);
  });

  it("uncheck menghapus penanda lagi", async () => {
    stubFetch();
    await act(async () => {
      render(<PopupBanner />);
    });
    const checkbox = await screen.findByRole("checkbox", { name: "Jangan tampilkan lagi" });
    fireEvent.click(checkbox);
    expect(localStorage.getItem(bannerHideKey(7))).not.toBeNull();
    fireEvent.click(checkbox);
    expect(localStorage.getItem(bannerHideKey(7))).toBeNull();
  });

  it("tutup biasa tanpa centang tidak menyimpan penanda", async () => {
    stubFetch();
    await act(async () => {
      render(<PopupBanner />);
    });
    await screen.findByRole("checkbox", { name: "Jangan tampilkan lagi" });
    fireEvent.click(screen.getByRole("button", { name: "Tutup banner" }));
    expect(localStorage.getItem(bannerHideKey(7))).toBeNull();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("banner yang disembunyikan tidak tampil lagi", async () => {
    hideBannerFor24h(7);
    stubFetch();
    await act(async () => {
      render(<PopupBanner />);
    });
    // Beri jeda fetch + delay banner, pastikan tetap tidak muncul.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("banner lain tetap tampil walau satu banner disembunyikan", async () => {
    hideBannerFor24h(999);
    stubFetch();
    await act(async () => {
      render(<PopupBanner />);
    });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
