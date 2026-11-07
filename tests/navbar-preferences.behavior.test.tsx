// @vitest-environment jsdom
// Navbar Market: preferensi sebagai tombol teks polos di grup tautan (>= sm, setelah Artikel,
// sebelum Keranjang); tidak ada di bar atas mobile; "Layanan" mengikuti locale tampilan
// (hanya Market, Pedia tidak berubah).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => ({ name: "AXVARA", logoUrl: "" }) }));
const display = vi.hoisted(() => ({ locale: "id" as "id" | "en" }));
vi.mock("@/hooks/useDisplayPrices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useDisplayPrices")>();
  return { ...actual, useDisplayLocale: () => display.locale };
});

import { Navbar } from "@/components/storefront/Navbar";
import { ServicesMenu } from "@/components/shared/ServicesMenu";

afterEach(() => { cleanup(); display.locale = "id"; });

describe("Navbar preferensi", () => {
  it("satu tombol bendera bulat 44px di header SEMUA lebar (tanpa teks 'Indonesia · IDR'): setelah pencarian/nav, sebelum Keranjang; bukan bottom sheet", () => {
    render(<Navbar />);
    const trigger = screen.getByRole("button", { name: /^Bahasa dan mata uang: / });
    expect(trigger.className).toContain("h-11");
    expect(trigger.className).toContain("w-11");
    expect(trigger.className).not.toContain("ax-glass");
    expect(trigger.parentElement!.className).not.toMatch(/hidden|sm:block/); // tampil di mobile maupun desktop
    expect(trigger.textContent).toBe(""); // hanya ikon; mata uang terlihat di setiap harga
    expect(trigger.querySelector("img")!.getAttribute("alt")).toBe("");
    const search = screen.getByRole("button", { name: "Cari produk" });
    const cart = screen.getByRole("button", { name: "Keranjang" });
    expect(search.compareDocumentPosition(trigger.parentElement!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trigger.parentElement!.compareDocumentPosition(cart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Bahasa dan mata uang/ })).toHaveLength(1); // tidak ada pemicu ganda (footer/sheet)
  });

  it("Layanan mengikuti locale tampilan di Market; ServicesMenu tanpa prop mengikuti axv_locale (navbar Pedia)", () => {
    display.locale = "en";
    render(<Navbar />);
    expect(screen.getByRole("button", { name: "AXVARA services" }).textContent).toContain("Services");
    cleanup();
    display.locale = "id";
    render(<ServicesMenu active="pedia" />);
    expect(screen.getByRole("button", { name: "Layanan AXVARA" }).textContent).toContain("Layanan");
    cleanup();
    display.locale = "en";
    render(<ServicesMenu active="pedia" />);
    expect(screen.getByRole("button", { name: "AXVARA services" }).textContent).toContain("Services");
    expect(screen.queryByRole("button", { name: "Layanan AXVARA" })).toBeNull();
  });
});
