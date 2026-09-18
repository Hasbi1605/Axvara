// @vitest-environment jsdom
//
// tests/terms-highlight.behavior.test.tsx — TermsHighlight render tegas.
// Produk seed lokal tak punya terms WR, jadi uji dengan props langsung
// memakai data mentah asli prod (Netflix Anti Limit).
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TermsHighlight } from "@/components/storefront/TermsHighlight";

const NETFLIX_TERMS = [
  "1 Kali Checkout Untuk 1 Device",
  "Tidak bisa set PIN / Profile",
  "Pahami resiko bl4ckmarket",
  "Fixing Garansi 1x24 jam (estimasi)",
].join("\n");

const NETFLIX_DELIVERY = [
  "DILARANG KERAS MENGGUNAKAN VPN MANAPUN!",
  "🚫 TIDAK ADA TOLERANSI SEDIKITPUN. MELANGGAR SALAH SATU PERATURAN DIATAS? AKUN KAMI TARIK DAN GARANSI HANGUS!",
].join("\n");

describe("TermsHighlight", () => {
  it("highlight tegas terlihat tanpa expand, tanpa bentakan", () => {
    render(
      <TermsHighlight
        terms={NETFLIX_TERMS}
        deliveryTerms={NETFLIX_DELIVERY}
        variantLabel="Premium Anti Limit"
        idSuffix="test"
      />,
    );
    expect(screen.getByText("Wajib Dipatuhi")).toBeTruthy();
    // Full text tersembunyi di balik 1 tap.
    expect(screen.getByText(/Lihat semua \d+ ketentuan/)).toBeTruthy();
    // Cara aktivasi dari delivery_terms tetap tampil sebagai langkah.
    expect(screen.getByText("Cara Aktivasi")).toBeTruthy();
    // Tak ada bentakan di render awal.
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/DILARANG KERAS/);
    expect(html).not.toMatch(/TOLERANSI/);
    expect(html).not.toMatch(/HANGUS/);
    expect(html).not.toMatch(/bl4ckmarket/i);
  });

  it("expand menampilkan semua ketentuan + jalan keluar admin", () => {
    render(
      <TermsHighlight
        terms={NETFLIX_TERMS}
        deliveryTerms={NETFLIX_DELIVERY}
        variantLabel="Premium Anti Limit"
        idSuffix="test2"
      />,
    );
    fireEvent.click(screen.getByText(/Lihat semua \d+ ketentuan/));
    expect(screen.getByText("Akun & Login")).toBeTruthy();
    expect(screen.getByText(/chat admin dengan kode pesanan/)).toBeTruthy();
    expect(screen.getByText("Tutup ketentuan")).toBeTruthy();
  });

  it("null bila tak ada terms + delivery (varian manual)", () => {
    const { container } = render(
      <TermsHighlight terms={null} deliveryTerms={null} variantLabel="Default" idSuffix="test3" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
