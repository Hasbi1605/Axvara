import { expect, it } from "vitest";
import postcss from "postcss";
import tailwind from "tailwindcss";
import config from "../tailwind.config";

it("adds shadcn animations without discarding storefront arbitrary transition durations", async () => {
  const result = await postcss([tailwind({ ...config, content: [{ raw: '<div class="duration-[160ms] duration-[220ms] animate-in fade-in-0 bg-admin-card ring-admin-ring border-admin-input" />' }] })]).process("@tailwind utilities;", { from: undefined });
  expect(result.css).toContain("transition-duration: 160ms");
  expect(result.css).toContain("transition-duration: 220ms");
  expect(result.css).toContain("animation-name: enter");
  expect(result.css).toContain("--admin-ring");
  expect(result.css).toContain("--admin-input");
  expect(result.warnings()).toEqual([]);
});
