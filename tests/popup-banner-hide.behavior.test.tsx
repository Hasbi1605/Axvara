// @vitest-environment jsdom
// PopupBanner "Jangan tampilkan lagi" (permintaan owner 09 Okt 2026):
// checkbox kecil di bawah banner menyembunyikan banner itu selama 24 jam
// (localStorage per banner id), tanpa penjelasan durasi ke pembeli.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import {
  BANNER_HIDE_DURATION_MS,
  PopupBanner,
  bannerHideKey,
  hideBannerFor24h,
  isBannerHidden,
  unhideBanner,
  BANNER_SESSION_KEY,
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
    vi.fn(async () => ({ ok: true, json: async () => ({ banners, settings: {delay_ms:0,interval_ms:6000,autoplay:true,max_show_per_session:1} }) })),
  );
  // Panggil fetch langsung tanpa menunggu idle browser (real timers).
  vi.stubGlobal("requestIdleCallback", (cb: () => void) => {
    cb();
    return 1;
  });
  vi.stubGlobal("cancelIdleCallback", () => {});
}

beforeEach(() => {
  navigation.pathname = "/";
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

describe("PopupBanner carousel", () => {
  it("loads all active non-hidden infos in order and counts one popup per session", async () => {
    hideBannerFor24h(7);
    stubFetch([BANNER, {...BANNER,id:8,title:"First"}, {...BANNER,id:9,title:"Second"}, {...BANNER,id:10,is_active:0}]);
    render(<PopupBanner />);
    await screen.findByRole("dialog", {name:"Info AXVARA"});expect(screen.getByText("First")).toBeTruthy();expect(screen.getByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", {name:"Banner berikutnya"}));expect(screen.getByText("Second")).toBeTruthy();expect(screen.getByText("2/2")).toBeTruthy();
    expect(sessionStorage.getItem(BANNER_SESSION_KEY)).toBe("1");fireEvent.keyDown(screen.getByRole("region"),{key:"ArrowRight"});expect(screen.getByText("First")).toBeTruthy();expect(sessionStorage.getItem(BANNER_SESSION_KEY)).toBe("1");
  });
  it("does not reopen after returning home or remounting in the same session", async () => {
    stubFetch();const view=render(<PopupBanner/>);await screen.findByRole("dialog");fireEvent.click(screen.getByRole("button",{name:"Tutup banner"}));navigation.pathname="/produk/demo";view.rerender(<PopupBanner/>);navigation.pathname="/";view.rerender(<PopupBanner/>);
    await act(async()=>{await new Promise(r=>setTimeout(r,20))});expect(screen.queryByRole("dialog")).toBeNull();view.unmount();render(<PopupBanner/>);await act(async()=>{await new Promise(r=>setTimeout(r,20))});expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("works with blocked session/local storage", async()=>{
    stubFetch();const get=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw Error("blocked")});render(<PopupBanner/>);expect(await screen.findByRole("dialog")).toBeTruthy();get.mockRestore();
  });
  it("hides only the selected info immediately and continues with its neighbor",async()=>{
    stubFetch([BANNER,{...BANNER,id:8,title:"Next info"}]);render(<PopupBanner/>);await screen.findByRole("dialog");fireEvent.click(screen.getByRole("checkbox",{name:"Jangan tampilkan lagi"}));expect(isBannerHidden(7)).toBe(true);expect(isBannerHidden(8)).toBe(false);expect(screen.getByText("Next info")).toBeTruthy();expect(screen.queryByRole("button",{name:"Banner berikutnya"})).toBeNull();expect(document.body.textContent).not.toMatch(/24 jam/i);
    fireEvent.click(screen.getByRole("checkbox",{name:"Jangan tampilkan lagi"}));expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("normal close does not hide info for 24 hours and restores focus",async()=>{
    stubFetch();const button=document.createElement("button");document.body.append(button);button.focus();render(<PopupBanner/>);await screen.findByRole("dialog");await act(async()=>{await new Promise(r=>setTimeout(r,10))});fireEvent.keyDown(document,{key:"Escape"});expect(screen.queryByRole("dialog")).toBeNull();expect(isBannerHidden(7)).toBe(false);expect(document.activeElement).toBe(button);button.remove();
  });
  it("does not fetch away from home, including admin and checkout",async()=>{
    stubFetch();navigation.pathname="/admin";const view=render(<PopupBanner/>);navigation.pathname="/checkout";view.rerender(<PopupBanner/>);await act(async()=>{await new Promise(r=>setTimeout(r,10))});expect(fetch).not.toHaveBeenCalled();
  });
});
