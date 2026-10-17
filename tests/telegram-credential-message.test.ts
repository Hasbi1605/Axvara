// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { credentialMessages } from "@/lib/telegram/messages/credential";
import { deliveryMessage } from "@/lib/telegram/messages";
import { marketWarrantyClaim } from "@/lib/warranty-policy";
import type { VariantCopy } from "@/lib/product-copy/format";

const copy: VariantCopy = {
  source: "admin",
  sections: [{ kind: "aturan", items: ["Jangan mengganti password <akun> & email."] }],
  activation: [{ title: "Login pertama", steps: ["Buka aplikasi resmi.", "Masukkan email dan password."] }],
  notes: ["Simpan invoice."],
};

describe("pesan kredensial Telegram dengan panduan pasca-bayar", () => {
  it("menempatkan tiga bagian sesudah kredensial, memakai copy produk dan kebijakan bersama", () => {
    const messages = credentialMessages({ plaintext: "buyer@mail.test|p<ass&", orderCode: "AXV-TEST", productName: "Produk <Premium>", copy });
    expect(messages).toHaveLength(1);
    const html = messages[0];
    expect(html).toContain("<pre>buyer@mail.test|p&lt;ass&amp;</pre>");
    expect(html.indexOf("Syarat &amp; Ketentuan")).toBeGreaterThan(html.indexOf("</pre>"));
    expect(html.indexOf("Cara Penggunaan / Aktivasi")).toBeGreaterThan(html.indexOf("Syarat &amp; Ketentuan"));
    expect(html.indexOf("Syarat klaim garansi")).toBeGreaterThan(html.indexOf("Cara Penggunaan / Aktivasi"));
    expect(html).toContain("Jangan mengganti password &lt;akun&gt; &amp; email.");
    expect(html).toContain("1. Buka aplikasi resmi.");
    expect(html).toContain("2. Masukkan email dan password.");
    for (const line of [marketWarrantyClaim.eligibility, ...marketWarrantyClaim.requirements, ...marketWarrantyClaim.notes]) {
      expect(html).toContain(line);
    }
    expect(html).not.toContain("Refund tidak berlaku");
  });

  it("copy kosong tetap menjelaskan klaim dan meminta panduan admin tanpa mengarang aturan produk", () => {
    const html = credentialMessages({ plaintext: "SECRET" }).join("\n");
    expect(html).toContain("Syarat &amp; Ketentuan");
    expect(html).toContain("Ikuti ketentuan pada deskripsi produk");
    expect(html).toContain("Cara Penggunaan / Aktivasi");
    expect(html).toContain("Panduan khusus belum tersedia");
    expect(html).toContain("/bantuan");
    expect(html).toContain(marketWarrantyClaim.eligibility);
    expect(html).not.toContain("Jangan mengganti password");
  });

  it.each(["pre", "code"] as const)("pesan panjang %s mempertahankan kredensial, Unicode dan HTML valid di setiap bagian", secretTag => {
    const plaintext = 'a<&>"🔐\n'.repeat(1500);
    const messages = credentialMessages({
      plaintext, secretTag, orderCode: "AXV-LONG", productName: 'A<&>"'.repeat(50),
      copy: { ...copy, sections: [{ kind: "aturan", items: ["ATURAN<&>😀".repeat(1500)] }] },
    });
    expect(messages.length).toBeGreaterThan(2);
    const secrets: string[] = [];
    const rules: string[] = [];
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(4096);
      expect(message).toContain("AXV-LONG");
      const document = new DOMParser().parseFromString(`<body>${message}</body>`, "text/html");
      const credentialNodes = [...document.querySelectorAll(secretTag)];
      // Every continuation repeats the order identity in its own code tag.
      secrets.push(...(secretTag === "code" ? credentialNodes.slice(1) : credentialNodes).map(node => node.textContent ?? ""));
      expect(document.querySelectorAll("script, img, a")).toHaveLength(0);
      for (const tag of ["pre", "code", "b", "i"]) {
        expect((message.match(new RegExp(`<${tag}>`, "g")) ?? []).length)
          .toBe((message.match(new RegExp(`</${tag}>`, "g")) ?? []).length);
      }
      rules.push(document.body.textContent ?? "");
    }
    expect(secrets.join("")).toBe(plaintext);
    expect(rules.join("")).toContain("ATURAN<&>😀".repeat(100));
    expect(messages.join("\n")).toContain(marketWarrantyClaim.notes[1]);
  });

  it("format stok sendiri tetap memiliki hint salin dan tidak menyebut larangan refund lama", () => {
    const html = deliveryMessage("account:password");
    expect(html).toContain("<code>account:password</code>");
    expect(html).toContain("Tap untuk copy");
    expect(html).toContain(marketWarrantyClaim.notes[1]);
    expect(html).not.toContain("Refund tidak berlaku");
  });
});
