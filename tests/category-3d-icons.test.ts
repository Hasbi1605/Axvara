import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CATEGORY_3D_ICONS, category3dIcon } from "@/lib/category-3d-icons";

it("every custom category icon is a local existing asset", () => {
  for (const [slug, icon] of Object.entries(CATEGORY_3D_ICONS)) {
    expect(icon.src).toBe(`/brand/catalog/category-3d/${slug}.webp`);
    expect(existsSync(join(process.cwd(), "public", icon.src)), slug).toBe(true);
  }
});
it("new/unmapped categories use the glyph fallback", () => {
  expect(category3dIcon("new-category")).toBeUndefined();
  expect(category3dIcon("constructor")).toBeUndefined();
});
