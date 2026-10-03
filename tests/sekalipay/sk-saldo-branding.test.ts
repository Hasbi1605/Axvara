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
import { AXVARA_ALIGHT_GUIDE_PATH, AXVARA_NETFLIX_GUIDE_PATH, GO_ALIGHT_LOGIN, GO_BOT_ALIGHT, GO_BOT_SCRIBD, GO_BOT_VIU, GO_MAIL_OLIES, GO_NETFLIX_LOGIN, GO_OTP, GO_OTP_2FA, GO_OTP_GENERATOR, GO_OTP_GENJOS, GO_OTP_RUNCUBES, GO_OTP_SEKALICHAT, GO_OTP_SPOTIFY, GO_OTP_WAROENG, GO_TUTOR_ARCADE, GO_TUTOR_CANVA, GO_TUTOR_REMINI, GO_TUTOR_SCRIBD, GO_TUTOR_VISION_TV, GO_TUTOR_VISION_TV2, rewriteSupplierDocsLinks, supplierVariantCopy } from "@/lib/product-copy/format";
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

describe("rewrite link docs supplier → shortlink axvara.tech/go/*", () => {
  it("link tutorial Netflix (https + bare) jadi artikel AXVARA", () => {
    const raw = "CARA LOGIN = https://sekalipay.com/docs/tutorial-login-netflix\nAKSES = netflix-codes.sekalipay.com/mailbox";
    const out = rewriteSupplierDocsLinks(raw)!;
    expect(out).toContain(GO_NETFLIX_LOGIN);
    // Mailbox ikut dibungkus (shortlink 2026-10-03, bukan mentah lagi).
    expect(out).toContain(GO_OTP);
    expect(out).not.toContain("sekalipay.com/docs/");
    expect(out).not.toContain("netflix-codes.sekalipay.com/mailbox");
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
    expect(all).toContain("go/netflix-login");
    expect(all).toContain("go/otp");
  });

  it("kurasi Netflix di kode tidak lagi menyebut sekalipay.com/docs", () => {
    const netflix = CURATED_VARIANT_COPY.filter((e) => e.label.startsWith("Netflix"));
    expect(netflix.length).toBeGreaterThan(0);
    const joined = netflix
      .flatMap((e) => [...(e.grupLangkah ?? []).flatMap((g) => g.langkah), ...(e.langkah ?? [])])
      .join("\n");
    expect(joined).not.toContain("sekalipay.com/docs/");
    expect(joined).toContain("go/netflix-login");
    // Canonical SEO /artikel tetap ada di konstanta (sitemap + metadata).
    expect(AXVARA_NETFLIX_GUIDE_PATH).toBe("/artikel/cara-login-netflix-setelah-order-di-axvara");
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
    expect(text).toContain("go/netflix-login");
    expect(text).toContain("go/otp");
    expect(text).toContain("user@mail.com");
  });

  it("link yang dipertahankan (clearcookies/tutorial umum) tidak ikut di-rewrite; oliesmail DIBUNGKUS", () => {
    // Keputusan owner 2026-10-03: netflix clearcookies/youraccount dibiarkan
    // apa adanya; oliesmail DIBUNGKUS (go/mail-olies).
    const raw = "Buka https://www.netflix.com/clearcookies lalu https://youtu.be/abc123";
    expect(rewriteSupplierDocsLinks(raw)).toBe(raw);
    expect(rewriteSupplierDocsLinks("Akses https://oliesmail.com/ ya")!).toContain(GO_MAIL_OLIES);
  });

  it("audit live D1 prod: mailbox genjos/tmail/waroengmail/runcubes/generator/2fa jadi shortlink", () => {
    const cases: [string, string][] = [
      ["LINK AKSES KODE = https://genjos.xoftware.my.id/mailbox", GO_OTP_GENJOS],
      ["EMAIL AKSES = tmail.sekalichat.com", GO_OTP_SEKALICHAT],
      ["AKSES EMAIL / KODE = waroengmail.com", GO_OTP_WAROENG],
      ["email akses : tmail.runcubesapps.com/mailbox", GO_OTP_RUNCUBES],
      ["AKSES MAIL : https://generator.email/emailnyadisini", GO_OTP_GENERATOR],
      ["Buka web https://2fa.live/", GO_OTP_2FA],
    ];
    for (const [raw, go] of cases) {
      const out = rewriteSupplierDocsLinks(raw)!;
      expect(out, raw).toContain(go);
    }
  });

  it("audit live: bot Telegram supplier jadi shortlink", () => {
    expect(rewriteSupplierDocsLinks("Minta OTP ke bot telegram @autoresetpwspotify_bot")!).toContain(GO_OTP_SPOTIFY);
    expect(rewriteSupplierDocsLinks("SILAHKAN BUKA BOT INI @sekalipayviu_bot")!).toContain(GO_BOT_VIU);
    expect(rewriteSupplierDocsLinks("buka bot @alightmotion321_bot")!).toContain(GO_BOT_ALIGHT);
    expect(rewriteSupplierDocsLinks("ke telegram @Scribd_Downloaderbot ya")!).toContain(GO_BOT_SCRIBD);
    // Handle lain (bukan supplier) tidak tersentuh.
    expect(rewriteSupplierDocsLinks("hubungi @Axvara_bot ya")!).toContain("@Axvara_bot");
  });

  it("audit live: tutorial YouTube supplier jadi shortlink, ID lain tidak", () => {
    const cases: [string, string][] = [
      ["▶️ https://youtu.be/p_xpw5M1zaU", GO_TUTOR_CANVA],
      ["> https://youtu.be/J07zn3FAJyY", GO_TUTOR_REMINI],
      ["Tutor cek https://youtu.be/8nMzvoauNVk", GO_TUTOR_SCRIBD],
      ["> https://youtu.be/IbSEx5_pUr8", GO_TUTOR_ARCADE],
      ["TV : https://www.youtube.com/watch?v=XzMXIty8kr4", GO_TUTOR_VISION_TV],
      ["TV https://www.youtube.com/watch?v=Ylrroy1fJAE", GO_TUTOR_VISION_TV2],
    ];
    for (const [raw, go] of cases) {
      const out = rewriteSupplierDocsLinks(raw)!;
      expect(out, raw).toContain(go);
    }
    // ID tak dikenal + Office kurasi tidak tersentuh.
    expect(rewriteSupplierDocsLinks("Lihat https://youtu.be/abc123XYZ_- ya")!).toContain("abc123XYZ_-");
    expect(rewriteSupplierDocsLinks("Tutor https://www.youtube.com/watch?v=fBOfOmj9Uj8")!).toContain("fBOfOmj9Uj8");
  });

  it("mailbox supplier screenshot owner (sengare/fnstore/losantoz) jadi shortlink", () => {
    expect(rewriteSupplierDocsLinks("AKSES KODE = https://sengare.art/check-inbox")!).toContain("go/otp-sengare");
    const iqiyi = rewriteSupplierDocsLinks("Akses email: fnstore.my.id / losantoz.com")!;
    expect(iqiyi).toContain("go/mail-fnstore");
    expect(iqiyi).toContain("go/mail-losantoz");
  });

  it("video login Alight Motion supplier (semua bentuk URL + bare) jadi artikel AXVARA", () => {
    // Bentuk persis di D1 prod varian SK-8/SK-49 (screenshot owner): youtu.be + query si=.
    const raw = "SILAHKAN IKUTI TUTORIAL LOGIN DIBAWAH INI :\n\nhttps://youtu.be/8emqddsjPsE?si=Jntt_X5oKtWkoJ_Q";
    const out = rewriteSupplierDocsLinks(raw)!;
    expect(out).toContain(GO_ALIGHT_LOGIN);
    expect(out).not.toContain("youtu.be/8emqddsjPsE");
    // Bentuk lain ID yang sama ikut di-rewrite.
    for (const variant of [
      "https://www.youtube.com/watch?v=8emqddsjPsE",
      "https://www.youtube.com/watch?v=8emqddsjPsE&si=XuKWvD2e5fohaciR",
      "https://www.youtube.com/embed/8emqddsjPsE",
      "https://www.youtube.com/shorts/8emqddsjPsE",
      "youtu.be/8emqddsjPsE?si=XuKWvD2e5fohaciR",
      "www.youtube.com/watch?v=8emqddsjPsE",
    ]) {
      const rewritten = rewriteSupplierDocsLinks(`Lihat ${variant} ya`)!;
      expect(rewritten, variant).toContain(GO_ALIGHT_LOGIN);
      expect(rewritten, variant).not.toContain("8emqddsjPsE");
    }
  });

  it("video YouTube ID LAIN tidak ikut di-rewrite", () => {
    // Tutorial umum (mis. Office fBOfOmj9Uj8 di snapshot) bukan milik supplier ini.
    const raw = "Tutorial https://www.youtube.com/watch?v=fBOfOmj9Uj8 dan https://youtu.be/abc123";
    expect(rewriteSupplierDocsLinks(raw)).toBe(raw);
  });

  it("fallback PDP + email Alight Motion ikut bersih dari youtu.be supplier", () => {
    const sellerNote = "SILAHKAN IKUTI TUTORIAL LOGIN DIBAWAH INI :\n\nhttps://youtu.be/8emqddsjPsE?si=Jntt_X5oKtWkoJ_Q";
    const copy = supplierVariantCopy(null, sellerNote)!;
    const all = [
      ...copy.sections.flatMap((s) => s.items),
      ...copy.activation.flatMap((g) => g.steps),
    ].join("\n");
    expect(all).not.toContain("youtu.be");
    expect(all).toContain("go/alight-login");
    const text = formatSkLicenses({
      id: 1, ref_id: "R1", invoice: "INV-1", payment_method: "saldo", status: "completed",
      price: 1000, fees: 0, amount: 1000,
      items: [
        {
          variant_id: 112, variant_name: "1 Tahun [ Android ]", product_name: "Alight Motion",
          product_license: "user@mail.com|pass123",
          seller_note: sellerNote,
          price: 1000, qty: 1, note: null, order_process: "auto" as const,
        },
      ],
      h2h_results: [], smm_results: [],
    });
    expect(text).not.toContain("youtu.be");
    expect(text).toContain("go/alight-login");
  });
});
