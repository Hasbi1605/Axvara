// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import PediaHelpPage, { generateMetadata as helpMetadata } from "@/app/pedia/bantuan/page";
import PediaTermsPage, { generateMetadata as termsMetadata } from "@/app/pedia/ketentuan/page";

// Default Indonesia (tanpa cookie): metadata tetap memakai canonical yang sama.
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "" }) }));

vi.mock("@/components/ui/IosIcon", () => ({ IosIcon: () => null }));
afterEach(cleanup);

// 2026-11-01 (owner): Bantuan + Ketentuan Pedia disamakan dengan halaman Market yang setara.
describe("Pedia help page", () => {
  it("shows the four Pedia order steps and current FAQ answers", async () => {
    render(<PediaHelpPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Bantuan" })).toBeTruthy();
    const steps = document.getElementById("cara-order")!;
    expect(within(steps).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Langkah 1: Pilih layanan", "Langkah 2: Tempel link target", "Langkah 3: Isi kontak", "Langkah 4: Bayar QRIS & pantau",
    ]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Bagaimana membatalkan pesanan?");
    expect(text).toContain("Mengikuti estimasi mulai di tiap layanan");
    expect(text).not.toMatch(/±5–30 menit|Kode kredit lama/);
    expect(document.querySelectorAll("details summary").length).toBe(8);
    expect(text).toContain("Apa itu No Drop, Less Drop, dan High Drop?");
    for (const name of ["Lihat layanan", "Lacak pesanan", "Tanya admin"]) expect(screen.getByRole("link", { name })).toBeTruthy();
    expect((await helpMetadata()).alternates?.canonical).toBe("/bantuan");
  });
});

describe("Pedia terms page", () => {
  it("keeps every original rule, grouped into cards, with actions", async () => {
    render(<PediaTermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Ketentuan Pedia" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Tentang layanan", "Syarat target", "Refill & garansi", "Pesanan sebagian atau dibatalkan", "Yang perlu disiapkan", "Konten yang dilarang",
    ]);
    const text = document.body.textContent ?? "";
    for (const rule of ["tidak menjamin jangkauan, penjualan, atau FYP", "wajib publik", "Penurunan jumlah (drop) dapat terjadi", "Tidak ada saldo pembeli, kode kredit, atau refund otomatis", "bukan tanggung jawab AXVARA", "risiko akun sepenuhnya pada pembeli", "politik praktis"]) expect(text).toContain(rule);
    expect(screen.getByRole("link", { name: "Lihat cara order" }).getAttribute("href")).toBe("/pedia/bantuan#cara-order");
    expect((await termsMetadata()).alternates?.canonical).toBe("/ketentuan");
  });
});

describe("Pedia track FAQ", () => {
  it("no longer asks about a PIN that Pedia does not use, and explains cancelling", () => {
    const src = readFileSync("src/app/pedia/lacak/page.tsx", "utf8");
    expect(src).not.toContain("PIN akses saya hilang?");
    expect(src).toContain("Bagaimana membatalkan pesanan?");
  });
});
