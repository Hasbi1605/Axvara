// tests/wa-hub.regression.test.ts — Hub pemilih nomor WA admin /wa (2026-10-10).
//
// Keputusan owner URGENT: suspend satu nomor tidak boleh mematikan seluruh
// traffic WA. SEMUA tombol "Chat WA admin" (web, /link, footer, lacak,
// pesanan, keyboard Telegram) mendarat di /wa — user memilih nomor aktif.
// wa.me langsung HANYA untuk: chat-balik admin → buyer (nomor buyer),
// Share artikel (wa.me/?text=), dan kartu /wa itu sendiri.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { adminWaLink, waHubLink, whatsappLink, SUPPORT_WA_NUMBERS, SITE } from "@/lib/site";

function read(p: string): string {
  return fs.readFileSync(path.join(process.cwd(), p), "utf-8");
}

describe("Hub WA /wa — satu pintu semua tombol admin", () => {
  it("3 nomor owner terdaftar dengan 1 suspend jujur", () => {
    expect(SUPPORT_WA_NUMBERS).toHaveLength(3);
    expect(SUPPORT_WA_NUMBERS.map((n) => n.intl)).toEqual([
      "6283177738496",
      "6289519388264",
      "6283826039171",
    ]);
    expect(SUPPORT_WA_NUMBERS[0].label).toBe("AXVARA 1");
    expect(SUPPORT_WA_NUMBERS[1].status).toBe("suspended");
    expect(SUPPORT_WA_NUMBERS.filter((n) => n.status === "active")).toHaveLength(2);
  });

  it("adminWaLink + waHubLink mengarah ke /wa dengan pesan bawaan, bukan wa.me", () => {
    expect(adminWaLink("Halo AXVARA, saya butuh bantuan.")).toBe(
      "/wa?pesan=Halo%20AXVARA%2C%20saya%20butuh%20bantuan.",
    );
    expect(adminWaLink()).toBe("/wa?pesan=Halo%20AXVARA");
    expect(waHubLink("tanya pesanan AXV-1")).toContain("/wa?pesan=");
    expect(adminWaLink("x")).not.toContain("wa.me");
  });

  it("StoreWhatsAppLink + footer + /link memakai hub (bukan wa.me langsung)", () => {
    expect(read("src/components/storefront/StoreWhatsAppLink.tsx")).toContain("waHubLink(");
    expect(read("src/components/storefront/StoreWhatsAppLink.tsx")).not.toContain("whatsappLink(settings.whatsappNumber");
    expect(read("src/components/storefront/Footer.tsx")).toContain("waHubLink(");
    expect(read("src/app/(shop)/link/link-bio-client.tsx")).toContain("adminWaLink(");
  });

  it("keyboard Telegram: tombol WA = URL absolut /wa (path relatif tidak bisa diklik di Telegram)", () => {
    const src = read("src/lib/telegram/keyboards.ts");
    expect(src).toContain("SITE.webUrl}/wa?pesan=");
    expect(src).not.toContain("adminWaLink(");
  });

  it("copy Telegram teks: kontak WA = hub /wa (help + lunas + input-WA)", () => {
    for (const f of [
      "src/lib/telegram/messages/help.ts",
      "src/lib/telegram/messages/status.ts",
    ]) {
      // Template memakai `${SITE.webUrl}/wa` (render = https://axvara.tech/wa).
      expect(read(f)).toContain("}/wa");
    }
    expect(read("src/lib/telegram/messages/help.ts")).not.toContain("wa.me/6289519388264");
  });

  it("halaman /wa: 3 kartu nomor + badge suspend + Telegram + pesan bawaan", () => {
    const src = read("src/app/(shop)/wa/wa-hub-client.tsx");
    expect(src).toContain("SUPPORT_WA_NUMBERS");
    expect(src).toContain("Suspend sementara");
    expect(src).toContain("supportTelegramLink()");
    expect(src).toContain('params.get("pesan")');
    expect(src).toContain("whatsappLink(n.intl, pesan)");
    const page = read("src/app/(shop)/wa/page.tsx");
    expect(page).toContain('canonical: "/wa"');
    expect(page).toContain("index: false");
  });

  it("pengecualian tetap wa.me langsung: chat-balik admin, share artikel, kartu /wa", () => {
    // Chat-balik admin → buyer (nomor buyer, bukan nomor admin).
    expect(read("src/lib/telegram/keyboards.ts")).toContain("https://wa.me/${customerWa}");
    // Share artikel (wa.me/?text=, bukan chat admin).
    expect(read("src/app/(shop)/artikel/[slug]/page.tsx")).toContain("https://wa.me/?text=");
    // Email kredensial (tombol hijau footer email).
    expect(read("src/lib/warung-rebahan/email-forward.ts")).toContain("https://wa.me/${intl}");
  });

  it("SITE adminWa* dipertahankan (telepon SEO + fallback settings), bukan dihapus", () => {
    expect(SITE.adminWaIntl).toBe("6289519388264");
    expect(read("src/lib/site-seo.ts")).toContain("adminWaIntl");
    // whatsappLink generik tetap ada untuk pengecualian di atas.
    expect(whatsappLink("089519388264", "Halo")).toBe("https://wa.me/6289519388264?text=Halo");
  });
});
