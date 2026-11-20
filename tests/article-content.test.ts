// tests/article-content.test.ts — Audit AU-H2-6 + AU-H2-12 (21 Nov 2026).
//
// excerptFromMarkdown() dulu stringify seluruh dokumen TipTap lalu menghapus
// tanda baca — hasilnya excerpt publik berisi kunci JSON mentah
// ("type paragraph content type text …"). Sekarang hanya `node.text` diambil.
// isSafeMarkdown() kini juga menolak gambar dengan attrs.src di luar R2 artikel.
import { describe, expect, it } from "vitest";
import { excerptFromMarkdown, isSafeMarkdown } from "@/lib/articles";

const doc = (content: unknown[]) => JSON.stringify({ type: "doc", content });

describe("AU-H2-6 — excerpt FromMarkdown extracts TipTap text, never JSON keys", () => {
  it("single paragraph: only the visible text", () => {
    const json = doc([{ type: "paragraph", content: [{ type: "text", text: "Halo dunia ini artikel AXVARA." }] }]);
    expect(excerptFromMarkdown(json)).toBe("Halo dunia ini artikel AXVARA.");
  });

  it("multi-block: paragraphs and headings separated by spaces, keys absent", () => {
    const json = doc([
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Judul" }] },
      { type: "paragraph", content: [{ type: "text", text: "Paragraf pertama" }, { type: "text", marks: [{ type: "bold" }], text: " tebal" }] },
      { type: "paragraph", content: [{ type: "text", text: "Paragraf kedua" }] },
    ]);
    const out = excerptFromMarkdown(json);
    expect(out).toBe("Judul Paragraf pertama tebal Paragraf kedua");
    for (const key of ["type", "paragraph", "content", "marks", "attrs"]) {
      expect(out, key).not.toContain(key);
    }
  });

  it("list items keep their text; hardBreak becomes a space", () => {
    const json = doc([
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Satu" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Dua" }] }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "A" }, { type: "hardBreak" }, { type: "text", text: "B" }] },
    ]);
    expect(excerptFromMarkdown(json)).toBe("Satu Dua A B");
  });

  it("truncates to at most 160 chars with an ellipsis", () => {
    const json = doc([{ type: "paragraph", content: [{ type: "text", text: "x".repeat(400) }] }]);
    const out = excerptFromMarkdown(json);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });

  it("legacy markdown still works unchanged", () => {
    expect(excerptFromMarkdown("## Judul\n\nParagraf pertama yang berguna.")).toBe("Paragraf pertama yang berguna.");
  });
});

describe("AU-H2-12 — isSafeMarkdown validates image src", () => {
  it("accepts an image from the article R2 uploader", () => {
    const json = doc([{ type: "image", attrs: { src: "/r2/articles/content/foto.webp", alt: "foto" } }]);
    expect(isSafeMarkdown(json)).toBe(true);
  });

  it.each([
    "https://evil.example/x.png",
    "http://cdn.vendor.com/x.png",
    "data:image/png;base64,AAAA",
    "//evil.example/x.png",
    "",
  ])("rejects image src %j", (src) => {
    const json = doc([{ type: "image", attrs: { src } }]);
    expect(isSafeMarkdown(json)).toBe(false);
  });
});
