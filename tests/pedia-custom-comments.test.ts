import { describe, expect, it } from "vitest";
import { checkCustomComments, parseCustomComments, pediaServiceTypeFor } from "@/lib/pedia/custom-comments";

describe("Pedia custom comments", () => {
  it("parses one comment per line and validates limits and count", () => {
    expect(parseCustomComments(" a \r\n\r\nb\u0007c\n")).toEqual(["a", "b c"]);
    expect(checkCustomComments("", 1)).toMatchObject({ ok: false, error: expect.stringContaining("satu komentar per baris") });
    expect(checkCustomComments("a\nb", 3)).toMatchObject({ ok: false, error: "Jumlah komentar (2) harus sama dengan jumlah pesanan (3)." });
    expect(checkCustomComments("x".repeat(301), 1)).toMatchObject({ ok: false, error: expect.stringContaining("baris 1 terlalu panjang") });
    expect(checkCustomComments(Array(201).fill("a").join("\n"), 201)).toMatchObject({ ok: false, error: "Maksimal 200 komentar per pesanan." });
    expect(checkCustomComments("y".repeat(8001), 1).ok).toBe(false);
    expect(checkCustomComments("a\nb", 2)).toEqual({ ok: true, lines: ["a", "b"] });
  });
  it("maps tier input kind to the only allowed supplier service type", () => {
    expect(pediaServiceTypeFor("comments")).toBe("Custom Comments");
    expect(pediaServiceTypeFor(null)).toBe("Default");
  });
});
