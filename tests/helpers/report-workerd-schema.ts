// Minimal production report columns, with the corresponding primary/unique keys.
export const reportRuntimeSchema = [
      "CREATE TABLE orders(code TEXT PRIMARY KEY,subtotal INTEGER,order_kind TEXT,items TEXT,variant_id INTEGER,sales_channel TEXT,paid_at TEXT,updated_at TEXT,status TEXT)",
      "CREATE TABLE payment_transactions(order_code TEXT UNIQUE,payable_amount INTEGER,paid_at TEXT)",
      "CREATE TABLE payment_proofs(order_code TEXT,reviewed_at TEXT,status TEXT)",
      "CREATE TABLE fulfillment_items(id INTEGER PRIMARY KEY,order_code TEXT,item_index INTEGER,product_id INTEGER,variant_id INTEGER,qty INTEGER,wr_link_id INTEGER,sk_link_id INTEGER)",
      "CREATE TABLE order_item_costs(order_code TEXT,item_index INTEGER,source TEXT,unit_cost INTEGER,supplier_variant_id TEXT)",
      "CREATE TABLE product_variants(id INTEGER PRIMARY KEY,manual_cost INTEGER,wr_variant_id TEXT,sk_variant_id TEXT)",
      "CREATE TABLE wr_variants(wr_variant_id TEXT PRIMARY KEY,axvara_variant_id INTEGER,wr_price INTEGER)",
      "CREATE TABLE sk_products(sk_variant_id TEXT PRIMARY KEY,axvara_variant_id INTEGER,sk_price INTEGER)",
      "CREATE TABLE wr_order_links(id INTEGER PRIMARY KEY,order_code TEXT,fulfillment_item_id INTEGER,wr_variant_id TEXT,wr_cost INTEGER,status TEXT)",
      "CREATE TABLE sk_order_links(id INTEGER PRIMARY KEY,order_code TEXT,fulfillment_item_id INTEGER,sk_variant_id TEXT,sk_cost INTEGER,status TEXT)",
      "CREATE TABLE pedia_order_items(order_code TEXT UNIQUE,credit_used INTEGER,supplier_charge REAL,supplier_rate_snapshot REAL,quantity INTEGER)",

];
