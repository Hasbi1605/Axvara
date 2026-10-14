import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
const migration = fs.readFileSync('drizzle/migrations/0063_order_item_cost_snapshots.sql','utf8');
describe('0063 additive immutable order costs',()=>{
  it('applies to an existing orders table, replays without changing data, and preserves zero/unknown distinctly',()=>{
    const db=new DatabaseSync(':memory:');
    try{
      db.exec("PRAGMA foreign_keys=ON; CREATE TABLE orders(code TEXT PRIMARY KEY); INSERT INTO orders VALUES('PAID');");
      db.exec(migration);
      db.exec("INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES('PAID',0,'manual',0),('PAID',1,'manual',NULL)");
      db.exec(migration);
      expect(db.prepare('SELECT unit_cost FROM order_item_costs ORDER BY item_index').all()).toEqual([{unit_cost:0},{unit_cost:null}]);
      expect(()=>db.exec("INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES('PAID',2,'manual',-1)")).toThrow();
      expect(()=>db.exec("INSERT INTO order_item_costs(order_code,item_index,source,unit_cost) VALUES('MISSING',2,'manual',1)")).toThrow();
      expect(db.prepare('SELECT code FROM orders').all()).toEqual([{code:'PAID'}]);
    }finally{db.close();}
  });
});
