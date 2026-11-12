// tests/pedia-managed-fixture.test.ts — PSMM-P5 (2026-11-12).
// Fixture lokal dev (scripts/pedia-managed-fixture.mjs) harus benar-benar
// menghasilkan katalog jual yang aman, sehingga QA browser bisa melihat
// katalog otomatis + panel admin tanpa auth bypass atau panggilan supplier.
import { it, expect } from "vitest";
import { execSync } from "node:child_process";
import { createD1Fixture } from "./helpers/d1-fixture";
import { createDatabaseAccess } from "@/lib/db-access";

it("the local fixture seeds a sellable managed catalog plus visible blocked rows", async () => {
  process.env.PEDIA_ENABLED = "true";
  const sql = execSync("node scripts/pedia-managed-fixture.mjs", { encoding: "utf8" });
  const fx = createD1Fixture();
  try {
    const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
      .split(";").map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      if (/^(BEGIN|COMMIT)$/i.test(stmt)) continue;
      fx.sql.exec(stmt);
    }
    const db = createDatabaseAccess(fx.db);
    // 6 layanan otomatis dibuat; 2 sengaja ditahan (terms_conflict, type_unsupported).
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_products WHERE managed='auto'`)).toMatchObject({ n: 6 });
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto' AND is_active=1`)).toMatchObject({ n: 4 });
    expect(await db.queryFirst(`SELECT COUNT(*) n FROM pedia_tiers WHERE managed='auto' AND is_active=0`)).toMatchObject({ n: 2 });

    const { GET } = await import("@/app/api/pedia/catalog/route");
    const data = await (await GET()).json();
    // Hanya 4 baris layak yang tayang; 2 ditahan tidak muncul.
    expect(data.products).toHaveLength(4);
    expect(data.products.every((p: { slug: string }) => p.slug.startsWith("psmm-dev-"))).toBe(true);
    // White-label + tidak ada kebocoran supplier/ID/biaya.
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/providersmm|Private supplier|supplier_service_id|rate_idr|markup/);
    // Deskripsi resmi tampil.
    expect(json).toContain("Followers masuk bertahap");
    // Contoh URL target dipertahankan.
    expect(json).toContain("https://www.instagram.com/p/CONTOH/");

    // PSMM-ACCEPTANCE-CLOSE 3: setiap baris auto dicap versi snapshot agar lolos
    // gate syarat fail-closed (bukan mengandalikan bypass).
    const stamps = await db.queryAll(`SELECT supplier_service_id, managed_snapshot_at FROM pedia_tiers WHERE managed='auto'`);
    expect(stamps).toHaveLength(6);
    expect(stamps.every((r) => String(r.managed_snapshot_at) === "2026-11-12T10:00:00.000Z")).toBe(true);

    // Semantik target/metrik benar: Likes + Custom Comments = post,
    // TikTok Views = metric views / target video.
    const targets = Object.fromEntries(data.products.map((p: { slug: string; metric: string; target_kind: string }) => [p.slug, `${p.metric}/${p.target_kind}`]));
    expect(targets["psmm-dev-900102"]).toBe("likes/post");
    expect(targets["psmm-dev-900103"]).toBe("comments/post");
    expect(targets["psmm-dev-900104"]).toBe("views/video");
    expect(targets["psmm-dev-900101"]).toBe("followers/profile");
  } finally { fx.close(); }
});
