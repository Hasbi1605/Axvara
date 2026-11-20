// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Page from "@/app/(shop)/cara-order/page";

let locale = "id";
vi.mock("@/hooks/useDisplayPrices", () => ({ useDisplayLocale: () => locale }));
afterEach(cleanup);

it.each([
  ["id", /WhatsApp aktif dan email\. Keduanya wajib/i, /jika tersedia.*virtual account.*e-wallet.*kripto/i, /QRIS.*pesanan/i, /halaman pesanan.*email/i, /PIN.*email/i, /Lacak pesanan/i, /Tanya admin/i],
  ["en", /active WhatsApp number and an email address.*Both are required/i, /if available.*virtual account.*e-wallet.*crypto/i, /QRIS.*order/i, /order page.*email/i, /PIN.*email/i, /Track order/i, /Ask admin/i],
] as const)("describes current Market checkout and delivery in %s", (lang, contact, optional, qris, delivery, pin, track, help) => {
  locale = lang;
  const { container } = render(<Page />);
  for (const content of [contact, optional, qris, delivery, pin]) expect(container.textContent).toMatch(content);
  expect(container.textContent).toMatch(/otomatis|automatically/);
  expect(container.textContent).not.toMatch(/masukkan nama|fill in your name|admin memeriksa pembayaran|admin verifies payment/);
  expect(screen.getByRole("link", { name: track }).getAttribute("href")).toBe("/lacak-pesanan");
  expect(screen.getByRole("link", { name: help }).getAttribute("href")).toMatch(/^\/wa\?/);
});
