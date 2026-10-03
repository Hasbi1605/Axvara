// @vitest-environment jsdom
//
// tests/product-autolink.behavior.test.tsx — Link di deskripsi, S&K, dan cara
// aktivasi BISA DIKLIK langsung (permintaan owner 2026-10-03): pembeli tidak
// perlu copy-paste manual. Tanpa dangerouslySetInnerHTML (XSS-safe), pola
// proyek: target _blank + rel noreferrer.
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  ActivationBody,
  DescriptionBody,
  RichText,
  TermsBody,
} from "@/components/storefront/ProductCopy";
import { linkifySegments } from "@/lib/product-copy/text";
import { parseProductDescription } from "@/lib/product-copy/format";

afterEach(() => cleanup());

describe("linkifySegments — pecah teks jadi polos + link", () => {
  it("URL https jadi link penuh", () => {
    const segments = linkifySegments("Tutorial https://www.youtube.com/watch?v=fBOfOmj9Uj8 di sini");
    expect(segments).toEqual([
      { text: "Tutorial ", href: null },
      { text: "https://www.youtube.com/watch?v=fBOfOmj9Uj8", href: "https://www.youtube.com/watch?v=fBOfOmj9Uj8" },
      { text: " di sini", href: null },
    ]);
  });

  it("bare domain (mailbox/OTP/resmi) jadi link https", () => {
    const segments = linkifySegments("Buka netflix-codes.sekalipay.com/mailbox untuk kode");
    expect(segments[1]).toEqual({
      text: "netflix-codes.sekalipay.com/mailbox",
      href: "https://netflix-codes.sekalipay.com/mailbox",
    });
    const www = linkifySegments("Buka www.netflix.com/clearcookies dulu");
    expect(www[1]?.href).toBe("https://www.netflix.com/clearcookies");
    const otp = linkifySegments("Ambil OTP di https://bototp.site/");
    expect(otp[1]?.href).toBe("https://bototp.site/");
  });

  it("handle bot Telegram jadi link t.me", () => {
    const segments = linkifySegments("Buka bot @sekalipayviu_bot di Telegram");
    expect(segments[1]).toEqual({ text: "@sekalipayviu_bot", href: "https://t.me/sekalipayviu_bot" });
  });

  it("email kredensial BUKAN link (user@mail.com tetap teks)", () => {
    const segments = linkifySegments("Login user@mail.com|pass123 ya");
    expect(segments).toEqual([{ text: "Login user@mail.com|pass123 ya", href: null }]);
  });

  it("tanda baca ekor tidak ikut href; teks tanpa link utuh", () => {
    const segments = linkifySegments("Cek https://oliesmail.com/, lalu lanjut.");
    expect(segments[1]).toEqual({ text: "https://oliesmail.com/", href: "https://oliesmail.com/" });
    expect(linkifySegments("Tanpa link sama sekali")).toEqual([{ text: "Tanpa link sama sekali", href: null }]);
  });

  it("skema berbahaya tidak jadi link (javascript:/data: ditolak)", () => {
    expect(linkifySegments("Klik javascript:alert(1) dong")).toEqual([{ text: "Klik javascript:alert(1) dong", href: null }]);
  });

  it("path internal /artikel jadi link relatif (kasus screenshot PDP Netflix)", () => {
    const segments = linkifySegments("Panduan login lengkap: /artikel/cara-login-netflix-setelah-order-di-axvara");
    expect(segments).toEqual([
      { text: "Panduan login lengkap: ", href: null },
      {
        text: "/artikel/cara-login-netflix-setelah-order-di-axvara",
        href: "/artikel/cara-login-netflix-setelah-order-di-axvara",
      },
    ]);
  });

  it("URL axvara.tech/full jadi path internal (navigasi dalam toko)", () => {
    const segments = linkifySegments("Buka https://axvara.tech/artikel/cara-login-netflix-setelah-order-di-axvara ya");
    expect(segments[1]).toEqual({
      text: "https://axvara.tech/artikel/cara-login-netflix-setelah-order-di-axvara",
      href: "/artikel/cara-login-netflix-setelah-order-di-axvara",
    });
    const bare = linkifySegments("Buka axvara.tech/lacak-pesanan ya");
    expect(bare[1]?.href).toBe("/lacak-pesanan");
  });

  it("slash biasa bukan link (tidak ada link palsu)", () => {
    expect(linkifySegments("Login 1/2 perangkat ya")).toEqual([{ text: "Login 1/2 perangkat ya", href: null }]);
    expect(linkifySegments("Pilih 1 / 2 / 3")).toEqual([{ text: "Pilih 1 / 2 / 3", href: null }]);
  });

  it("shortlink go/* (bare + /go + full URL) jadi link internal", () => {
    expect(linkifySegments("Buka axvara.tech/go/otp untuk kode")).toEqual([
      { text: "Buka ", href: null },
      { text: "axvara.tech/go/otp", href: "/go/otp" },
      { text: " untuk kode", href: null },
    ]);
    const slash = linkifySegments("Panduan: /go/netflix-login ya");
    expect(slash[1]).toEqual({ text: "/go/netflix-login", href: "/go/netflix-login" });
    const full = linkifySegments("Buka https://axvara.tech/go/mail-olies ya");
    expect(full[1]).toEqual({ text: "https://axvara.tech/go/mail-olies", href: "/go/mail-olies" });
  });
});

describe("RichText + 3 badan PDP — link bisa diklik", () => {
  it("langkah aktivasi shortlink go/*: internal tanpa _blank; eksternal tetap _blank", () => {
    render(
      <ActivationBody
        groups={[
          {
            title: "Ambil kode akses",
            steps: [
              "Buka axvara.tech/go/otp untuk kode akses dan PIN",
              "Panduan login lengkap: axvara.tech/go/netflix-login",
            ],
          },
        ]}
        notes={["Tutorial https://www.youtube.com/watch?v=fBOfOmj9Uj8"]}
      />,
    );
    // Shortlink internal = navigasi dalam toko: TANPA _blank (tanpa tab baru).
    const mailbox = screen.getByRole("link", { name: "axvara.tech/go/otp" });
    expect(mailbox.getAttribute("href")).toBe("/go/otp");
    expect(mailbox.getAttribute("target")).toBeNull();
    const guide = screen.getByRole("link", { name: "axvara.tech/go/netflix-login" });
    expect(guide.getAttribute("href")).toBe("/go/netflix-login");
    expect(guide.getAttribute("target")).toBeNull();
    const tutorial = screen.getByRole("link", { name: "https://www.youtube.com/watch?v=fBOfOmj9Uj8" });
    expect(tutorial.getAttribute("href")).toBe("https://www.youtube.com/watch?v=fBOfOmj9Uj8");
    expect(tutorial.getAttribute("target")).toBe("_blank");
    expect(tutorial.getAttribute("rel")).toBe("noreferrer");
  });

  it("item S&K berisi bot + URL resmi bisa diklik", () => {
    render(
      <TermsBody
        sections={[
          { kind: "aturan", items: ["Minta OTP ke bot Telegram @autoresetpwspotify_bot setelah login"] },
          { kind: "paket", items: ["Cek ketersediaan nama domain di https://name.com"] },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "@autoresetpwspotify_bot" }).getAttribute("href")).toBe(
      "https://t.me/autoresetpwspotify_bot",
    );
    expect(screen.getByRole("link", { name: "https://name.com" }).getAttribute("href")).toBe("https://name.com/");
  });

  it("paragraf deskripsi berisi link ikut bisa diklik", () => {
    const parsed = parseProductDescription("Website: https://dramaku.world\n\n- Nonton sepuasnya");
    render(<DescriptionBody parsed={parsed} />);
    const link = screen.getByRole("link", { name: "https://dramaku.world" });
    expect(link.getAttribute("href")).toBe("https://dramaku.world/");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("teks tanpa link tidak membuat <a> apa pun (tidak ada link palsu)", () => {
    render(<RichText text="Dilarang mengganti email atau password" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
