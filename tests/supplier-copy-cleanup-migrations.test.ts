import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseAdminVariantCopy, parseProductDescription } from "@/lib/product-copy/format";
import { createD1Fixture } from "./helpers/d1-fixture";

const M0146 = readFileSync("drizzle/migrations/0146_aivault_duolingo_copy.sql", "utf8");
const M0147 = readFileSync("drizzle/migrations/0147_tunvn_archive_duplicate_118.sql", "utf8");
const AUTO = "Duolingo Super. Pilih varian sesuai kebutuhan; garansi mengikuti varian. Stok dan harga dapat berubah.";

it("0146 fills Duolingo AIVault copy only over defaults/empty fields and is idempotent", () => {
  const { sql, close } = createD1Fixture();
  try {
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,aivault_family,description) VALUES
      (1,'Duolingo Super','duolingo-super-av',0,0,'duolingo','${AUTO}'),
      (2,'Owner','owner-av',0,0,'service:service_duolingo_12m','Admin copy');
      INSERT INTO product_variants(product_id,sku,label,price,is_active,aivault_service_id,admin_terms) VALUES
      (1,'AV-service_duolingo_12m','Super 12 Bulan',0,0,'service_duolingo_12m',NULL),
      (2,'AV-x','x',0,0,NULL,'Admin terms');`);
    sql.exec(M0146); sql.exec(M0146);
    const p = sql.prepare("SELECT id,description,description_en FROM products ORDER BY id").all() as { id: number; description: string; description_en: string | null }[];
    expect(p[0].description).toMatch(/^Link redeem resmi Duolingo Super 12 bulan/);
    expect(p[0].description).toContain("Garansi hold link 5 hari");
    expect(p[0].description_en).toMatch(/^Official 12-month Duolingo Super redeem link/);
    expect(p[1].description).toBe("Admin copy");
    const v = sql.prepare("SELECT admin_terms,admin_terms_en FROM product_variants ORDER BY id").all() as { admin_terms: string; admin_terms_en: string }[];
    expect(v[0].admin_terms).toContain("Garansi hold link 5 hari sejak pembelian");
    expect(v[0].admin_terms_en).toContain("5-day link hold warranty");
    expect(v[1].admin_terms).toBe("Admin terms");
  } finally { close(); }
});

it("0147 archives only the inactive TUNVN #118 duplicate whose mirror is gone", () => {
  const { sql, close } = createD1Fixture();
  try {
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,tunvn_family) VALUES
      (51944,'MUSE AI 1B - GMAIL (W2D)','muse-ai-1b-gmail-w2d-tunvn',4700,0,'p118'),
      (112,'Muse AI','muse-ai-1-miliar-token',0,1,NULL);
      INSERT INTO product_variants(product_id,sku,label,price,is_active) VALUES
      (51944,'TUNVN-118','MUSE AI 1B - GMAIL (W2D)',4700,0), (112,'TUNVN-111','Akun 1B Token (garansi 2 hari)',4700,1);
      INSERT INTO tunvn_products(supplier_product_id,name,stock,visible,axvara_product_id) VALUES
      (118,'MUSE AI 1B - GMAIL (W2D)',0,0,51944), (111,'MUSE AI 1B - GMAIL (W2D)',187,1,112);`);
    sql.exec(M0147); sql.exec(M0147);
    expect(sql.prepare("SELECT id,is_active,archived_at IS NOT NULL arch FROM products ORDER BY id").all())
      .toEqual([{ id: 112, is_active: 1, arch: 0 }, { id: 51944, is_active: 0, arch: 1 }]);
    expect(sql.prepare("SELECT sku,is_active FROM product_variants WHERE sku='TUNVN-111'").get()).toEqual({ sku: "TUNVN-111", is_active: 1 });
  } finally { close(); }
});

it("0147 leaves #118 alone if the supplier relists it with stock", () => {
  const { sql, close } = createD1Fixture();
  try {
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,tunvn_family) VALUES (51944,'MUSE','muse-ai-1b-gmail-w2d-tunvn',4700,0,'p118');
      INSERT INTO tunvn_products(supplier_product_id,name,stock,visible,axvara_product_id) VALUES (118,'MUSE',5,0,51944);`);
    sql.exec(M0147);
    expect(sql.prepare("SELECT archived_at FROM products WHERE id=51944").get()).toEqual({ archived_at: null });
  } finally { close(); }
});

it("0148 rewrites only TUNVN-111 Muse 1B copy to the Gmail + 2FA format and adds the guide shortlink", () => {
  const { sql, close } = createD1Fixture();
  try {
    const m = readFileSync("drizzle/migrations/0148_tunvn_muse_1b_gmail_copy.sql", "utf8");
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,description) VALUES (112,'Muse AI','muse-ai-1-miliar-token',0,1,'Owner copy');
      INSERT INTO product_variants(product_id,sku,label,price,is_active,admin_terms,admin_activation) VALUES
      (112,'TUNVN-111','Akun 1B Token (garansi 2 hari)',4700,1,'Hotmail API mail','old'),
      (112,'TUNVN-97','Akun 1B Token (tanpa garansi)',3000,1,'Keep','Keep');`);
    sql.exec(m); sql.exec(m);
    const v = sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='TUNVN-111'").get() as Record<string, string>;
    expect(v.admin_terms).toContain("Format: Email | Password | Kode 2FA");
    expect(v.admin_terms).toContain("Garansi 2 hari");
    expect(Object.values(v).join("\n")).not.toMatch(/Hotmail|API mail|mail-dongvan/);
    expect(v.admin_activation).toContain("axvara.tech/go/otp-2fa");
    expect(v.admin_activation_en).toContain("axvara.tech/go/muse-login-gmail");
    expect(sql.prepare("SELECT admin_terms FROM product_variants WHERE sku='TUNVN-97'").get()).toEqual({ admin_terms: "Keep" });
    const p = sql.prepare("SELECT description,description_en FROM products WHERE id=112").get() as { description: string; description_en: string };
    expect(p.description).toMatch(/^AI agent otonom dari Meta/);
    expect(p.description.split("\n").filter(l => l.startsWith("- ")).length).toBe(5);
    expect(p.description.length).toBeLessThan(500);
    expect(p.description_en).toMatch(/^Autonomous AI agent from Meta/);
    expect(sql.prepare("SELECT destination FROM supplier_links WHERE slug='muse-login-gmail'").get())
      .toEqual({ destination: "https://drive.google.com/file/d/1v95Q95v2jB8LkWLwQlw3WTwO7U3Ma2d4/view?usp=drivesdk" });
  } finally { close(); }
});

it("0149 rewrites #112/#97/#98 Muse copy and leaves #114 mailbox copy untouched", () => {
  const { sql, close } = createD1Fixture();
  try {
    const m = readFileSync("drizzle/migrations/0149_tunvn_muse_other_variants_copy.sql", "utf8");
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active) VALUES (112,'Muse AI','muse-ai-1-miliar-token',0,1);
      INSERT INTO product_variants(product_id,sku,label,price,is_active,admin_terms,admin_activation) VALUES
      (112,'TUNVN-112','31B W2D',19600,1,'Hotmail API mail','mail-dongvan'),
      (112,'TUNVN-97','1B NW',3000,1,'Link baca mailbox','old'),
      (112,'TUNVN-98','31B NW',9400,1,'Link baca mailbox','old'),
      (112,'TUNVN-114','25-28B NW',12200,1,'Keep mailbox','Keep');`);
    sql.exec(m); sql.exec(m);
    const get = (sku: string) => sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku=?").get(sku) as Record<string, string>;
    const w2d = get("TUNVN-112");
    expect(w2d.admin_terms).toContain("31 miliar token berbasis Gmail");
    expect(w2d.admin_terms).toContain("Format: Email | Password | Kode 2FA");
    for (const sku of ["TUNVN-97", "TUNVN-98"]) {
      const v = get(sku);
      expect(v.admin_terms).toContain("Format: Email | Password");
      expect(v.admin_terms).toContain("Tanpa garansi");
      expect(v.admin_activation).toContain("axvara.tech/go/otp-2fa");
      expect(v.admin_activation_en).toContain("axvara.tech/go/muse-login-gmail");
    }
    for (const sku of ["TUNVN-112", "TUNVN-97", "TUNVN-98"]) expect(Object.values(get(sku)).join("\n")).not.toMatch(/Hotmail|API mail|mail-dongvan|mailbox/);
    expect(get("TUNVN-114").admin_terms).toBe("Keep mailbox");
  } finally { close(); }
});

it("0160 populates Microsoft Copilot Premium (#122) ID/EN description, terms, and activation on live product without overwriting admin edits", () => {
  const { sql, close } = createD1Fixture();
  try {
    const m = readFileSync("drizzle/migrations/0160_tunvn_copilot_copy.sql", "utf8");
    sql.exec(`INSERT INTO products(id,category_id,name,slug,price,stock,is_active,tunvn_family,description,description_en) VALUES
      (51959,1,'Microsoft Copilot Premium','microsoft-copilot-tunvn',18000,9,1,'microsoft-copilot',
       'Akses Microsoft Copilot Premium selama 1 bulan. Paket ini termasuk garansi penuh selama masa aktif.',
       'Get Microsoft Copilot Premium for 1 month. This plan includes full warranty coverage throughout the subscription period.');
      INSERT INTO product_variants(product_id,sku,label,price,stock,is_active,tunvn_source_product_id) VALUES
      (51959,'TUNVN-122','Premium 1 Bulan (Full Garansi)',18000,9,1,122);`);
    sql.exec(m);
    const changesAfterFirst = (sql.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    sql.exec(m);
    expect((sql.prepare("SELECT total_changes() AS n").get() as { n: number }).n).toBe(changesAfterFirst);

    const p = sql.prepare("SELECT description,description_en FROM products WHERE id=51959").get() as { description: string; description_en: string };
    const parsedId = parseProductDescription(p.description);
    const parsedEn = parseProductDescription(p.description_en);
    expect(parsedId.blocks.map(b => b.type)).toEqual(["p", "list"]);
    expect(parsedEn.blocks.map(b => b.type)).toEqual(["p", "list"]);
    expect(p.description).toContain("Microsoft Copilot Premium");
    expect(p.description_en).toContain("Microsoft Copilot Premium");

    const v = sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='TUNVN-122'").get() as Record<string, string>;
    const copyId = parseAdminVariantCopy(v.admin_terms, v.admin_activation)!;
    const copyEn = parseAdminVariantCopy(v.admin_terms_en, v.admin_activation_en)!;
    expect(copyId.sections.map(s => s.kind)).toEqual(["paket", "proses", "garansi"]);
    expect(copyEn.sections.map(s => s.kind)).toEqual(["paket", "proses", "garansi"]);
    expect(copyId.activation[0].steps).toHaveLength(3);
    expect(copyEn.activation[0].steps).toHaveLength(3);
    expect(copyId.notes).toHaveLength(2);
    expect(copyEn.notes).toHaveLength(2);
    expect(v.admin_terms).toContain("5 bagian");
    expect(v.admin_terms_en).toContain("5 parts");
    expect(v.admin_activation).toContain("axvara.tech/go/mail-fvia");
    expect(v.admin_activation).toContain("axvara.tech/go/mail-dongvan");
    expect(v.admin_activation_en).toContain("axvara.tech/go/mail-fvia");
    expect(v.admin_activation_en).toContain("axvara.tech/go/mail-dongvan");

    // No raw supplier URLs or supplier brand leaked in buyer copy
    const allCopy = [p.description, p.description_en, v.admin_terms, v.admin_terms_en, v.admin_activation, v.admin_activation_en].join("\n");
    for (const forbidden of ["fviainboxes.com", "dongvanfb.net", "https://", "TUNVN", "tunvn"]) {
      expect(allCopy).not.toContain(forbidden);
    }
    const slugs = (sql.prepare("SELECT slug FROM supplier_links WHERE slug IN ('mail-fvia','mail-dongvan') AND is_active=1").all() as { slug: string }[]).map(r => r.slug).sort();
    expect(slugs).toEqual(["mail-dongvan", "mail-fvia"]);

    // Admin edits made later survive rerun
    sql.exec(`UPDATE products SET description='Edit admin ID', description_en='Edit admin EN' WHERE id=51959;
      UPDATE product_variants SET admin_terms='S&K admin', admin_terms_en='Admin terms' WHERE sku='TUNVN-122';`);
    sql.exec(m);
    expect(sql.prepare("SELECT description,description_en FROM products WHERE id=51959").get()).toEqual({ description: "Edit admin ID", description_en: "Edit admin EN" });
    expect(sql.prepare("SELECT admin_terms,admin_terms_en FROM product_variants WHERE sku='TUNVN-122'").get()).toEqual({ admin_terms: "S&K admin", admin_terms_en: "Admin terms" });
  } finally { close(); }
});
