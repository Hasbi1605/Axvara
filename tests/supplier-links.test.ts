// tests/supplier-links.test.ts — Shortlink internal axvara.tech/go/*.
//
// Pembungkus link supplier + artikel panjang (bukan SaaS publik ala Kliqs):
// - lib: validasi slug/reserved/normalisasi destination;
// - rewrite: teks supplier live (fallback produk belum dikurasi/off/restok)
//   dibungkus tahan-sync;
// - route /go/[slug]: redirect 307 + hitung klik + 404 bila mati;
// - API admin: CRUD + validasi + auth.
import { describe, expect, it } from "vitest";
import {
  GO_MAIL_OLIES,
  GO_NETFLIX_LOGIN,
  GO_OTP,
  rewriteSupplierDocsLinks,
} from "@/lib/product-copy/format";
import {
  SUPPLIER_LINK_RESERVED,
  isValidSupplierSlug,
  normalizeSupplierDestination,
  normalizeSupplierLink,
} from "@/lib/supplier-links";
import { linkifySegments } from "@/lib/product-copy/text";

describe("supplier-links lib — validasi slug + destination", () => {
  it("slug valid: lowercase dash; reserved ditolak", () => {
    expect(isValidSupplierSlug("otp")).toBe(true);
    expect(isValidSupplierSlug("netflix-login")).toBe(true);
    expect(isValidSupplierSlug("OTP")).toBe(false);
    expect(isValidSupplierSlug("go/b")).toBe(false);
    expect(isValidSupplierSlug("-otp")).toBe(false);
    expect(isValidSupplierSlug("otp-")).toBe(false);
    for (const reserved of ["admin", "api", "produk", "go", "artikel", "lacak-pesanan"]) {
      expect(SUPPLIER_LINK_RESERVED.has(reserved)).toBe(true);
      expect(isValidSupplierSlug(reserved)).toBe(false);
    }
  });

  it("destination: path internal lolos; axvara.tech jadi path; skema aneh ditolak", () => {
    expect(normalizeSupplierDestination("/artikel/cara-login-netflix-setelah-order-di-axvara")).toBe(
      "/artikel/cara-login-netflix-setelah-order-di-axvara",
    );
    expect(normalizeSupplierDestination("https://axvara.tech/go/otp")).toBe("/go/otp");
    expect(normalizeSupplierDestination("axvara.tech/lacak-pesanan")).toBe("/lacak-pesanan");
    expect(normalizeSupplierDestination("https://netflix-codes.sekalipay.com/mailbox")).toBe(
      "https://netflix-codes.sekalipay.com/mailbox",
    );
    expect(normalizeSupplierDestination("javascript:alert(1)")).toBeNull();
    expect(normalizeSupplierDestination("data:text/html,x")).toBeNull();
    expect(normalizeSupplierDestination("")).toBeNull();
  });

  it("normalizeSupplierLink: is_active/click dinormalisasi", () => {
    const link = normalizeSupplierLink({ id: 1, slug: "otp", destination: "https://x.test/", is_active: 1, click_count: 7 });
    expect(link).toMatchObject({ id: 1, slug: "otp", is_active: true, click_count: 7, title: "" });
  });
});

describe("dev fallback in-memory — 43 slug prod tersedia tanpa D1", () => {
  it("queryAll supplier_links + queryFirst by slug + klik", async () => {
    const { queryAll, queryFirst, execRun } = await import("@/lib/db/client");
    const rows = await queryAll(`SELECT * FROM supplier_links ORDER BY slug ASC`);
    expect(rows.length).toBe(43);
    const otp = await queryFirst(`SELECT destination FROM supplier_links WHERE slug=? AND is_active=1`, "otp");
    expect(String(otp?.destination)).toBe("https://netflix-codes.sekalipay.com/mailbox");
    const before = Number((await queryFirst(`SELECT click_count FROM supplier_links WHERE slug=?`, "otp"))?.click_count ?? 0);
    await execRun(
      `UPDATE supplier_links SET click_count=click_count+1, last_clicked_at=datetime('now'), updated_at=datetime('now') WHERE slug=?`,
      "otp",
    );
    const after = Number((await queryFirst(`SELECT click_count FROM supplier_links WHERE slug=?`, "otp"))?.click_count ?? 0);
    expect(after).toBe(before + 1);
  });
});

describe("rewrite supplier → go/* (tahan sync, termasuk produk off/restok)", () => {
  it("docs Netflix + mailbox + oliesmail jadi shortlink", () => {
    const out = rewriteSupplierDocsLinks(
      "Login https://sekalipay.com/docs/tutorial-login-netflix, kode di https://netflix-codes.sekalipay.com/mailbox, email https://oliesmail.com/",
    )!;
    expect(out).toContain(GO_NETFLIX_LOGIN);
    expect(out).toContain(GO_OTP);
    expect(out).toContain(GO_MAIL_OLIES);
    expect(out).not.toContain("sekalipay.com/docs");
  });

  it("linkify: axvara.tech/go/* tampil jadi link internal /go", () => {
    const segments = linkifySegments(`Buka ${GO_OTP} untuk kode`);
    expect(segments[1]).toEqual({ text: GO_OTP, href: "/go/otp" });
  });
});
