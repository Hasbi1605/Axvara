// tests/supplier-links-route.test.ts — Route /go/[slug] + API admin CRUD.
//
// Route: 307 ke destination + hitung klik; 404 bila slug tak ada / nonaktif /
// format salah. API: auth admin + validasi slug/reserved/destination + toggle.
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { NextRequest } from "next/server";
import { createD1Fixture } from "./helpers/d1-fixture";

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn(async () => ({ email: "fixture@example.test" })) }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function seedLinks(fx: ReturnType<typeof createD1Fixture>) {
  // Schema fixture SUDAH seed 43 slug prod (otp, netflix-login, ...).
  // Tambah yang belum ada saja: contoh nonaktif untuk uji 404.
  fx.sql.prepare(`INSERT OR IGNORE INTO supplier_links (slug, destination, title, is_active) VALUES (?,?,?,?)`).run(
    "uji-mati", "https://example.com/", "Uji mati", 0,
  );
}

describe("GET /go/[slug] — redirect 307 + klik", () => {
  it("slug aktif → redirect destination + click_count +1", async () => {
    const fx = createD1Fixture();
    try {
      seedLinks(fx);
      const { default: GoRedirect } = await import("@/app/(shop)/go/[slug]/page");
      const before = fx.sql.prepare(`SELECT click_count FROM supplier_links WHERE slug='otp'`).get() as { click_count: number };
      // next/navigation redirect() melempar NEXT_REDIRECT — tangkap digest-nya.
      let digest = "";
      try {
        await GoRedirect({ params: Promise.resolve({ slug: "otp" }) });
      } catch (error) {
        digest = String((error as Error & { digest?: string }).digest ?? error);
      }
      expect(digest).toContain("https://netflix-codes.sekalipay.com/mailbox");
      expect(digest).toContain("307");
      const after = fx.sql.prepare(`SELECT click_count, last_clicked_at FROM supplier_links WHERE slug='otp'`).get() as {
        click_count: number;
        last_clicked_at: string;
      };
      expect(after.click_count).toBe(before.click_count + 1);
      expect(after.last_clicked_at).toBeTruthy();
    } finally {
      fx.close();
    }
  });

  it("slug tak ada / nonaktif / format salah → 404", async () => {
    const fx = createD1Fixture();
    try {
      seedLinks(fx);
      const { notFound } = await import("next/navigation");
      expect(notFound).toBeDefined();
      const { default: GoRedirect } = await import("@/app/(shop)/go/[slug]/page");
      // Format salah (../..) → notFound melempar NEXT_HTTP_ERROR_FALLBACK;404.
      let code = "";
      try {
        await GoRedirect({ params: Promise.resolve({ slug: "../x" }) });
      } catch (error) {
        code = String((error as Error & { digest?: string }).digest ?? error);
      }
      expect(code).toContain("404");
      // Nonaktif → 404 juga (tidak bocor destination).
      let code2 = "";
      try {
        await GoRedirect({ params: Promise.resolve({ slug: "uji-mati" }) });
      } catch (error) {
        code2 = String((error as Error & { digest?: string }).digest ?? error);
      }
      expect(code2).toContain("404");
    } finally {
      fx.close();
    }
  });

  it("migrasi 0071: prod yang 0056-nya sudah terlanjur diterapkan tetap dapat disney-login (anti-tinggal, kasus 2026-10-19)", async () => {
    // Simulasi D1 produksi: migrasi 0056 versi LAMA (tanpa disney-login)
    // sudah tercatat diterapkan — edit file lama tidak dijalankan ulang CI.
    const fx = createD1Fixture();
    try {
      fx.sql.prepare(`DELETE FROM supplier_links WHERE slug='disney-login'`).run();
      expect(
        fx.sql.prepare(`SELECT slug FROM supplier_links WHERE slug='disney-login'`).get(),
      ).toBeUndefined();
      // Migrasi BARU wajib seed + idempoten.
      const migration = fs.readFileSync("drizzle/migrations/0071_disney_login_shortlink.sql", "utf8");
      fx.sql.exec(migration);
      const row = fx.sql.prepare(
        `SELECT destination, title, is_active FROM supplier_links WHERE slug='disney-login'`,
      ).get() as { destination: string; title: string; is_active: number };
      expect(row.destination).toBe("/artikel/cara-login-disney-setelah-order-di-axvara");
      expect(row.title).toBe("Panduan login Disney+ AXVARA");
      expect(row.is_active).toBe(1);
      fx.sql.exec(migration);
      expect(
        fx.sql.prepare(`SELECT COUNT(*) AS n FROM supplier_links WHERE slug='disney-login'`).get(),
      ).toMatchObject({ n: 1 });
      // Dan route /go/disney-login langsung redirect 307 ke artikel.
      const { default: GoRedirect } = await import("@/app/(shop)/go/[slug]/page");
      let digest = "";
      try {
        await GoRedirect({ params: Promise.resolve({ slug: "disney-login" }) });
      } catch (error) {
        digest = String((error as Error & { digest?: string }).digest ?? error);
      }
      expect(digest).toContain("/artikel/cara-login-disney-setelah-order-di-axvara");
      expect(digest).toContain("307");
    } finally {
      fx.close();
    }
  });
});

describe("API /api/admin/supplier-links — CRUD + validasi", () => {
  const req = (method: string, body?: unknown, query = "") =>
    new NextRequest(`http://localhost/api/admin/supplier-links${query}`, {
      method,
      ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
    });

  it("GET daftar + POST buat + PUT toggle + DELETE hapus", async () => {
    const fx = createD1Fixture();
    try {
      seedLinks(fx);
      const route = await import("@/app/api/admin/supplier-links/route");
      const list = await route.GET(req("GET"));
      expect(list.status).toBe(200);
      const listed = (await list.json()) as { links: { slug: string }[] };
      expect(listed.links.map((l) => l.slug)).toContain("otp");

      // Slug reserved ditolak.
      const reserved = await route.POST(req("POST", { slug: "admin", destination: "https://example.com/" }));
      expect(reserved.status).toBe(400);
      // Destination aneh ditolak.
      const bad = await route.POST(req("POST", { slug: "uji-coba", destination: "javascript:alert(1)" }));
      expect(bad.status).toBe(400);
      // Buat valid.
      const created = await route.POST(req("POST", { slug: "uji-coba", destination: "https://example.com/a", title: "Coba" }));
      expect(created.status).toBe(200);
      // Duplikat → 409.
      const dup = await route.POST(req("POST", { slug: "uji-coba", destination: "https://example.com/b" }));
      expect(dup.status).toBe(409);

      const id = Number((await created.json()).id);
      // Toggle nonaktif.
      const toggled = await route.PUT(req("PUT", { id, is_active: 0 }));
      expect(toggled.status).toBe(200);
      const row = fx.sql.prepare(`SELECT is_active FROM supplier_links WHERE id=?`).get(id) as { is_active: number };
      expect(row.is_active).toBe(0);
      // Hapus.
      const deleted = await route.DELETE(req("DELETE", undefined, `?id=${id}`));
      expect(deleted.status).toBe(200);
      expect(fx.sql.prepare(`SELECT id FROM supplier_links WHERE id=?`).get(id)).toBeUndefined();
    } finally {
      fx.close();
    }
  });

  it("tanpa admin → 401", async () => {
    const { requireAdmin } = await import("@/lib/auth");
    vi.mocked(requireAdmin).mockResolvedValueOnce(null);
    const route = await import("@/app/api/admin/supplier-links/route");
    expect((await route.GET(req("GET"))).status).toBe(401);
  });
});
