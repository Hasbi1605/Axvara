// tests/sekalipay/sk-saldo-branding.test.ts — Anti-spam notif saldo SK + rewrite link docs.
//
// Dua insiden owner 2026-10-02/03:
// (1) Notif "Saldo Sekalipay menipis" spam sampai 24x/hari (throttle cuma 1 jam
//     + state di sk_saldo_log yang CHECK-constraint source-nya rapuh; sesi
//     opencode ses_f029e7563ffeHxmGJv5ZoqN381). Kini 1:1 WR: 6 jam ATAU turun
//     Rp5.000, state di sk_sync_state key='low_saldo_notified'.
// (2) Link sekalipay.com/docs/tutorial-login-netflix bocor ke PDP + email
//     (customer klik → nav "Belanja Sekarang" → order langsung di supplier).
//     Kini rewrite ke artikel AXVARA; mailbox OTP dipertahankan.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseAccess } from "@/lib/db-access";
import { checkAndLogSkSaldo } from "@/lib/sekalipay/saldo";
import { formatSkLicenses } from "@/lib/sekalipay/deliver";
import { AXVARA_NETFLIX_GUIDE_PATH, rewriteSupplierDocsLinks, supplierVariantCopy } from "@/lib/product-copy/format";
import { CURATED_VARIANT_COPY } from "@/lib/product-copy/curated";
import { createD1Fixture } from "../helpers/d1-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubSaldoApi(balance: number, telegram: { sent: unknown[] }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      if (String(url).includes("api.telegram.org")) {
        telegram.sent.push(url);
        return { ok: true, json: async () => ({ ok: true, result: {} }) };
      }
      return { ok: true, json: async () => ({ message: "OK", data: { balance } }) };
    }),
  );
}

function skEnv() {
  vi.stubEnv("SEKALIPAY_ENABLED", "true");
  vi.stubEnv("SEKALIPAY_PROXY_URL", "https://proxy.test");
  vi.stubEnv("SEKALIPAY_PROXY_TOKEN", "tok");
  vi.stubEnv("SEKALIPAY_SALDO_ALERT_THRESHOLD", "50000");
  vi.stubEnv("TELEGRAM_BOT_ENABLED", "true");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-1000");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
}

describe("anti-spam notif saldo SK (cermin WR 1:1)", () => {
  it("3x cek saldo sama dalam <6 jam → hanya 1 notifikasi", async () => {
    const fx = createD1Fixture();
    try {
      skEnv();
      const telegram = { sent: [] as unknown[] };
      stubSaldoApi(10000, telegram);
      const db = createDatabaseAccess(fx.db);
      await checkAndLogSkSaldo(db);
      await checkAndLogSkSaldo(db);
      await checkAndLogSkSaldo(db);
      expect(telegram.sent.length).toBe(1);
    } finally {
      fx.close();
    }
  });

  it("saldo turun melewati kelipatan Rp5.000 → notifikasi kedua keluar", async () => {
    const fx = createD1Fixture();
    try {
      skEnv();
      const telegram = { sent: [] as unknown[] };
      stubSaldoApi(41900, telegram);
      const db = createDatabaseAccess(fx.db);
      await checkAndLogSkSaldo(db);
      expect(telegram.sent.length).toBe(1);
      // Turun 41900 → 34500: melewati kelipatan 40000 (batas 35000) → bunyi lagi.
      stubSaldoApi(34500, telegram);
      await checkAndLogSkSaldo(db);
      expect(telegram.sent.length).toBe(2);
      // Stagnan di 34500 → bungkam (kasus screenshot owner Rp41.900 × 5).
      await checkAndLogSkSaldo(db);
      expect(telegram.sent.length).toBe(2);
    } finally {
      fx.close();
    }
  });

  it("saldo cukup tidak isLow dan tidak kirim apa pun", async () => {
    const fx = createD1Fixture();
    try {
      skEnv();
      const telegram = { sent: [] as unknown[] };
      stubSaldoApi(300000, telegram);
      const result = await checkAndLogSkSaldo(createDatabaseAccess(fx.db));
      expect(result.isLow).toBe(false);
      expect(telegram.sent.length).toBe(0);
    } finally {
      fx.close();
    }
  });

  it("disabled melempar, bukan mencatat diam-diam", async () => {
    const fx = createD1Fixture();
    try {
      vi.stubEnv("SEKALIPAY_ENABLED", "false");
      await expect(checkAndLogSkSaldo(createDatabaseAccess(fx.db))).rejects.toThrow("sekalipay_disabled");
    } finally {
      fx.close();
    }
  });
});

describe("rewrite link docs supplier → artikel AXVARA", () => {
  it("link tutorial Netflix (https + bare) jadi artikel AXVARA", () => {
    const raw = "CARA LOGIN = https://sekalipay.com/docs/tutorial-login-netflix\nAKSES = netflix-codes.sekalipay.com/mailbox";
    const out = rewriteSupplierDocsLinks(raw)!;
    expect(out).toContain(`https://axvara.tech${AXVARA_NETFLIX_GUIDE_PATH}`);
    // Mailbox OTP dipertahankan (alat fungsional tanpa nav belanja).
    expect(out).toContain("netflix-codes.sekalipay.com/mailbox");
    expect(out).not.toContain("sekalipay.com/docs/");
  });

  it("fallback PDP (supplierVariantCopy) tidak pernah bocor docs Sekalipay", () => {
    const copy = supplierVariantCopy(
      null,
      "CARA LOGIN = https://sekalipay.com/docs/tutorial-login-netflix\nAKSES BOT / KODE = https://netflix-codes.sekalipay.com/mailbox\n1. Install ulang aplikasi",
    )!;
    const all = [
      ...copy.sections.flatMap((s) => s.items),
      ...copy.activation.flatMap((g) => g.steps),
    ].join("\n");
    expect(all).not.toContain("sekalipay.com/docs/");
    expect(all).toContain("axvara.tech/artikel/cara-login-netflix");
    expect(all).toContain("netflix-codes.sekalipay.com/mailbox");
  });

  it("kurasi Netflix di kode tidak lagi menyebut sekalipay.com/docs", () => {
    const netflix = CURATED_VARIANT_COPY.filter((e) => e.label.startsWith("Netflix"));
    expect(netflix.length).toBeGreaterThan(0);
    const joined = netflix
      .flatMap((e) => [...(e.grupLangkah ?? []).flatMap((g) => g.langkah), ...(e.langkah ?? [])])
      .join("\n");
    expect(joined).not.toContain("sekalipay.com/docs/");
    expect(joined).toContain(AXVARA_NETFLIX_GUIDE_PATH);
  });

  it("email/panel pasca-bayar (formatSkLicenses) ikut bersih", () => {
    const text = formatSkLicenses({
      id: 1, ref_id: "R1", invoice: "INV-1", payment_method: "saldo", status: "completed",
      price: 15000, fees: 0, amount: 15000,
      items: [
        {
          variant_id: 14, variant_name: "1 Profile 1 User", product_name: "Netflix",
          product_license: "user@mail.com|pass123",
          seller_note: "CARA LOGIN = https://sekalipay.com/docs/tutorial-login-netflix\nAKSES = https://netflix-codes.sekalipay.com/mailbox",
          price: 15000, qty: 1, note: null, order_process: "auto" as const,
        },
      ],
      h2h_results: [], smm_results: [],
    });
    expect(text).not.toContain("sekalipay.com/docs/");
    expect(text).toContain("axvara.tech/artikel/cara-login-netflix");
    expect(text).toContain("netflix-codes.sekalipay.com/mailbox");
    expect(text).toContain("user@mail.com");
  });

  it("link non-docs (resmi/OTP/tutorial umum) tidak ikut di-rewrite", () => {
    const raw = "Buka https://www.netflix.com/clearcookies lalu https://oliesmail.com/ dan https://youtu.be/abc123";
    expect(rewriteSupplierDocsLinks(raw)).toBe(raw);
  });
});
