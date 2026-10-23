import fs from 'node:fs';
import {expect,it} from 'vitest';
import {createD1Fixture} from './helpers/d1-fixture';
it('backfills historical manual work without changing credits, replaying alerts, or overwriting handled notes',()=>{
 const f=createD1Fixture();try{
 f.sql.exec(`INSERT INTO orders(code,customer_name,customer_wa,items,subtotal,payment_method,status,payment_status,order_kind) VALUES('AXP-OLD','','','[]',10000,'qris','lunas','paid','pedia');
 INSERT INTO pedia_products(id,slug,platform,metric,target_kind,name) VALUES(1,'fixture','instagram','followers','profile','Fixture');
 INSERT INTO pedia_tiers(id,product_id,tier,supplier,supplier_service_id,price_group,markup_pct,min_profit_rp) VALUES(1,1,'standar','indosmm',1,'G3',0,1000);
 INSERT INTO pedia_order_items(order_code,product_id,tier_id,snapshot_json,target_raw,target_normalized,quantity,unit_price,total,supplier,supplier_service_id,supplier_rate_snapshot,status) VALUES('AXP-OLD',1,1,'{}','x','x',100,100,10000,'indosmm',1,1000,'partial');
 INSERT INTO pedia_credits(id,code_hash,code_hint,email,amount,remaining,source_order_code,source_kind,expires_at) VALUES(1,'fixture','TEST','fixture@example.test',4000,2500,'AXP-OLD','partial','2099-01-01');
 INSERT INTO pedia_credit_ledger(credit_id,order_code,delta) VALUES(1,'AXP-OLD',4000),(1,'AXP-OLD',-1500);`);
 const migration=fs.readFileSync('drizzle/migrations/0075_audit_manual_followup.sql','utf8');f.sql.exec(migration);
 expect(f.sql.prepare('SELECT remaining FROM pedia_credits').get()?.remaining).toBe(2500);
 expect(f.sql.prepare('SELECT COUNT(*) n FROM pedia_credit_ledger').get()?.n).toBe(2);
 const row=f.sql.prepare('SELECT * FROM pedia_followups').get();expect(row?.state).toBe('open');expect(row?.reason).toBe('historical_partial');expect(row?.notification_claimed_at).toBeTruthy();expect(row?.buyer_notification_claimed_at).toBeTruthy();
 f.sql.exec("UPDATE pedia_followups SET state='handled',note='Already handled outside website',handled_by='owner'");f.sql.exec(migration);
 expect(f.sql.prepare('SELECT state,note,handled_by FROM pedia_followups').get()).toEqual({state:'handled',note:'Already handled outside website',handled_by:'owner'});
 }finally{f.close()}
});
