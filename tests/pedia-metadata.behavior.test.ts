// @vitest-environment node
// Metadata Pedia ID/EN (2026-11-07): title/description/OpenGraph mengikuti
// cookie axv_locale; canonical route yang sudah ada TIDAK berubah.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieState = vi.hoisted(() => ({ value: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => cookieState.value }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/pedia", useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import { generateMetadata as layoutMetadata } from "@/app/pedia/layout";
import { generateMetadata as catalogMetadata } from "@/app/pedia/layanan/page";
import { generateMetadata as helpMetadata } from "@/app/pedia/bantuan/page";
import { generateMetadata as termsMetadata } from "@/app/pedia/ketentuan/page";
import { generateMetadata as trackMetadata } from "@/app/pedia/lacak/layout";
import { generateMetadata as refillMetadata } from "@/app/pedia/refill/page";
import { generateMetadata as orderMetadata } from "@/app/pedia/pesanan/[code]/layout";
import { generateMetadata as productMetadata } from "@/app/pedia/o/[slug]/page";
import { generateMetadata as platformMetadata } from "@/app/pedia/p/[platform]/page";

beforeEach(() => { cookieState.value = ""; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Metadata Pedia mengikuti axv_locale", () => {
  it("layout: title default/template, description, OG locale ID vs EN", async () => {
    const id = await layoutMetadata();
    expect(id.description).toContain("Katalog followers");
    expect((id.title as { default: string }).default).toBe("Axvara Pedia — Layanan sosial media termurah");
    expect((id.openGraph as { locale: string }).locale).toBe("id_ID");

    cookieState.value = "axv_locale=en";
    const en = await layoutMetadata();
    expect(en.description).toContain("Followers, likes, and views catalog");
    expect((en.title as { default: string }).default).toBe("Axvara Pedia — Affordable social media services");
    expect((en.openGraph as { locale: string }).locale).toBe("en_US");
    expect((en.openGraph as { images: { url: string }[] }).images[0].url).toBe("/brand/pedia-icon-512.png");
  });

  it("halaman: title/description EN, canonical tetap sama seperti ID", async () => {
    const cases = [
      [catalogMetadata, "/layanan", "Katalog layanan", "Service catalog"],
      [helpMetadata, "/bantuan", "Bantuan & cara order", "Help & how to order"],
      [termsMetadata, "/ketentuan", "Ketentuan layanan", "Service terms"],
      [trackMetadata, "/lacak", "Lacak pesanan", "Track order"],
      [refillMetadata, "/refill", "Refill pesanan", "Order refill"],
    ] as const;
    for (const [generate, canonical, idTitle, enTitle] of cases) {
      cookieState.value = "";
      const id = await generate();
      expect(id.title).toBe(idTitle);
      expect(id.alternates?.canonical).toBe(canonical);
      cookieState.value = "axv_locale=en";
      const en = await generate();
      expect(en.title).toBe(enTitle);
      expect(en.alternates?.canonical).toBe(canonical);
      expect((en.openGraph as { locale: string }).locale).toBe("en_US");
    }
  });

  it("halaman order/platform: metadata lokal tanpa menambah canonical", async () => {
    cookieState.value = "axv_locale=en";
    for (const generate of [orderMetadata, productMetadata, platformMetadata]) {
      const meta = await generate();
      expect(meta.title).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.alternates?.canonical).toBeUndefined();
      expect((meta.openGraph as { locale: string }).locale).toBe("en_US");
    }
    cookieState.value = "";
    const id = await orderMetadata();
    expect(id.title).toBe("Pesan layanan");
    expect((id.openGraph as { locale: string }).locale).toBe("id_ID");
  });
});
