import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("native D1 agrees on unique stock and reserved SK/WR group members", async () => {
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
      import {listProductGroups,decideAllGroups} from './src/lib/product-groups';
      import {effectiveVariantStockSql,purchasableStockSql} from './src/lib/catalog-availability';
      import {createDatabaseAccess} from './src/lib/db-access';
      export default {async fetch(req,env){
        await decideAllGroups(createDatabaseAccess(env.DB));
        return Response.json({groups:await listProductGroups(createDatabaseAccess(env.DB)),
          stock:await env.DB.prepare('SELECT '+effectiveVariantStockSql('v')+' stock,'+purchasableStockSql('v')+' buyable FROM product_variants v WHERE id=3').first()});
      }}
    ` }, bundle: true, write: false, format: "esm", platform: "neutral", target: "es2022",
  });
  const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-08-06", compatibilityFlags: ["nodejs_compat"], script: compiled.outputFiles[0].text, d1Databases: ["DB"] });
  const fixture = createD1Fixture();
  try {
    const db = await runtime.getD1Database("DB");
    const tables = fixture.sql.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name IN
      ('categories','products','product_variants','wr_products','wr_variants','sk_products','tunvn_products','aivault_products','fulfillment_inventory','product_groups','product_group_members','product_group_dirty','crypto_market_snapshot')`).all() as { sql: string }[];
    await db.batch(tables.map(t => db.prepare(t.sql)));
    const statements = [
      "INSERT INTO products(id,name,slug,price,wr_product_id,sk_product_id) VALUES(1,'SK','sk',10,NULL,'s'),(2,'WR','wr',10,'w',NULL),(3,'Unique','unique',10,NULL,NULL)",
      "INSERT INTO product_variants(id,product_id,sku,label,price,stock,sk_variant_id,wr_variant_id,fulfillment_mode) VALUES(1,1,'SK','SK',10,0,'s',NULL,'manual'),(2,2,'WR','WR',10,3,NULL,'w','manual'),(3,3,'UNI','Unique',10,-1,NULL,NULL,'unique')",
      "INSERT INTO wr_products(wr_product_id,wr_product_name) VALUES('w','WR')",
      "INSERT INTO wr_variants(wr_variant_id,wr_product_id,wr_variant_name,wr_price,wr_stock,wr_delivery_class) VALUES('w','w','WR',2,3,'restock')",
      "INSERT INTO sk_products(sk_variant_id,sk_product_id,sk_product_name,sk_variant_name,sk_price,sk_stock) VALUES('s','s','SK','SK',1,9)",
      "INSERT INTO product_groups(id,name,prefer_margin) VALUES(1,'Group',0)",
      "INSERT INTO product_group_members(group_id,product_id,position) VALUES(1,1,0),(1,2,1)",
    ];
    await db.batch(statements.map(sql => db.prepare(sql)));
    const call = async () => {
      const response = await runtime.dispatchFetch("https://fixture.test/stock");
      expect(response.status).toBe(200);
      return response.json() as Promise<{ groups: { winner_product_id: number }[]; stock: { stock: number; buyable: number } }>;
    };
    expect(await call()).toMatchObject({ groups: [{ winner_product_id: 2 }], stock: { stock: 0, buyable: 0 } });
    await db.batch([1, 2, 3].map(id => db.prepare("INSERT INTO fulfillment_inventory(product_id,variant_id,secret_ciphertext,secret_iv,secret_fingerprint,status) VALUES(3,3,'fixture','fixture',?,'available')").bind(String(id))));
    await db.prepare("UPDATE product_variants SET stock=CASE WHEN id=1 THEN -1 WHEN id=2 THEN 0 ELSE stock END").run();
    expect(await call()).toMatchObject({ groups: [{ winner_product_id: 1 }], stock: { stock: 3, buyable: 1 } });
  } finally { fixture.close(); await runtime.dispose(); }
}, 30000);
