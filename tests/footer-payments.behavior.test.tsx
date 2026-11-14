// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { FooterPayments } from "@/components/storefront/FooterPayments";

afterEach(cleanup);

describe("footer payment methods (14 Nov 2026)", () => {
  it("shows QRIS, e-wallet, VA and crypto logos from local files with a localized heading", () => {
    render(<FooterPayments locale="id" />);
    const row = screen.getByRole("region", { name: "Metode pembayaran" });
    const names = within(row).getAllByRole("img").map((img) => img.getAttribute("alt"));
    expect(names).toEqual(["QRIS", "GoPay", "DANA", "OVO", "ShopeePay", "LinkAja", "BCA", "BNI", "BRI", "Mandiri", "Permata", "USDT", "Bitcoin", "Ethereum"]);
    for (const img of within(row).getAllByRole("img")) expect(img.getAttribute("src")).toMatch(/^\/(payments|brand)\//);
    cleanup();
    render(<FooterPayments locale="en" />);
    expect(screen.getByRole("region", { name: "Payment methods" })).toBeTruthy();
  });
});
