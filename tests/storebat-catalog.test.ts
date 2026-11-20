import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBudgetedDatabase, createDatabaseAccess } from "@/lib/db-access";
import { publishStorebatCatalog } from "@/lib/storebat/catalog";
import { STOREBAT_COPY } from "@/lib/storebat/copy";
import { storebatDefaultDescription } from "@/lib/storebat/families";
import { createD1Fixture } from "./helpers/d1-fixture";
import { product, buff, stubStorebatEnv } from "./helpers/storebat-fixture";
let f: ReturnType<typeof createD1Fixture>;
const response = (products = [product(),product(129)], tag = '"a"') => Response.json({success:true,products,services:[buff]},{headers:{ETag:tag}});
beforeEach(()=>{f=createD1Fixture();stubStorebatEnv();vi.stubGlobal("fetch",vi.fn(async()=>response()));});
afterEach(()=>{f.close();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("projects grouped inactive variants with copied image, markup, Muse cap and excluded test ids",async()=>{
  f.sql.exec("INSERT INTO products(name,slug,price,image_url,is_active) VALUES('Existing','google-ai-pro-antigravity',100,'/r2/fixture.webp',0)");
  const b=createBudgetedDatabase(40,2,f.db);expect(await publishStorebatCatalog(b.access,20000,{force:true})).toMatchObject({ok:true,mirrored:2});expect(b.used).toBeLessThanOrEqual(38);
  expect(f.sql.prepare("SELECT source,fulfillment_mode,telegram_enabled,is_active,image_url FROM products WHERE storebat_family='gemini'").get()).toEqual({source:"manual",fulfillment_mode:"manual",telegram_enabled:1,is_active:0,image_url:"/r2/fixture.webp"});
  expect(f.sql.prepare("SELECT price,stock,is_active FROM product_variants WHERE sku='SB-121'").get()).toEqual({price:13500,stock:5,is_active:0});
  expect(f.sql.prepare("SELECT price,stock,max_qty,buyer_field_key,storebat_markup_percent FROM product_variants WHERE sku='SB-BUFF'").get()).toEqual({price:2800,stock:-1,max_qty:30,buyer_field_key:"muse_invite_code",storebat_markup_percent:40});
  expect(f.sql.prepare("SELECT * FROM product_variants WHERE sku='SB-129'").get()).toBeUndefined();
});
it("304 updates health without rewriting mirror, variant, service or ETag",async()=>{
  const db=createDatabaseAccess(f.db),now=Date.now();await publishStorebatCatalog(db,20000,{now});
  f.sql.exec("UPDATE product_variants SET stock=3 WHERE sku='SB-121'; UPDATE storebat_products SET updated_at='unchanged' WHERE id=121");
  expect(await publishStorebatCatalog(db,20000,{now:now+44999})).toEqual({skipped:"throttled"});
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304}));
  expect(await publishStorebatCatalog(db,30000,{now:now+45000})).toMatchObject({ok:true,unchanged:true});
  expect(f.sql.prepare("SELECT stock,price FROM product_variants WHERE sku='SB-121'").get()).toEqual({stock:3,price:13500});
  expect(f.sql.prepare("SELECT updated_at FROM storebat_products WHERE id=121").get()?.updated_at).toBe("unchanged");
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='storebat_catalog_success_at'").get()?.value).toBe(String(now+45000));
});
it("retains admin metadata, activation, explicit price, then zeroes disappeared stock",async()=>{
  const db=createDatabaseAccess(f.db); await publishStorebatCatalog(db,20000,{force:true});
  f.sql.exec("UPDATE products SET name='Admin',description='Admin',image_url='/r2/admin.webp',is_active=1 WHERE storebat_family='gemini'; UPDATE product_variants SET label='Admin',is_active=1,storebat_admin_price_idr=7777 WHERE sku='SB-121'");
  vi.mocked(fetch).mockResolvedValueOnce(response([product(60)],'"b"'));
  expect(await publishStorebatCatalog(db,25000,{force:true})).toMatchObject({ok:true});
  expect(f.sql.prepare("SELECT name,description,image_url,is_active,price,stock FROM products WHERE storebat_family='gemini'").get()).toEqual({name:"Admin",description:"Admin",image_url:"/r2/admin.webp",is_active:1,price:7777,stock:0});
  expect(f.sql.prepare("SELECT label,is_active FROM product_variants WHERE sku='SB-121'").get()).toEqual({label:"Admin",is_active:1});
  expect(f.sql.prepare("SELECT disappeared FROM storebat_products WHERE id=121").get()?.disappeared).toBe(1);
});
it("fails closed on missing FX or invalid feed without advancing ETag",async()=>{
  const db=createDatabaseAccess(f.db);expect(await publishStorebatCatalog(db,0,{force:true})).toMatchObject({ok:false,error:"fx_unavailable"});expect(fetch).not.toHaveBeenCalled();
  expect(await publishStorebatCatalog(db,20000,{force:true})).toMatchObject({ok:true});
  vi.mocked(fetch).mockResolvedValueOnce(response([],'"b"'));
  expect(await publishStorebatCatalog(db,20000,{force:true})).toMatchObject({ok:false,error:"invalid_or_empty_catalog"});
  expect(f.sql.prepare("SELECT value FROM store_settings WHERE key='storebat_catalog_etag'").get()?.value).toBe('"a"');
});
it("shortens a failed projection's claim, retains the ETag fence and records no exception text", async () => {
  const { access: db } = createBudgetedDatabase(40, 2, f.db);
  const now = Date.now();
  expect(await publishStorebatCatalog(db, 20_000, { now })).toMatchObject({ ok: true });
  vi.mocked(fetch).mockResolvedValueOnce(response([product()], '"b"'));
  f.control.afterBatch = async queries => {
    if (queries.some(q => q.includes(":inputs") || q.includes("storebat_admin_price_idr IS NOT"))) {
      throw new Error("D1_ERROR: SQLITE_BUSY; Bearer fixture-secret; body=private-response");
    }
  };
  const setting = (key: string) => f.sql.prepare("SELECT value FROM store_settings WHERE key=?").get(key)?.value;
  const run = (offset: number) => publishStorebatCatalog(createBudgetedDatabase(40, 2, f.db).access, 20_000, { now: now + offset });
  expect(await run(60_000)).toEqual({ ok: false, error: "catalog_write_failed:database_busy" });
  expect(JSON.parse(String(setting("storebat_catalog_last_error"))).error).toBe("catalog_write_failed:database_busy");
  expect(setting("storebat_catalog_success_at")).toBe(String(now));
  expect(setting("storebat_catalog_etag")).toBe('"a"');
  expect(await run(61_000)).toEqual({ skipped: "throttled" });
  expect(fetch).toHaveBeenCalledTimes(2);
  f.control.afterBatch = null;
  vi.mocked(fetch).mockResolvedValueOnce(response([product()], '"b"'));
  expect(await run(104_000)).toMatchObject({ ok: true });
  expect(setting("storebat_catalog_last_error")).toBe("");
  expect(setting("storebat_catalog_etag")).toBe('"b"');
});
it("writes curated copy, category, and image once on insert and never overwrites admin edits on resync",async()=>{
  f.sql.exec("INSERT INTO products(name,slug,price,image_url,is_active) VALUES('Ref GPT','chatgpt-plus-1-bulan',100,'/r2/chatgpt-existing.webp',0)");
  const db=createDatabaseAccess(f.db);
  vi.mocked(fetch).mockResolvedValueOnce(response([product(4),product(78),product(99999)],'"c1"'));
  expect(await publishStorebatCatalog(db,20000,{force:true})).toMatchObject({ok:true,mirrored:4});

  // Lovable (id=4): uses category 6, curated description/description_en, and R2 imageUrl fallback.
  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE storebat_family='lovable'").get()).toEqual({
    category_id:6,
    description:STOREBAT_COPY.lovable.description,
    description_en:STOREBAT_COPY.lovable.description_en,
    image_url:"/r2/products/ed1c0bd98ee27efbd4ab1e435fee5fbc.webp",
  });
  expect(f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='SB-4'").get()).toEqual(
    STOREBAT_COPY.lovable.variants["SB-4"],
  );
  // ChatGPT Plus (id=78): candidate slug wins for image_url; SB-78 gets curated variant copy.
  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE storebat_family='chatgpt-plus'").get()).toEqual({
    category_id:1,
    description:STOREBAT_COPY["chatgpt-plus"].description,
    description_en:STOREBAT_COPY["chatgpt-plus"].description_en,
    image_url:"/r2/chatgpt-existing.webp",
  });
  expect(f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='SB-78'").get()).toEqual(
    STOREBAT_COPY["chatgpt-plus"].variants["SB-78"],
  );
  // Muse Buff (SB-BUFF): gets curated variant copy.
  expect(f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='SB-BUFF'").get()).toEqual(
    STOREBAT_COPY["muse-buff"].variants["SB-BUFF"],
  );
  // Uncurated fallback product (id=99999): falls back cleanly with null EN/variant copy.
  expect(f.sql.prepare("SELECT description,description_en FROM products WHERE storebat_family='product:99999'").get()).toEqual({
    description:storebatDefaultDescription("Fixture"),
    description_en:null,
  });
  expect(f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='SB-99999'").get()).toEqual({
    admin_terms:null,admin_terms_en:null,admin_activation:null,admin_activation_en:null,
  });

  // Admin edits copy, category, image, and variant copy; then resync adds SB-60 to chatgpt-plus.
  f.sql.exec("UPDATE products SET description='Admin Desc',description_en='Admin Desc EN',category_id=2,image_url='/r2/admin.webp' WHERE storebat_family='chatgpt-plus'");
  f.sql.exec("UPDATE product_variants SET admin_terms='Admin Terms',admin_terms_en='Admin Terms EN',admin_activation='Admin Act',admin_activation_en='Admin Act EN' WHERE sku='SB-78'");
  vi.mocked(fetch).mockResolvedValueOnce(response([product(4),product(60),product(78)],'"c2"'));
  expect(await publishStorebatCatalog(db,21000,{force:true})).toMatchObject({ok:true});

  expect(f.sql.prepare("SELECT category_id,description,description_en,image_url FROM products WHERE storebat_family='chatgpt-plus'").get()).toEqual({
    category_id:2,description:"Admin Desc",description_en:"Admin Desc EN",image_url:"/r2/admin.webp",
  });
  expect(f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='SB-78'").get()).toEqual({
    admin_terms:"Admin Terms",admin_terms_en:"Admin Terms EN",admin_activation:"Admin Act",admin_activation_en:"Admin Act EN",
  });
  // Newly inserted sibling variant SB-60 gets its curated copy on first insert.
  expect(f.sql.prepare("SELECT admin_terms,admin_terms_en,admin_activation,admin_activation_en FROM product_variants WHERE sku='SB-60'").get()).toEqual(
    STOREBAT_COPY["chatgpt-plus"].variants["SB-60"],
  );
});

it("allocates distinct category-tail sort_order (+10 each after non-archived max) on new inserts and keeps existing sort_order on re-sync", async () => {
  f.sql.exec(`
    INSERT INTO products(category_id,name,slug,price,is_active,sort_order) VALUES
      (1,'Existing Cap','existing-cap',1000,1,500),
      (1,'Archived Higher','archived-higher',1000,0,900);
    UPDATE products SET archived_at=datetime('now') WHERE slug='archived-higher';
    INSERT INTO products(category_id,name,slug,price,is_active,sort_order,source,fulfillment_mode,storebat_family) VALUES
      (1,'Existing StoreBat','gemini-plus-sb',1000,1,42,'manual','manual','gemini');
  `);
  const db = createDatabaseAccess(f.db);
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json(
      {
        success: true,
        products: [
          product(121),
          { ...product(78), name: "ChatGPT Plus" },
          { ...product(116), name: "ChatGPT Go" },
        ],
        services: [],
      },
      { headers: { ETag: '"tail-1"' } },
    ),
  );
  expect(await publishStorebatCatalog(db, 20000, { force: true })).toMatchObject({ ok: true });
  expect(
    f.sql.prepare("SELECT storebat_family, sort_order FROM products WHERE storebat_family IS NOT NULL ORDER BY sort_order ASC").all(),
  ).toEqual([
    { storebat_family: "gemini", sort_order: 42 },
    { storebat_family: "chatgpt-plus", sort_order: 510 },
    { storebat_family: "chatgpt-go", sort_order: 520 },
  ]);

  // Re-sync with changed FX must not touch sort_order of existing rows.
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json(
      {
        success: true,
        products: [
          product(121),
          { ...product(78), name: "ChatGPT Plus" },
          { ...product(116), name: "ChatGPT Go" },
        ],
        services: [],
      },
      { headers: { ETag: '"tail-2"' } },
    ),
  );
  expect(await publishStorebatCatalog(db, 22000, { force: true })).toMatchObject({ ok: true });
  expect(
    f.sql.prepare("SELECT storebat_family, sort_order FROM products WHERE storebat_family IS NOT NULL ORDER BY sort_order ASC").all(),
  ).toEqual([
    { storebat_family: "gemini", sort_order: 42 },
    { storebat_family: "chatgpt-plus", sort_order: 510 },
    { storebat_family: "chatgpt-go", sort_order: 520 },
  ]);
});

it("H2-14: clears compare_price when FX pushes the projected price above it",async()=>{
  const db=createDatabaseAccess(f.db);
  await publishStorebatCatalog(db,20000,{force:true});
  const before=f.sql.prepare("SELECT price FROM product_variants WHERE sku='SB-121'").get() as {price:number};
  f.sql.exec(`UPDATE product_variants SET compare_price=${Number(before.price)+1} WHERE sku='SB-121'`);
  expect(await publishStorebatCatalog(db,25000,{force:true})).toMatchObject({ok:true});
  expect(f.sql.prepare("SELECT price,compare_price FROM product_variants WHERE sku='SB-121'").get())
    .toEqual({price:16900,compare_price:null});
});
