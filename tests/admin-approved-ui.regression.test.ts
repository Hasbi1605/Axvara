// Perubahan panel admin yang disetujui owner 2026-09-20 (butir 1/1b/3/4 di
// issue/audit-admin-panel-2026-09-19.md). Guard ini menjaga tiga hal yang
// mudah rusak diam-diam saat refactor berikutnya.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("butir 4 — metrik Pesanan mengikuti filter", () => {
  it("query stats memakai WHERE yang sama dengan daftar", () => {
    const api = read("src/app/api/admin/orders/route.ts");
    // Dulu: `FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code`
    // TANPA ${where} — memfilter ke Pending tetap menampilkan total seluruh toko.
    const statsQuery = api.slice(api.indexOf("SELECT COUNT(*) AS total"), api.indexOf("counts: {"));
    expect(statsQuery).toContain("${where}");
  });

  it("tab kanal tetap global agar 'Semua' tidak ikut terfilter", () => {
    const manager = read("src/components/admin/OrdersManager.tsx");
    // stats.total kini terfilter, jadi "Semua" WAJIB dihitung dari counts kanal.
    expect(manager).toContain("const channelTotal =");
    expect(manager).not.toContain('["all", "Semua", stats.total');
  });

  it("kartu metrik menandai dirinya saat filter aktif", () => {
    expect(read("src/components/admin/OrdersManager.tsx")).toContain("hasil filter");
  });
});

describe("butir 1/1b — modal produk bertab dengan Simpan sticky", () => {
  const modal = read("src/components/admin/ProductEditorModal.tsx");

  it("punya tab Produk/Varian/Foto", () => {
    expect(modal).toContain('role="tablist"');
    expect(modal).toContain('["detail", "Produk"]');
    expect(modal).toContain('["varian", "Varian"]');
    expect(modal).toContain('["media", "Foto"]');
  });

  it("footer Simpan di luar area scroll (shrink-0, bukan ikut mt-6 di dalam konten)", () => {
    // Panel = flex column; hanya badan yang overflow-y-auto. Kalau footer ikut
    // ter-scroll, tombol Simpan kembali 2597px di bawah area kerja.
    expect(modal).toContain("flex max-h-[92dvh]");
    expect(modal).toContain("min-h-0 flex-1 overflow-y-auto");
    const footer = modal.slice(modal.indexOf("Simpan Produk") - 900, modal.indexOf("Simpan Produk"));
    expect(footer).toContain("shrink-0");
  });
});

describe("butir 3 — Integrasi Agent & Subscriber Email jadi tab Pengaturan", () => {
  it("keduanya tidak lagi punya entri sidebar", () => {
    const shell = read("src/components/admin/AdminShell.tsx");
    expect(shell).not.toContain('["agent", "Integrasi Agent"');
    expect(shell).not.toContain('["subscribers", "Subscriber Email"');
  });

  it("section lama tetap sah agar tautan/bookmark tidak mati", () => {
    const shell = read("src/components/admin/AdminShell.tsx");
    const page = read("src/app/admin/page.tsx");
    expect(shell).toContain('"subscribers"');
    expect(shell).toContain('"agent"');
    // ADMIN_SECTIONS masih menerima keduanya sebagai ?section= yang valid.
    expect(page).toContain('"subscribers"');
    expect(page).toContain('"agent"');
  });

  it("header mobile punya judul fallback untuk section tanpa entri sidebar", () => {
    // Tanpa ini ?section=agent dari tautan lama menampilkan judul kosong.
    expect(read("src/components/admin/AdminShell.tsx")).toContain("sectionFallbackTitles");
  });
});
