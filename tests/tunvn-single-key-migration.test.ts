import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createD1Fixture } from "./helpers/d1-fixture";

it("0142 only deactivates unrequested/excluded variants and recomputes visible without editing parents", () => {
  const { sql, close } = createD1Fixture();
  try {
    const trigger = () => sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='tunvn_variant_publication'").get();
    expect(trigger()).toBeUndefined(); // Bootstrap schema already reflects 0142.
    const old = readFileSync("drizzle/migrations/0123_tunvn_full_catalog.sql", "utf8");
    sql.exec(old.slice(old.indexOf("CREATE TRIGGER tunvn_variant_publication")));
    expect(trigger()).toEqual({ name: "tunvn_variant_publication" });
    sql.exec(`INSERT INTO products(id,name,slug,price,is_active,tunvn_family) VALUES
      (1,'Live','live',100,1,'live'), (2,'Off','off',100,0,'off'),
      (3,'Desynced','desynced',100,1,'desynced'), (4,'Archived','archived',100,0,'archived');
      INSERT INTO product_variants(product_id,sku,label,price,is_active,tunvn_source_product_id) VALUES
      (1,'TUNVN-37','Live',100,1,37), (2,'TUNVN-73','Inactive parent',100,1,73),
      (3,'TUNVN-44','Desynced',100,1,44), (1,'TUNVN-47','Inactive variant',100,0,47),
      (1,'TUNVN-60','Excluded',100,1,60), (1,'TUNVN-900','Missing mirror',100,1,900),
      (4,'TUNVN-86','Archived',100,1,86), (1,'TUNVN-BUFF-1B','Buff',100,1,NULL);
      UPDATE products SET archived_at='2026-11-19',is_active=0 WHERE id=4;
      INSERT INTO tunvn_products(supplier_product_id,name,publish_requested,visible) VALUES
      (37,'Live',1,0), (44,'Desynced',0,1), (47,'Inactive variant',1,1), (60,'Excluded',1,1),
      (73,'Inactive parent',1,1), (86,'Archived',1,1), (999,'Unmapped',1,1);`);
    const parents = () => sql.prepare("SELECT * FROM products ORDER BY id").all();
    const before = parents();
    const migration = readFileSync("drizzle/migrations/0142_tunvn_single_key_activation.sql", "utf8");
    sql.exec(migration);
    expect(trigger()).toBeUndefined();
    expect(parents()).toEqual(before);
    expect(sql.prepare("SELECT sku FROM product_variants WHERE is_active=1 ORDER BY sku").all()).toEqual(
      ["TUNVN-37", "TUNVN-73", "TUNVN-86", "TUNVN-BUFF-1B"].map(sku => ({ sku })),
    );
    expect(sql.prepare("SELECT supplier_product_id FROM tunvn_products WHERE visible=1").all()).toEqual([{ supplier_product_id: 37 }]);
    expect(() => sql.exec(migration)).not.toThrow();
    sql.exec("UPDATE product_variants SET is_active=0 WHERE tunvn_source_product_id=37");
    expect(sql.prepare("SELECT publish_requested FROM tunvn_products WHERE supplier_product_id=37").get()).toEqual({ publish_requested: 1 });
  } finally {
    close();
  }
});
