import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { aivaultDefaultDescription, aivaultFamily } from "@/lib/aivault/families";
import { storebatDefaultDescription, storebatFamily } from "@/lib/storebat/families";
import { tunvnDefaultDescription, tunvnFamilyForSupplierId } from "@/lib/tunvn/families";
import { createD1Fixture } from "./helpers/d1-fixture";

const migration = readFileSync("drizzle/migrations/0158_supplier_catalog_tidy_1123.sql", "utf8");
const unedImage = "/r2/products/c204df6e033ebd2e9f018f51e76f1a5e.webp";
const langsmithImage = "/r2/products/9b461c09788050b6a28e42060cbbcffc.webp";
const copilotImage = "/r2/products/a1701a94b1f47ce83ffd1c1527fb9c89.webp";
const pdfSlug = "ilovepdf-premium-1-year-1d779655-av";
let fixture: ReturnType<typeof createD1Fixture>;

beforeEach(() => { fixture = createD1Fixture(); });
afterEach(() => fixture.close());

it("maps AIVault warranty, iLovePDF and UNED to their canonical product URLs", () => {
  expect(aivaultFamily("service_chatgpt_plus_1m_fw", "feed")).toMatchObject({ key: "chatgpt-plus", slug: "chatgpt-plus-av", label: "Plus 1 Bulan (Full Garansi)" });
  expect(aivaultFamily("service_ilovepdf_1y", "feed")).toMatchObject({ key: "ilovepdf", slug: pdfSlug, name: "iLovePDF Premium", label: "Premium 1 Tahun" });
  expect(aivaultFamily("service_ilovepdf_nw", "feed")).toMatchObject({ key: "ilovepdf", slug: pdfSlug, label: "Premium (Tanpa Garansi)" });
  expect(aivaultFamily("service_uned_mail", "feed")).toMatchObject({ key: "uned-mail", name: "Email Student UNED", slug: "email-student-uned-av", label: "Email Student UNED (Spanyol)", imageUrl: unedImage });
});

it("maps StoreBat warranty and CDK to existing families, and LangSmith to Developer Tools", () => {
  expect(storebatFamily(143, "feed")).toMatchObject({ key: "chatgpt-plus", slug: "chatgpt-plus-sb", label: "Plus 1 Bulan (Garansi 25 Hari)" });
  expect(storebatFamily(144, "feed")).toMatchObject({ key: "gemini", slug: "gemini-sb", label: "CDK AI Pro 12 Bulan (V2)" });
  expect(storebatFamily(142, "feed")).toMatchObject({ key: "langsmith", name: "LangSmith Plus", slug: "langsmith-sb", category: 6, label: "Plus", imageUrl: langsmithImage });
});

it("maps TUNVN CapCut, manual Muse and Microsoft Copilot with stable labels and sort order", () => {
  expect(tunvnFamilyForSupplierId(119)).toMatchObject({ family: { key: "capcut", slug: "capcut-pro-tunvn" }, member: { label: "Pro 7 Hari (200–500 Kredit)", sort: 5 } });
  expect(tunvnFamilyForSupplierId(121)).toMatchObject({ family: { key: "capcut" }, member: { label: "Pro 6 Hari (Full Garansi)", sort: 6 } });
  expect(tunvnFamilyForSupplierId(120)).toMatchObject({ family: { key: "muse", slug: "muse-ai-1-miliar-token", markFamily: false }, member: { label: "Akun 1B Token (tanpa garansi)", sort: 25 } });
  expect(tunvnFamilyForSupplierId(122)).toMatchObject({ family: { key: "microsoft-copilot", slug: "microsoft-copilot-tunvn", name: "Microsoft Copilot Premium", imageUrl: copilotImage }, member: { label: "Premium 1 Bulan (Full Garansi)", sort: 1 } });
});

type Product = { id: number; name: string; slug?: string; av?: string; sb?: string; tunvn?: string; active?: number; description?: string; image?: string };
function seedProduct({ id, name, slug = `fixture-product-${id}`, av, sb, tunvn, active = 0, description, image }: Product) {
  fixture.sql.prepare(`INSERT INTO products(id,name,slug,category_id,price,stock,is_active,aivault_family,storebat_family,tunvn_family,description,image_url,images)
    VALUES(?,?,?,2,2000,3,?,?,?,?,?,?,?)`).run(id, name, slug, active, av ?? null, sb ?? null, tunvn ?? null, description ?? null, image ?? null, image ? JSON.stringify([image]) : null);
}

function seedVariant(productId: number, supplier: "av" | "sb" | "tunvn", sid: number | string, label: string, active = 0) {
  const [skuPrefix, identity] = supplier === "av" ? ["AV", "aivault_service_id"] : supplier === "sb" ? ["SB", "storebat_product_id"] : ["TUNVN", "tunvn_source_product_id"];
  fixture.sql.prepare(`INSERT INTO product_variants(id,product_id,sku,label,price,stock,is_active,sort_order,${identity}) VALUES(?,?,?,?,2999,4,?,1,?)`)
    .run(productId + 100_000, productId, `${skuPrefix}-${sid}`, label, active, sid);
}

const rekeys = [
  { id: 51950, name: "UNED Student Email", av: "service:service_uned_mail", supplier: "av", sid: "service_uned_mail", description: aivaultDefaultDescription("UNED Student Email"), expected: ["Email Student UNED", "email-student-uned-av", 3, unedImage, "Email Student UNED (Spanyol)"] },
  { id: 51945, name: "LangSmith Plus", sb: "product:142", supplier: "sb", sid: 142, description: storebatDefaultDescription("LangSmith Plus"), expected: ["LangSmith Plus", "langsmith-sb", 6, langsmithImage, "Plus"] },
  { id: 51959, name: "Copilot Premium 1M (FW)", tunvn: "p122", supplier: "tunvn", sid: 122, description: tunvnDefaultDescription("Copilot Premium 1M (FW)"), expected: ["Microsoft Copilot Premium", "microsoft-copilot-tunvn", 1, copilotImage, "Premium 1 Bulan (Full Garansi)"] },
] as const;

const merges = [
  { id: 51948, name: "ChatGPT Plus 1M FW", av: "service:service_chatgpt_plus_1m_fw", supplier: "av", sid: "service_chatgpt_plus_1m_fw", target: 174, label: "Plus 1 Bulan (Full Garansi)", sort: 1 },
  { id: 51957, name: "Chatgpt plus 1M 25D W", sb: "product:143", supplier: "sb", sid: 143, target: 394, label: "Plus 1 Bulan (Garansi 25 Hari)", sort: 1 },
  { id: 51949, name: "iLovePDF NW", av: "service:service_ilovepdf_nw", supplier: "av", sid: "service_ilovepdf_nw", target: 381, label: "Premium (Tanpa Garansi)", sort: 1 },
  { id: 51960, name: "CDK google ia pro 12M  V2", sb: "product:144", supplier: "sb", sid: 144, target: 407, label: "CDK AI Pro 12 Bulan (V2)", sort: 1 },
  { id: 51947, name: "Capcut Pro 7D 200-500 Credits", tunvn: "p119", supplier: "tunvn", sid: 119, target: 123, label: "Pro 7 Hari (200–500 Kredit)", sort: 5 },
  { id: 51958, name: "Capcut Pro 6D(FW)", tunvn: "p121", supplier: "tunvn", sid: 121, target: 123, label: "Pro 6 Hari (Full Garansi)", sort: 6 },
  { id: 51956, name: "MUSE AI 1B TOKEN (NW)", tunvn: "p120", supplier: "tunvn", sid: 120, target: 112, label: "Akun 1B Token (tanpa garansi)", sort: 25 },
] as const;

const anomalies = [[51951, "service_5"], [51952, "service_4"], [51953, "service_1"], [51954, "service_2"], [51955, "service_3"]] as const;

function seedMigrationRows() {
  const sql = fixture.sql;
  seedProduct({ id: 174, name: "ChatGPT Plus", slug: "chatgpt-plus-av", av: "chatgpt-plus", active: 1 });
  seedProduct({ id: 394, name: "ChatGPT Plus", slug: "chatgpt-plus-sb", sb: "chatgpt-plus", active: 1 });
  seedProduct({ id: 381, name: "iLovePDF Premium 1 Year", slug: pdfSlug, av: "service:service_ilovepdf_1y", active: 1, image: "/r2/pdf.webp" });
  seedVariant(381, "av", "service_ilovepdf_1y", "Premium 1 Year", 1);
  seedProduct({ id: 407, name: "Google AI / Gemini", slug: "gemini-sb", sb: "gemini", active: 1 });
  seedProduct({ id: 123, name: "CapCut Pro", slug: "capcut-pro-tunvn", tunvn: "capcut", active: 1 });
  seedProduct({ id: 112, name: "Muse AI 1 Miliar Token", slug: "muse-ai-1-miliar-token", active: 1 });
  sql.exec(`INSERT INTO product_groups(id,name,winner_product_id) VALUES(37,'ChatGPT Plus',174);
    INSERT INTO product_group_members(group_id,product_id,position) VALUES(37,174,0),(37,394,1);`);
  for (const row of [...rekeys, ...merges]) {
    seedProduct(row);
    seedVariant(row.id, row.supplier, row.sid, row.name);
  }
  for (const row of merges) {
    if (row.supplier === "av") sql.prepare(`INSERT INTO aivault_products(service_id,name,unit_price_usd,pricing_tiers_json,axvara_product_id) VALUES(?,?,1,'[]',?)`).run(row.sid, row.name, row.id);
    if (row.supplier === "tunvn") sql.prepare(`INSERT INTO tunvn_products(supplier_product_id,name,axvara_product_id,visible) VALUES(?,?,?,1)`).run(row.sid, row.name, row.id);
  }
  for (const [id, sid] of anomalies) {
    seedProduct({ id, name: sid, av: `service:${sid}` });
    seedVariant(id, "av", sid, sid);
  }
}

it("0158 migrates the exact fallback rows, keeps active destinations and group 37 stable, and reruns with zero writes", () => {
  seedMigrationRows();
  const sql = fixture.sql;
  const destinations = () => sql.prepare("SELECT * FROM products WHERE id IN (112,123,174,381,394,407) ORDER BY id").all();
  const activeVariant = () => sql.prepare("SELECT * FROM product_variants WHERE sku='AV-service_ilovepdf_1y'").get();
  const groups = () => [sql.prepare("SELECT * FROM product_groups").all(), sql.prepare("SELECT * FROM product_group_members ORDER BY position").all()];
  const before = destinations(), beforeVariant = activeVariant(), beforeGroups = groups();

  sql.exec(migration);

  for (const { id, description, expected: [name, slug, category_id, image_url, label] } of rekeys) {
    const row = sql.prepare("SELECT p.*,v.label,v.is_active AS variant_active FROM products p JOIN product_variants v ON v.product_id=p.id WHERE p.id=?").get(id);
    expect(row).toMatchObject({ name, slug, category_id, image_url, images: JSON.stringify([image_url]), label, is_active: 0, variant_active: 0, archived_at: null });
    expect(row?.description).not.toBe(description);
    expect(row?.description_en).toEqual(expect.any(String));
  }
  for (const { id, target, label, sort, sid, supplier } of merges) {
    expect(sql.prepare("SELECT product_id,label,sort_order,is_active,price,stock FROM product_variants WHERE id=?").get(id + 100_000))
      .toEqual({ product_id: target, label, sort_order: sort, is_active: 0, price: 2999, stock: 4 });
    if (supplier === "av") expect(sql.prepare("SELECT axvara_product_id FROM aivault_products WHERE service_id=?").get(sid)).toEqual({ axvara_product_id: target });
    if (supplier === "tunvn") expect(sql.prepare("SELECT axvara_product_id,visible FROM tunvn_products WHERE supplier_product_id=?").get(sid)).toEqual({ axvara_product_id: target, visible: 0 });
  }
  for (const id of [...merges.map(row => row.id), ...anomalies.map(([id]) => id)]) {
    expect(sql.prepare("SELECT is_active,archived_at FROM products WHERE id=?").get(id)).toEqual({ is_active: 0, archived_at: expect.any(String) });
  }
  for (const [id] of anomalies) expect(sql.prepare("SELECT product_id,is_active FROM product_variants WHERE id=?").get(id + 100_000)).toEqual({ product_id: id, is_active: 0 });
  expect(destinations()).toEqual(before.map(row => row.id === 381 ? { ...row, name: "iLovePDF Premium", aivault_family: "ilovepdf" } : row));
  expect(activeVariant()).toEqual({ ...beforeVariant, label: "Premium 1 Tahun" });
  expect(groups()).toEqual(beforeGroups);
  expect(sql.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  const changes = () => sql.prepare("SELECT total_changes() AS n").get();
  const after = changes();
  sql.exec(migration);
  expect(changes()).toEqual(after);
});

it("0158 skips activated, archived, collision and unexpected-identity rows, and preserves admin copy/art", () => {
  seedMigrationRows();
  const sql = fixture.sql;
  sql.exec(`UPDATE products SET is_active=1 WHERE id IN (51948,51950);
    UPDATE product_variants SET is_active=1 WHERE product_id IN (51947,51955);
    UPDATE products SET archived_at='2026-11-22 12:00:00' WHERE id=51958;
    UPDATE products SET storebat_family='product:999' WHERE id=51957;
    UPDATE products SET archived_at='2026-11-22 12:00:00',is_active=0 WHERE id=407;
    UPDATE products SET description='Admin ID',description_en='Admin EN',image_url='/r2/admin.webp',images='["/r2/admin.webp"]' WHERE id=51945;`);
  seedProduct({ id: 901, name: "Owner Copilot", slug: "microsoft-copilot-tunvn", active: 1 });
  const untouched = () => [sql.prepare("SELECT * FROM products WHERE id IN (51948,51950,51947,51955,51958,51957,51960,51959,901) ORDER BY id").all(),
    sql.prepare("SELECT * FROM product_variants WHERE product_id IN (51948,51950,51947,51955,51958,51957,51960,51959) ORDER BY id").all()];
  const before = untouched();
  sql.exec(migration);
  expect(untouched()).toEqual(before);
  expect(sql.prepare("SELECT slug,description,description_en,image_url,images FROM products WHERE id=51945").get())
    .toEqual({ slug: "langsmith-sb", description: "Admin ID", description_en: "Admin EN", image_url: "/r2/admin.webp", images: '["/r2/admin.webp"]' });
});
