import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";
import type { VariantCopy } from "@/lib/product-copy/format";
import {
  buildSupplierLinkMap,
  EMPTY_SUPPLIER_LINK_MAP,
  sanitizeSupplierCopy,
} from "@/lib/product-copy/sanitize";
import {
  clearSupplierLinksMemoForTest,
  loadActiveSupplierLinkMap,
  SUPPLIER_LINKS_MEMO_TTL_MS,
} from "@/lib/supplier-links";

const REAL_LINKS = buildSupplierLinkMap([
  { slug: "netflix-login", destination: "/artikel/cara-login-netflix-setelah-order-di-axvara" },
  { slug: "otp", destination: "https://netflix-codes.sekalipay.com/mailbox" },
  { slug: "otp-genjos", destination: "https://genjos.xoftware.my.id/mailbox" },
  { slug: "otp-waroeng", destination: "https://waroengmail.com/" },
  { slug: "dramaku", destination: "https://dramaku.world/" },
]);

describe("sanitizeSupplierCopy — unit", () => {
  it("exact-path, host-root fallback, bare domain, no match, dan internal diabaikan tanpa mutasi input", () => {
    const links = buildSupplierLinkMap([
      { slug: "netflix-login", destination: "/artikel/cara-login-netflix-setelah-order-di-axvara" },
      { slug: "otp", destination: "https://netflix-codes.sekalipay.com/mailbox" },
      { slug: "otp-genjos", destination: "https://genjos.xoftware.my.id/mailbox" },
      { slug: "otp-waroeng", destination: "https://waroengmail.com/" },
      { slug: "dramaku", destination: "https://dramaku.world/" },
      { slug: "contoh-root", destination: "https://contoh-box.test/" },
      { slug: "contoh-box", destination: "https://contoh-box.test/mailbox" },
    ]);

    const input: VariantCopy = {
      source: "pemasok",
      sections: [
        {
          kind: "aturan",
          items: [
            "Cek kode di https://netflix-codes.sekalipay.com/mailbox dan netflix-codes.sekalipay.com/mailbox/.",
            "Link lain https://netflix-codes.sekalipay.com/other dan https://unknown.example/abc tetap.",
            "Artikel /artikel/cara-login-netflix-setelah-order-di-axvara tidak cocok sebagai host eksternal.",
            "Email user@waroengmail.com tidak diubah.",
          ],
        },
      ],
      activation: [
        {
          title: "Panduan",
          steps: [
            "Buka https://genjos.xoftware.my.id/mailbox atau genjos.xoftware.my.id/mailbox",
            "Akses waroengmail.com lalu https://waroengmail.com/inbox/123",
            "Buka https://www.dramaku.world/ dan dramaku.world/film.",
            "Exact menang atas root: https://contoh-box.test/mailbox vs https://contoh-box.test/lain.",
          ],
        },
      ],
      notes: ["Cadangan: (https://dramaku.world/)"],
    };
    const snapshot = JSON.stringify(input);

    const out = sanitizeSupplierCopy(input, links);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).not.toBe(input);

    expect(out.sections[0].items).toEqual([
      "Cek kode di axvara.tech/go/otp dan axvara.tech/go/otp.",
      "Link lain https://netflix-codes.sekalipay.com/other dan https://unknown.example/abc tetap.",
      "Artikel /artikel/cara-login-netflix-setelah-order-di-axvara tidak cocok sebagai host eksternal.",
      "Email user@waroengmail.com tidak diubah.",
    ]);
    expect(out.activation[0].steps).toEqual([
      "Buka axvara.tech/go/otp-genjos atau axvara.tech/go/otp-genjos",
      "Akses axvara.tech/go/otp-waroeng lalu axvara.tech/go/otp-waroeng",
      "Buka axvara.tech/go/dramaku dan axvara.tech/go/dramaku.",
      "Exact menang atas root: axvara.tech/go/contoh-box vs axvara.tech/go/contoh-root.",
    ]);
    expect(out.notes).toEqual(["Cadangan: (axvara.tech/go/dramaku)"]);
  });

  it("frasa admin ID/EN diganti saat belum menyebut AXVARA dengan menjaga kapital awal kalimat", () => {
    const input: VariantCopy = {
      source: "pemasok",
      sections: [
        {
          kind: "aturan",
          items: [
            "Hubungi admin jika gagal login.",
            "Silakan chat admin bila butuh bantuan.",
            "Error? Kontak admin segera.",
            "Hubungi admin AXVARA jika ada kendala.",
            "Sudah chat admin axvara kemarin.",
          ],
        },
      ],
      activation: [
        {
          title: null,
          steps: [
            "Contact admin if the code fails.",
            "Please contact the admin before claiming warranty.",
            "Contact AXVARA admin anytime.",
            "Please contact admin AXVARA for help.",
          ],
        },
      ],
      notes: ["kontak admin lewat chat", "contact admin support"],
    };

    const out = sanitizeSupplierCopy(input, REAL_LINKS);
    expect(out.sections[0].items).toEqual([
      "Hubungi admin AXVARA jika gagal login.",
      "Silakan hubungi admin AXVARA bila butuh bantuan.",
      "Error? Hubungi admin AXVARA segera.",
      "Hubungi admin AXVARA jika ada kendala.",
      "Sudah chat admin axvara kemarin.",
    ]);
    expect(out.activation[0].steps).toEqual([
      "Contact AXVARA admin if the code fails.",
      "Please contact AXVARA admin before claiming warranty.",
      "Contact AXVARA admin anytime.",
      "Please contact admin AXVARA for help.",
    ]);
    expect(out.notes).toEqual(["hubungi admin AXVARA lewat chat", "contact AXVARA admin support"]);
  });

  it("salinan non-pemasok (admin & axvara) tidak disentuh sama sekali", () => {
    for (const source of ["admin", "axvara"] as const) {
      const copy: VariantCopy = {
        source,
        sections: [{ kind: "aturan", items: ["Buka https://waroengmail.com/ lalu hubungi admin"] }],
        activation: [{ title: null, steps: ["Contact the admin via waroengmail.com"] }],
        notes: ["Chat admin"],
      };
      const out = sanitizeSupplierCopy(copy, REAL_LINKS);
      expect(out).toBe(copy);
      expect(out.sections[0].items[0]).toContain("https://waroengmail.com/");
      expect(out.sections[0].items[0]).toContain("hubungi admin");
      expect(out.activation[0].steps[0]).toContain("Contact the admin");
    }
  });
});

describe("loadActiveSupplierLinkMap + wiring pembeli", () => {
  let fixture: ReturnType<typeof createD1Fixture>;

  beforeEach(() => {
    clearSupplierLinksMemoForTest();
    fixture = createD1Fixture();
    vi.stubEnv("PRODUCT_VARIANTS_READ", "true");
    fixture.sql.prepare(
      `INSERT INTO supplier_links (slug, destination, title, is_active) VALUES (?,?,?,?)`,
    ).run("custom-box", "https://custom-supplier-mail.test/inbox", "Custom Mailbox", 1);
    fixture.sql.prepare(
      `INSERT INTO supplier_links (slug, destination, title, is_active) VALUES (?,?,?,?)`,
    ).run("custom-root", "https://custom-root.test/", "Custom Root", 1);
    fixture.sql.prepare(
      `INSERT INTO supplier_links (slug, destination, title, is_active) VALUES (?,?,?,?)`,
    ).run("mati-box", "https://mati-box.test/", "Nonaktif", 0);
  });

  afterEach(() => {
    vi.useRealTimers();
    fixture.close();
    clearSupplierLinksMemoForTest();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("memo per-isolate ~60s: maksimal 1 SELECT dalam TTL, refresh setelah TTL, dan gagal query tidak melempar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T10:00:00.000Z"));
    const queriesBefore = fixture.control.queries;

    const first = await loadActiveSupplierLinkMap();
    expect(fixture.control.queries - queriesBefore).toBe(1);
    expect(first.exact.get("custom-supplier-mail.test/inbox")).toBe("custom-box");
    expect(first.hostRoot.get("custom-root.test")).toBe("custom-root");
    expect(first.hostRoot.has("mati-box.test")).toBe(false);

    // Dalam TTL 60s → tidak ada SELECT tambahan.
    vi.advanceTimersByTime(SUPPLIER_LINKS_MEMO_TTL_MS - 1_000);
    const second = await loadActiveSupplierLinkMap();
    expect(fixture.control.queries - queriesBefore).toBe(1);
    expect(second).toBe(first);

    // Lewat TTL → refresh 1 SELECT.
    vi.advanceTimersByTime(2_000);
    await loadActiveSupplierLinkMap();
    expect(fixture.control.queries - queriesBefore).toBe(2);

    // Gagal query → kembalikan peta kosong tanpa throw, dan tidak meracuni cache.
    clearSupplierLinksMemoForTest();
    fixture.control.fail = (query) => query.includes("FROM supplier_links");
    const failed = await loadActiveSupplierLinkMap();
    expect(failed).toEqual(EMPTY_SUPPLIER_LINK_MAP);

    fixture.control.fail = null;
    const recovered = await loadActiveSupplierLinkMap();
    expect(recovered.exact.get("custom-supplier-mail.test/inbox")).toBe("custom-box");
  });

  it("/api/catalog mensanitasi copy & copy_en pemasok, mempertahankan admin, dan aman saat loader gagal", async () => {
    fixture.sql.exec(`
      INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_product_id, wr_auto_managed)
        VALUES (10, 2, 'Sanitize Test', 'sanitize-test', 'Desc', 10000, 5, 1, 'warung_rebahan', 'prod-san', 1);
      INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, wr_variant_id, wr_auto_managed)
        VALUES (10, 10, 'WR-SAN', 'Pemasok', 10000, 5, 1, 0, 'var-san', 1);
      INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, admin_terms, admin_activation, admin_copy_fingerprint)
        VALUES (11, 10, 'ADM-SAN', 'Admin', 12000, 5, 1, 1, 'Aturan pakai:\n- Buka https://custom-root.test/ dan hubungi admin', '', '');
      INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id) VALUES ('prod-san', 'Sanitize Test', 10);
    `);
    fixture.sql.prepare(
      `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price, wr_delivery_class)
       VALUES ('var-san', 'prod-san', 'Pemasok', 5000, 5, ?, ?, 10, 10000, 'restock')`,
    ).run(
      "Cek https://custom-supplier-mail.test/inbox dan chat admin bila error",
      "1. Buka custom-root.test/login lalu contact the admin",
    );

    const { GET } = await import("@/app/api/catalog/route");
    const res = await GET(new Request("http://localhost/api/catalog?slug=sanitize-test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const pemasok = body.product.variants.find((v: { id: number }) => v.id === 10);
    const admin = body.product.variants.find((v: { id: number }) => v.id === 11);

    expect(JSON.stringify(pemasok.copy)).toContain("axvara.tech/go/custom-box");
    expect(JSON.stringify(pemasok.copy)).toContain("axvara.tech/go/custom-root");
    expect(JSON.stringify(pemasok.copy)).toContain("hubungi admin AXVARA");
    expect(JSON.stringify(pemasok.copy)).toContain("contact AXVARA admin");
    expect(JSON.stringify(pemasok.copy_en)).toContain("axvara.tech/go/custom-box");
    expect(JSON.stringify(pemasok.copy_en)).toContain("axvara.tech/go/custom-root");

    // Admin copy tidak tersentuh sanitizer.
    expect(JSON.stringify(admin.copy)).toContain("https://custom-root.test/");
    expect(JSON.stringify(admin.copy)).toContain("hubungi admin");
    expect(JSON.stringify(admin.copy)).not.toContain("hubungi admin AXVARA");

    // Saat link loader gagal: tidak melempar dan URL custom-supplier-mail tidak disanitasi.
    clearSupplierLinksMemoForTest();
    fixture.control.fail = (query) => query.includes("FROM supplier_links");
    const fallbackRes = await GET(new Request("http://localhost/api/catalog?slug=sanitize-test"));
    expect(fallbackRes.status).toBe(200);
    const fallbackBody = await fallbackRes.json();
    const fallbackPemasok = fallbackBody.product.variants.find((v: { id: number }) => v.id === 10);
    expect(JSON.stringify(fallbackPemasok.copy)).toContain("https://custom-supplier-mail.test/inbox");
    expect(JSON.stringify(fallbackPemasok.copy)).not.toContain("axvara.tech/go/custom-box");
  });

  it("credential-terms mensanitasi copy pemasok dan aman saat loader gagal", async () => {
    fixture.sql.exec(`
      INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, source, wr_product_id, wr_auto_managed)
        VALUES (20, 2, 'Cred Test', 'cred-test', 'Desc', 10000, 5, 1, 'warung_rebahan', 'prod-cred', 1);
      INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, wr_variant_id, wr_auto_managed)
        VALUES (20, 20, 'WR-CRED', 'Pemasok', 10000, 5, 1, 0, 'var-cred', 1);
      INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id) VALUES ('prod-cred', 'Cred Test', 20);
    `);
    fixture.sql.prepare(
      `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price, wr_delivery_class)
       VALUES ('var-cred', 'prod-cred', 'Pemasok', 5000, 5, ?, ?, 20, 10000, 'restock')`,
    ).run("Buka custom-supplier-mail.test/inbox", "Hubungi admin bila error");

    const { resolveCredentialTermsForVariants } = await import("@/lib/orders/credential-terms");
    const db = createDatabaseAccess(fixture.db);
    const copies = await resolveCredentialTermsForVariants([20], db);
    expect(JSON.stringify(copies.get(20))).toContain("axvara.tech/go/custom-box");
    expect(JSON.stringify(copies.get(20))).toContain("Hubungi admin AXVARA bila error");

    clearSupplierLinksMemoForTest();
    fixture.control.fail = (query) => query.includes("FROM supplier_links");
    const noSanitize = await resolveCredentialTermsForVariants([20], db);
    expect(JSON.stringify(noSanitize.get(20))).toContain("custom-supplier-mail.test/inbox");
    expect(JSON.stringify(noSanitize.get(20))).not.toContain("axvara.tech/go/custom-box");
  });

  it("Telegram handleProductTerms mensanitasi copy pemasok dan aman saat loader gagal", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:test");
    const tgTexts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("api.telegram.org")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        if (body.text) tgTexts.push(body.text);
        return new Response(JSON.stringify({ ok: true, result: { message_id: tgTexts.length } }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    fixture.sql.exec(`
      INSERT INTO products (id, category_id, name, slug, description, price, stock, is_active, telegram_enabled, source, wr_product_id, wr_auto_managed)
        VALUES (30, 2, 'TG Test', 'tg-test', 'Desc', 10000, 5, 1, 1, 'warung_rebahan', 'prod-tg', 1);
      INSERT INTO product_variants (id, product_id, sku, label, price, stock, is_active, sort_order, wr_variant_id, wr_auto_managed)
        VALUES (30, 30, 'WR-TG', 'Pemasok', 10000, 5, 1, 0, 'var-tg', 1);
      INSERT INTO wr_products (wr_product_id, wr_product_name, axvara_product_id) VALUES ('prod-tg', 'TG Test', 30);
    `);
    fixture.sql.prepare(
      `INSERT INTO wr_variants (wr_variant_id, wr_product_id, wr_variant_name, wr_price, wr_stock, wr_terms, wr_delivery_terms, axvara_variant_id, axvara_sell_price, wr_delivery_class)
       VALUES ('var-tg', 'prod-tg', 'Pemasok', 5000, 5, ?, ?, 30, 10000, 'restock')`,
    ).run("Buka https://custom-supplier-mail.test/inbox\nKontak admin jika error", null);

    const { handleProductTerms } = await import("@/lib/telegram/handlers/catalog");
    await handleProductTerms(999001, 30, 30, 0, { id: 999001 });
    expect(tgTexts).toHaveLength(1);
    expect(tgTexts[0]).toContain("axvara.tech/go/custom-box");
    expect(tgTexts[0]).toContain("Hubungi admin AXVARA jika error");

    clearSupplierLinksMemoForTest();
    fixture.control.fail = (query) => query.includes("FROM supplier_links");
    await handleProductTerms(999001, 30, 30, 0, { id: 999001 });
    expect(tgTexts).toHaveLength(2);
    expect(tgTexts[1]).toContain("https://custom-supplier-mail.test/inbox");
    expect(tgTexts[1]).not.toContain("axvara.tech/go/custom-box");
  });
});
