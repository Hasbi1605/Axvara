// Panel admin harus memakai ConfirmDialog/toast bertema, bukan dialog OS.
// Dialog bawaan browser (confirm/alert) muncul putih-abu di tengah panel
// gelap dan tidak bisa dibatalkan dengan gaya yang sama — inilah salah satu
// sumber kesan "tidak serasi" pada laporan owner 2026-09-19.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

const ADMIN_FILES = [
  "src/components/admin/CategoryManager.tsx",
  "src/components/admin/BannerManager.tsx",
  "src/components/admin/ArticlesManager.tsx",
  "src/components/admin/ArticleEditor.tsx",
  "src/components/admin/ImageDropzone.tsx",
];

describe("dialog admin", () => {
  it.each(ADMIN_FILES)("%s tidak memakai confirm()/alert() bawaan browser", (file) => {
    const source = read(file);
    expect(source).not.toMatch(/(?<![\w.])(window\.)?confirm\s*\(/);
    expect(source).not.toMatch(/(?<![\w.])(window\.)?alert\s*\(/);
  });

  it.each([
    "src/components/admin/CategoryManager.tsx",
    "src/components/admin/BannerManager.tsx",
    "src/components/admin/ArticlesManager.tsx",
  ])("%s memakai ConfirmDialog untuk hapus", (file) => {
    expect(read(file)).toContain("<ConfirmDialog");
  });

  it("modal kategori delegates focus/inert and scroll-lock to Radix with busy guards", () => {
    const source = read("src/components/admin/CategoryManager.tsx");
    expect(source).toContain('<Dialog title={editing ? "Edit Kategori" : "Kategori Baru"}');
    const primitive = read("src/components/ui/Dialog.tsx");
    expect(primitive).toContain("<DialogContent");
    expect(primitive).toContain("onEscapeKeyDown=");
    expect(primitive).toContain("onInteractOutside=");
    expect(primitive).toContain("previousFocus.current.focus()");
    expect(read("src/components/admin/ui/dialog.tsx")).toContain('from "@radix-ui/react-dialog"');
  });
});
