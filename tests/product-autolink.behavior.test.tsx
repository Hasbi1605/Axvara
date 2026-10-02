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
});

describe("RichText + 3 badan PDP — link bisa diklik", () => {
  it("langkah aktivasi berisi mailbox + tutorial: dua-duanya <a> _blank noreferrer", () => {
    render(
      <ActivationBody
        groups={[
          {
            title: "Ambil kode akses",
            steps: [
              "Buka netflix-codes.sekalipay.com/mailbox untuk kode akses dan PIN",
              "Panduan login lengkap: /artikel/cara-login-netflix-setelah-order-di-axvara",
            ],
          },
        ]}
        notes={["Tutorial https://www.youtube.com/watch?v=fBOfOmj9Uj8"]}
      />,
    );
    const mailbox = screen.getByRole("link", { name: "netflix-codes.sekalipay.com/mailbox" });
    expect(mailbox.getAttribute("href")).toBe("https://netflix-codes.sekalipay.com/mailbox");
    expect(mailbox.getAttribute("target")).toBe("_blank");
    expect(mailbox.getAttribute("rel")).toBe("noreferrer");
    const tutorial = screen.getByRole("link", { name: "https://www.youtube.com/watch?v=fBOfOmj9Uj8" });
    expect(tutorial.getAttribute("href")).toBe("https://www.youtube.com/watch?v=fBOfOmj9Uj8");
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
