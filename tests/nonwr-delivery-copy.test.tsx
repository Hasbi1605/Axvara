// @vitest-environment jsdom
//
// tests/nonwr-delivery-copy.test.tsx — Teks pembeli seputar pengiriman non-WR
// (2026-09-25): template email bermerek, template serah terima, dan
// ringkasan pengiriman PDP untuk varian campuran.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Product } from "@/lib/products";
import { buildOrderReadyTemplate, renderBrandedNotice } from "@/lib/warung-rebahan/email-forward";
import { renderHandoverTemplate } from "@/lib/fulfillment/handover-template";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "canva-premium" }),
  usePathname: () => "/produk/canva-premium",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

import ProductDetailClient from "@/app/produk/[slug]/product-detail-client";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const EMOJI = /\p{Extended_Pictographic}/u;

describe("email Pesanan Siap", () => {
  const ctx = {
    axvaraOrderCode: "AXV-20260925-AAAAAAA1",
    buyerName: "Rani Putri",
    invoiceUrl: "https://axvara.tech/pesanan/AXV-20260925-AAAAAAA1",
    supportWa: "089519388264",
    items: [{ label: "Canva Pro — Invite 1 Bulan", details: "Link: https://canva.com/join?a=1&b=2\n<script>alert(1)</script>" }],
  };

  it("isi di-escape, tanpa emoji, dengan logo + tombol halaman pesanan", () => {
    const t = buildOrderReadyTemplate(ctx);
    expect(t.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(t.html).not.toContain("<script>");
    expect(t.html).toContain("https://canva.com/join?a=1&amp;b=2");
    expect(t.html).toContain("https://axvara.tech/brand/axvara-email-mark.png");
    expect(t.html).toContain("Lihat Pesanan");
    expect(EMOJI.test(t.subject + t.text)).toBe(false);
    expect(t.subject).toBe("Canva Pro — Invite 1 Bulan sudah siap — AXVARA AXV-20260925-AAAAAAA1");
  });

  it("versi gabungan memuat tanda terima pembayaran", () => {
    const t = buildOrderReadyTemplate({ ...ctx, receipt: { total: 2053, method: "QRIS", lines: ["Canva Pro — Invite 1 Bulan"] } });
    expect(t.subject.startsWith("Pembayaran diterima, ")).toBe(true);
    expect(t.html).toContain("PEMBAYARAN DITERIMA");
    expect(t.html).toContain("Total Rp2.053");
    expect(t.text).toContain("Total Rp2.053 · QRIS");
  });

  it("kabar bermerek meng-escape paragraf dan alasan", () => {
    const { html, text } = renderBrandedNotice({
      orderCode: "AXV-20260925-AAAAAAA1", title: "Bukti Pembayaran Ditolak", subtitle: "Pesananmu belum lunas.",
      paragraphs: ["Nominal <b>tidak</b> cocok."], callout: { text: "Alasan: <img src=x>", tone: "warning" },
      orderUrl: "https://axvara.tech/pesanan/AXV-20260925-AAAAAAA1", supportWa: "089519388264",
    });
    expect(html).toContain("Nominal &lt;b&gt;tidak&lt;/b&gt; cocok.");
    expect(html).toContain("Alasan: &lt;img src=x&gt;");
    expect(html).not.toContain("<img src=x>");
    expect(text).toContain("Nominal <b>tidak</b> cocok.");
  });
});

describe("template serah terima", () => {
  it("mengisi placeholder yang didukung, sisanya dibiarkan terlihat", () => {
    expect(renderHandoverTemplate("Hai {nama}, undangan ke {email} untuk {produk} ({kode}). {salah}", {
      email: "rani@contoh.test", name: "Rani Putri", code: "AXV-1", product: "Canva Pro — Invite Lifetime",
    })).toBe("Hai Rani, undangan ke rani@contoh.test untuk Canva Pro — Invite Lifetime (AXV-1). {salah}");
    expect(renderHandoverTemplate("   ", { email: "", name: "", code: "", product: "" })).toBe("");
    expect(renderHandoverTemplate("Ke {email}", { email: "", name: "", code: "", product: "" })).toBe("Ke email kamu");
  });
});

describe("PDP: ringkasan pengiriman varian campuran", () => {
  const product = {
    id: "1", slug: "canva-premium", name: "Canva Pro / Premium", description: "Canva Pro.", price: 2000,
    categorySlug: "akun-premium", image: "/brand/axvara-mark.svg", images: [], stock: -1, variantCount: 2,
  } as unknown as Product;
  const variants = [
    { id: 1, label: "Invite 1 Bulan", price: 2000, compare_price: null, stock: -1, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "shared" },
    { id: 2, label: "Invite Lifetime", price: 5000, compare_price: null, stock: -1, min_qty: 1, is_active: 1, warranty_type: "none", fulfillment_mode: "manual" },
  ];
  const catalog = { slug: "canva-premium", product: { id: 1, slug: "canva-premium", name: "Canva Pro / Premium", variants }, variantsEnabled: true };

  it("sebelum memilih: 'Tergantung varian', bukan 'Kirim otomatis' untuk seluruh produk; setelah memilih mengikuti varian", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ products: [] }) })));
    render(<ProductDetailClient slug="canva-premium" initialProducts={[product]} initialCatalog={catalog as never} />);
    expect(screen.getByText("Tergantung varian")).toBeTruthy();
    expect(screen.queryByText("Kirim otomatis setelah pembayaran dikonfirmasi")).toBeNull();

    fireEvent.click(screen.getAllByRole("button").find((b) => (b.textContent ?? "").includes("Invite 1 Bulan"))!);
    expect(screen.queryByText("Tergantung varian")).toBeNull();
    expect(screen.getByText("Kirim otomatis setelah pembayaran dikonfirmasi")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button").find((b) => (b.textContent ?? "").includes("Invite Lifetime"))!);
    expect(screen.queryByText("Kirim otomatis setelah pembayaran dikonfirmasi")).toBeNull();
  });
});
