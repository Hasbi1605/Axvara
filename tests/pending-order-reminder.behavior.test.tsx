// @vitest-environment jsdom
// Pengingat melayang "pesanan belum dibayar" (permintaan owner 24 Sep):
// pembeli yang tak sengaja keluar dari halaman QRIS bisa kembali membayar
// tanpa checkout ulang. Status/tenggat selalu dari server.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { PendingOrderReminder } from "@/components/storefront/PendingOrderReminder";

const CODE = "AXV-20260924-REMIND01";
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function localOrder(status = "pending", createdMinutesAgo = 2) {
  localStorage.setItem("axvara-orders", JSON.stringify([
    { code: CODE, status, createdAt: new Date(Date.now() - createdMinutesAgo * 60_000).toISOString() },
  ]));
}

function serverOrder(order: Record<string, unknown>) {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ order: { code: CODE, ...order } }) }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

async function mount() {
  await act(async () => { render(<PendingOrderReminder />); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { pathname = "/"; localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("pesanan QRIS masih berlaku: kartu melayang + hitung mundur + link ke halaman bayar", async () => {
  localOrder();
  serverOrder({ status: "pending", expires_at: inMinutes(50), qris_reissue_allowed: false, qris: { expires_at: inMinutes(10) } });
  await mount();
  expect(screen.getByRole("region", { name: "Pesanan menunggu pembayaran" })).toBeTruthy();
  expect(screen.getByText(/^(09:5\d|10:00)$/)).toBeTruthy();
  expect(document.querySelector(`a[href="/pesanan/${CODE}"]`)?.textContent).toContain("Bayar");
});

it("QR hangus tapi pesanan masih hidup: ajak perpanjang, hitung mundur tenggat pesanan", async () => {
  localOrder();
  serverOrder({ status: "pending", expires_at: inMinutes(30), qris_reissue_allowed: true, qris: { expires_at: inMinutes(-1) } });
  await mount();
  expect(screen.getByText("Perpanjang")).toBeTruthy();
  expect(screen.getByText(/QRIS hangus/)).toBeTruthy();
});

it("sudah lunas (mis. dibayar dari HP lain): tidak tampil dan salinan lokal ditandai", async () => {
  localOrder();
  serverOrder({ status: "lunas", expires_at: inMinutes(30), qris: null });
  await mount();
  expect(screen.queryByRole("region", { name: "Pesanan menunggu pembayaran" })).toBeNull();
  expect(JSON.parse(localStorage.getItem("axvara-orders")!)[0].status).toBe("lunas");
});

it("tidak tampil (dan tidak memanggil server) di halaman pesanan/checkout itu sendiri", async () => {
  localOrder();
  const fetchSpy = serverOrder({ status: "pending", expires_at: inMinutes(50), qris: { expires_at: inMinutes(10) } });
  for (const path of [`/pesanan/${CODE}`, "/checkout"]) {
    pathname = path;
    await mount();
    expect(screen.queryByRole("region", { name: "Pesanan menunggu pembayaran" })).toBeNull();
    cleanup();
  }
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("pesanan lokal yang sudah pasti mati (>75 menit) tidak dicek ke server", async () => {
  localOrder("pending", 90);
  const fetchSpy = serverOrder({ status: "pending" });
  await mount();
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("tombol tutup menyembunyikan pengingat untuk pesanan itu selama sesi", async () => {
  localOrder();
  serverOrder({ status: "pending", expires_at: inMinutes(50), qris_reissue_allowed: false, qris: { expires_at: inMinutes(10) } });
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Tutup pengingat" }));
  expect(screen.queryByRole("region", { name: "Pesanan menunggu pembayaran" })).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("axvara-pending-reminder-dismissed")!)).toEqual([CODE]);
});

it("salinan lokal checkout tidak lagi menyimpan WA/email pembeli", () => {
  const src = require("node:fs").readFileSync("src/app/checkout/page.tsx", "utf8") as string;
  const local = src.match(/const localOrder = \{[^}]*\}/)?.[0] ?? "";
  expect(local).toContain("code");
  expect(local).not.toMatch(/\bwa\b|\bemail\b/);
});
