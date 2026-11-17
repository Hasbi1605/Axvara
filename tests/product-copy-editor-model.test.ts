import { describe, expect, it } from "vitest";
import {
  composeAdminCopy,
  composeDescription,
  splitAdminCopy,
  splitDescription,
  summarizeDescriptionCopy,
  variantCopyTitle,
} from "@/lib/product-copy/editor-model";
import { parseAdminVariantCopy, parseProductDescription } from "@/lib/product-copy/format";

describe("editor-model: splitAdminCopy & composeAdminCopy", () => {
  it("round-trips admin texts with all four ID headings, grouped activation, and Catatan notes", () => {
    const terms = [
      "Detail paket:",
      "- Akun private siap pakai",
      "- Masa aktif 30 hari",
      "",
      "Proses & pengiriman:",
      "- Dikirim otomatis setelah bayar",
      "",
      "Aturan pakai:",
      "- Dilarang ganti password",
      "- Maksimal 2 perangkat",
      "",
      "Garansi:",
      "- Full garansi selama masa aktif",
    ].join("\n");

    const activation = [
      "Android:",
      "1. Buka aplikasi Canva",
      "2. Login dengan email yang dikirim",
      "",
      "iOS:",
      "1. Buka Safari lalu login",
      "",
      "Catatan:",
      "- Hubungi admin bila OTP tidak masuk",
    ].join("\n");

    const split = splitAdminCopy(terms, activation);
    expect(split).toEqual({
      paket: ["Akun private siap pakai", "Masa aktif 30 hari"],
      proses: ["Dikirim otomatis setelah bayar"],
      aturan: ["Dilarang ganti password", "Maksimal 2 perangkat"],
      garansi: ["Full garansi selama masa aktif"],
      activation: [
        "Android:",
        "Buka aplikasi Canva",
        "Login dengan email yang dikirim",
        "iOS:",
        "Buka Safari lalu login",
      ],
      notes: ["Hubungi admin bila OTP tidak masuk"],
    });

    const composed = composeAdminCopy(split, "id");
    expect(parseAdminVariantCopy(composed.terms, composed.activation)).toEqual(
      parseAdminVariantCopy(terms, activation),
    );
  });

  it("round-trips unheaded texts (auto-classified) identically under parseAdminVariantCopy", () => {
    const terms = [
      "Masa aktif 1 bulan penuh",
      "Dikirim otomatis setelah pembayaran",
      "Dilarang mengubah email akun",
      "Garansi 25 hari bila sesuai aturan",
    ].join("\n");
    const activation = "1. Buka aplikasi\n2. Masukkan kode OTP";

    const split = splitAdminCopy(terms, activation);
    expect(split.paket).toEqual(["Masa aktif 1 bulan penuh"]);
    expect(split.proses).toEqual(["Dikirim otomatis setelah pembayaran"]);
    expect(split.aturan).toEqual(["Dilarang mengubah email akun"]);
    expect(split.garansi).toEqual(["Garansi 25 hari bila sesuai aturan"]);
    expect(split.activation).toEqual(["Buka aplikasi", "Masukkan kode OTP"]);

    const composed = composeAdminCopy(split, "id");
    expect(parseAdminVariantCopy(composed.terms, composed.activation)).toEqual(
      parseAdminVariantCopy(terms, activation),
    );
  });

  it("round-trips EN headings ('Package details:', etc.) and Notes:", () => {
    const termsEn = [
      "Package details:",
      "- Ready-to-use account",
      "",
      "Process & delivery:",
      "- Sent automatically after payment",
      "",
      "Usage rules:",
      "- Do not change the password",
      "",
      "Warranty:",
      "- Full warranty during active period",
    ].join("\n");
    const activationEn = [
      "Desktop:",
      "1. Open the website",
      "2. Sign in with your account",
      "",
      "Notes:",
      "- Contact admin if login fails",
    ].join("\n");

    const split = splitAdminCopy(termsEn, activationEn);
    expect(split.paket).toEqual(["Ready-to-use account"]);
    expect(split.proses).toEqual(["Sent automatically after payment"]);
    expect(split.aturan).toEqual(["Do not change the password"]);
    expect(split.garansi).toEqual(["Full warranty during active period"]);
    expect(split.activation).toEqual(["Desktop:", "Open the website", "Sign in with your account"]);
    expect(split.notes).toEqual(["Contact admin if login fails"]);

    const composed = composeAdminCopy(split, "en");
    expect(composed.terms).toContain("Package details:");
    expect(composed.terms).toContain("Process & delivery:");
    expect(composed.terms).toContain("Usage rules:");
    expect(composed.terms).toContain("Warranty:");
    expect(composed.activation).toContain("Notes:");
    expect(parseAdminVariantCopy(composed.terms, composed.activation)).toEqual(
      parseAdminVariantCopy(termsEn, activationEn),
    );
  });

  it("strips user-typed bullet/number prefixes cleanly and handles empty input", () => {
    const empty = splitAdminCopy("", "");
    expect(empty).toEqual({ paket: [], proses: [], aturan: [], garansi: [], activation: [], notes: [] });
    expect(composeAdminCopy(empty)).toEqual({ terms: "", activation: "" });

    const composed = composeAdminCopy({
      paket: ["- Paket 1 bulan"],
      proses: [],
      aturan: ["• Dilarang spam"],
      garansi: [],
      activation: ["1. Buka aplikasi", "2. Klik masuk"],
      notes: ["- Jangan lupa logout"],
    });
    expect(composed.terms).toBe("Detail paket:\n- Paket 1 bulan\n\nAturan pakai:\n- Dilarang spam");
    expect(composed.activation).toBe("1. Buka aplikasi\n2. Klik masuk\n\nCatatan:\n- Jangan lupa logout");
  });
});

describe("editor-model: splitDescription & composeDescription", () => {
  it("round-trips ID description with body, custom section, Syarat & Ketentuan, and Cara Aktivasi", () => {
    const desc = [
      "Canva Pro membuka fitur premium untuk desain cepat.",
      "",
      "- Jutaan template siap pakai",
      "- Background Remover sekali klik",
      "",
      "Contoh:",
      "- Poster & presentasi",
      "",
      "Syarat & Ketentuan:",
      "- Undangan dikirim lewat email",
      "- Pastikan email aktif saat checkout",
      "- Garansi penuh selama masa aktif",
      "",
      "Cara Aktivasi:",
      "1. Buka email undangan",
      "2. Klik terima undangan",
    ].join("\n");

    const split = splitDescription(desc);
    expect(split.body).toContain("Canva Pro membuka fitur premium");
    expect(split.body).toContain("Contoh:\n- Poster & presentasi");
    expect(split.body).not.toContain("Syarat & Ketentuan:");
    expect(split.body).not.toContain("Cara Aktivasi:");
    expect(split.aturan).toContain("Pastikan email aktif saat checkout");
    expect(split.garansi).toContain("Garansi penuh selama masa aktif");
    expect(split.activation).toEqual(["Buka email undangan", "Klik terima undangan"]);
    expect(summarizeDescriptionCopy(split)).toBe("3 aturan · 2 langkah");

    const composed = composeDescription(split, "id");
    expect(parseProductDescription(composed)).toEqual(parseProductDescription(desc));
  });

  it("round-trips EN description with Terms & Conditions and How to Activate", () => {
    const descEn = [
      "Premium design suite with full AI tools.",
      "",
      "- Unlimited templates",
      "",
      "Terms & Conditions:",
      "- Invite sent to your email",
      "- Do not share invite link",
      "",
      "How to Activate:",
      "1. Open your inbox",
      "2. Accept the invite",
    ].join("\n");

    const split = splitDescription(descEn);
    expect(split.body).toBe("Premium design suite with full AI tools.\n\n- Unlimited templates");
    expect(split.activation).toEqual(["Open your inbox", "Accept the invite"]);

    const composed = composeDescription(split, "en");
    expect(composed).toContain("Terms & Conditions:");
    expect(composed).toContain("How to Activate:");
    expect(parseProductDescription(composed)).toEqual(parseProductDescription(descEn));
  });

  it("formats variantCopyTitle cleanly", () => {
    expect(variantCopyTitle({ label: "Premium", sku: "WR-1", duration_label: "28 Hari" })).toBe("Premium · 28 Hari");
    expect(variantCopyTitle({ label: "Premium 28 Hari", sku: "WR-1", duration_label: "28 Hari" })).toBe("Premium 28 Hari");
    expect(variantCopyTitle({ label: "", sku: "SKU-9" })).toBe("SKU-9");
  });
});
