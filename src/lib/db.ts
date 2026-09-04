// Edge-safe DB — prod: D1 binding, dev: in-memory seed from products.ts
// No fs / better-sqlite3 imports — fully edge-compatible for @cloudflare/next-on-pages.

export type DbProduct = {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  compare_price: number | null;
  image_url: string | null;
  images: string | null;
  badge: string | null;
  sold_count: number | null;
  stock: number | null;
  is_active: number | null;
  sort_order: number | null;
};

export type D1Result = { results?: unknown[]; meta: { last_row_id?: number; changes?: number } };
export type D1Statement = {
  bind: (...p: unknown[]) => D1Statement;
  all: () => Promise<{ results: unknown[] }>;
  first: () => Promise<unknown>;
  run: () => Promise<D1Result>;
};
export type D1 = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<D1Result[]>;
};

export function getD1(): D1 | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const env = process.env as unknown as Record<string, unknown>;
  return (g.DB as D1 | undefined) ?? (env.DB as D1 | undefined) ?? null;
}

// ---- In-memory fallback (dev without D1) ----
import { products as seedProducts } from "@/lib/products";
import { articleSeedRows } from "@/lib/article-seeds";
type Row = Record<string, unknown>;

function getSharedMem(): Row[] {
  const g = process as unknown as { __AXVARA_MEM?: Row[] };
  if (g.__AXVARA_MEM) return g.__AXVARA_MEM;
  const catMap: Record<string, number> = {
    "ai-gateway": 1, "akun-premium": 2, "tools-pro": 3, "bundle-hemat": 4,
  };
  const rows: Row[] = seedProducts.map((p, i) => ({
    id: i + 1,
    slug: p.slug,
    name: p.name,
    description: p.description,
    price: p.price,
    compare_price: (p.comparePrice ?? null) as unknown,
    image_url: p.image,
    images: JSON.stringify(p.images ?? [p.image]),
    badge: p.badge ?? null,
    sold_count: p.soldCount ?? 0,
    stock: p.stock ?? -1,
    is_active: p.isActive === false ? 0 : 1,
    sort_order: p.sortOrder ?? i + 1,
    category_id: catMap[p.categorySlug] ?? 3,
    cat_slug: p.categorySlug,
  }));
  g.__AXVARA_MEM = rows;
  return rows;
}

// ---- Public API ----

export function getDbSync(): unknown {
  const d1 = getD1();
  if (d1) return d1;
  throw new Error("DB not initialized — use async query helpers");
}
export function isD1Mode(): boolean { return !!getD1(); }

export async function queryAll(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
  const d1 = getD1();
  if (d1) {
    if (params.length) return ((await d1.prepare(sql).bind(...params).all()).results as Row[]) ?? [];
    return ((await d1.prepare(sql).all()).results as Row[]) ?? [];
  }
  // Dev fallback: in-memory
  const lower = sql.toLowerCase();
  if (lower.includes("from categories")) {
    const rows = [...getCategoryMem()].map((category) => lower.includes("product_count")
      ? { ...category, product_count: getSharedMem().filter((product) => Number(product.category_id) === Number(category.id)).length }
      : category);
    return rows.sort((a,b)=>Number(a.sort_order??0)-Number(b.sort_order??0));
  }
  if (lower.includes("from products")) {
    let rows = [...getSharedMem()];
    if (lower.includes("is_active=1")) rows = rows.filter((r) => (r.is_active as number) !== 0);
    if (lower.includes("c.slug=?") && params.length) {
      rows = rows.filter((r) => r.cat_slug === String(params[0]));
      params = params.slice(1);
    }
    if (lower.includes("like ?")) {
      const q = String((params as string[])[0] ?? "").replace(/%/g, "").toLowerCase();
      if (q) rows = rows.filter((r) => `${r.name} ${r.slug} ${r.badge ?? ""} ${r.description ?? ""}`.toLowerCase().includes(q));
    }
    rows.sort((a, b) => (a.sort_order as number) - (b.sort_order as number));
    return rows;
  }
  if (lower.includes("from orders")) {
    let rows = [...getOrderMem()];
    if (lower.includes("status=?") && params.length) {
      rows = rows.filter((r) => String(r.status) === String(params[0]));
    }
    rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    return rows;
  }
  if (lower.includes("from articles")) {
    return [...getArticleMem()].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  }
  if (lower.includes("from banners")) {
    let rows = [...getBannerMem()];
    if (lower.includes("is_active=1")) rows = rows.filter((row) => Number(row.is_active) === 1);
    return rows.sort((a,b)=>Number(a.sort_order??0)-Number(b.sort_order??0));
  }
  if (lower.includes("from payment_methods")) {
    let rows = [...getPaymentMethodMem()];
    if (lower.includes("is_active=1")) rows = rows.filter((row) => Number(row.is_active) === 1);
    return rows.sort((a,b)=>Number(a.sort_order??0)-Number(b.sort_order??0));
  }
  if (lower.includes("from newsletter_subscribers")) {
    return [...getSubscriberMem()].sort((a,b)=>String(b.created_at??"").localeCompare(String(a.created_at??"")));
  }
  if (lower.includes("from agent_tokens")) return [...getTokenMem()].sort((a,b)=>String(b.created_at??"").localeCompare(String(a.created_at??"")));
  if (lower.includes("from article_audit_log")) return [...getAuditMem()].sort((a,b)=>String(b.created_at??"").localeCompare(String(a.created_at??""))).slice(0,100);
  return [];
}

function getOrderMem(): Row[] {
  const g = process as unknown as { __AXVARA_ORDERS?: Row[] };
  if (g.__AXVARA_ORDERS) return g.__AXVARA_ORDERS;
  g.__AXVARA_ORDERS = [];
  return g.__AXVARA_ORDERS;
}
function getArticleMem(): Row[] {
  const g = process as unknown as { __AXVARA_ARTICLES?: Row[] };
  if (!g.__AXVARA_ARTICLES) g.__AXVARA_ARTICLES = articleSeedRows.map((row) => ({ ...row }));
  return g.__AXVARA_ARTICLES;
}
function getBannerMem(): Row[] {
  const g = process as unknown as { __AXVARA_BANNERS?: Row[] };
  if (!g.__AXVARA_BANNERS) g.__AXVARA_BANNERS = [];
  return g.__AXVARA_BANNERS;
}
function getPaymentMethodMem(): Row[] {
  const g = process as unknown as { __AXVARA_PAYMENT_METHODS?: Row[] };
  if (!g.__AXVARA_PAYMENT_METHODS) g.__AXVARA_PAYMENT_METHODS = [
    { id: "qris", label: "QRIS", account_number: "", account_name: "Brotherstore06", qris_url: "/qris/axvara-qris.jpg", is_active: 1, sort_order: 1 },
    { id: "ewallet", label: "DANA / Gopay / Shopeepay", account_number: "082135277434", account_name: "Brotherstore06", qris_url: null, is_active: 1, sort_order: 2 },
    { id: "seabank", label: "SeaBank", account_number: "901812349386", account_name: "Brotherstore06", qris_url: null, is_active: 1, sort_order: 3 },
  ];
  return g.__AXVARA_PAYMENT_METHODS;
}
function getAuditMem(): Row[] {
  const g = process as unknown as { __AXVARA_ARTICLE_AUDIT?: Row[] };
  if (!g.__AXVARA_ARTICLE_AUDIT) g.__AXVARA_ARTICLE_AUDIT = [];
  return g.__AXVARA_ARTICLE_AUDIT;
}
function getCategoryMem(): Row[] {
  const g = process as unknown as { __AXVARA_CATEGORIES?: Row[] };
  if (!g.__AXVARA_CATEGORIES) g.__AXVARA_CATEGORIES = [{id:1,name:"AI Gateway",slug:"ai-gateway",icon:"lightning-bolt",sort_order:1},{id:2,name:"Akun Premium",slug:"akun-premium",icon:"crown",sort_order:2},{id:3,name:"Tools Pro",slug:"tools-pro",icon:"shield",sort_order:3},{id:4,name:"Bundle Kucing",slug:"bundle-hemat",icon:"packaging",sort_order:4}];
  return g.__AXVARA_CATEGORIES;
}
function getTokenMem(): Row[] {
  const g = process as unknown as { __AXVARA_AGENT_TOKENS?: Row[] };
  if (!g.__AXVARA_AGENT_TOKENS) g.__AXVARA_AGENT_TOKENS = [];
  return g.__AXVARA_AGENT_TOKENS;
}
function getSubscriberMem(): Row[] {
  const g = process as unknown as { __AXVARA_NEWSLETTER_SUBSCRIBERS?: Row[] };
  if (!g.__AXVARA_NEWSLETTER_SUBSCRIBERS) g.__AXVARA_NEWSLETTER_SUBSCRIBERS = [];
  return g.__AXVARA_NEWSLETTER_SUBSCRIBERS;
}

export async function queryFirst(sql: string, ...params: unknown[]): Promise<Row | undefined> {
  const d1 = getD1();
  if (d1) return (await d1.prepare(sql).bind(...params).first()) as Row | undefined;
  const lower = sql.toLowerCase();
  if (lower.includes("from categories where slug=?")) {
    return getCategoryMem().find((r) => String(r.slug) === String(params[0]));
  }
  if (lower.includes("from categories") && lower.includes("where id=?")) {
    return getCategoryMem().find((r) => String(r.id) === String(params[0]));
  }
  if (lower.includes("from products") && lower.includes("category_id=?")) {
    return getSharedMem().find((r) => String(r.category_id) === String(params[0]));
  }
  if (lower.includes("from products") && lower.includes("slug=?")) {
    return getSharedMem().find((r) => String(r.slug) === String(params[0]));
  }
  if (lower.includes("from products") && lower.includes("where") && lower.includes("id=?")) {
    const id = String(params[0]);
    const row = getSharedMem().find((r) => String(r.id) === id);
    if (row && lower.includes("select id from")) return { id: row.id };
    return row;
  }
  if (lower.includes("from orders") && lower.includes("code=?")) {
    const code = String(params[0]);
    return getOrderMem().find((r) => String(r.code) === code);
  }
  if (lower.includes("from orders") && lower.includes("quote_id=?")) {
    return getOrderMem().find((r) => String(r.quote_id) === String(params[0]));
  }
  if (lower.includes("from orders") && lower.includes("id=?")) {
    const id = String(params[0]);
    return getOrderMem().find((r) => String(r.id) === id);
  }
  if (lower.includes("from payment_methods") && lower.includes("id=?")) {
    return getPaymentMethodMem().find((r) => String(r.id) === String(params[0]));
  }
  if (lower.includes("from articles")) {
    const value = String(params[0]);
    if (lower.includes("idempotency_key")) return getArticleMem().find((r) => String(r.idempotency_key) === value);
    return getArticleMem().find((r) => String(r.id) === value || String(r.slug) === value);
  }
  if (lower.includes("from banners") && lower.includes("id=?")) {
    return getBannerMem().find((r) => String(r.id) === String(params[0]));
  }
  if (lower.includes("from agent_tokens")) return getTokenMem().find((r) => String(r.token_hash) === String(params[0]) && r.is_active === 1);
  if (lower.includes("from newsletter_subscribers") && lower.includes("email=?")) return getSubscriberMem().find((r) => String(r.email) === String(params[0]));
  return undefined;
}

export async function execRun(sql: string, ...params: unknown[]): Promise<{ lastInsertRowid?: number; changes?: number }> {
  const d1 = getD1();
  if (d1) {
    const r = await d1.prepare(sql).bind(...params).run();
    return {
      lastInsertRowid: (r as unknown as { meta: { last_row_id: number } }).meta?.last_row_id,
      changes: (r as unknown as { meta: { changes: number } }).meta?.changes,
    };
  }
  const lower = sql.toLowerCase();
  if (lower.startsWith("update products set")) {
    // Handle stock decrement/increment which has different param layouts
    if (lower.includes("stock = stock - ?")) {
      // UPDATE products SET stock = stock - ? WHERE id=? AND (stock=-1 OR stock >= ?)
      // params: [qty, id, qty]
      const dec = Number(params[0]);
      const id = String(params[1]);
      const row = getSharedMem().find((r) => String(r.id) === id);
      if (!row) return { changes: 0 };
      const stock = row.stock as number;
      if (stock !== -1 && stock < dec) return { changes: 0 };
      if (stock !== -1) row.stock = stock - dec;
      return { changes: 1 };
    }
    if (lower.includes("stock = stock + ?")) {
      // UPDATE products SET stock = stock + ? WHERE id=? AND stock != -1
      // params: [qty, id]
      const inc = Number(params[0]);
      const id = String(params[1]);
      const row = getSharedMem().find((r) => String(r.id) === id);
      if (!row) return { changes: 0 };
      if ((row.stock as number) !== -1) row.stock = (row.stock as number) + inc;
      return { changes: 1 };
    }
    const id = String(params[params.length - 1]);
    const row = getSharedMem().find((r) => String(r.id) === id);
    if (!row) return { changes: 0 };
    const fields = sql.match(/set\s+(.+)\s+where/i)?.[1].split(",") ?? [];
    let valueIndex = 0;
    for (const field of fields) {
      if (!field.includes("?")) continue;
      const column = field.trim().split("=")[0].trim();
      row[column] = params[valueIndex++];
    }
    if (row.category_id !== undefined) {
      row.cat_slug = getCategoryMem().find((category) => Number(category.id) === Number(row.category_id))?.slug ?? "tools-pro";
    }
    row.updated_at = new Date().toISOString();
    return { changes: 1 };
  }
  if (lower.startsWith("insert into products")) {
    const mem = getSharedMem();
    const newId = mem.length + 1;
    const [category_id, name, slug, description, price, compare_price, image_url, images, badge, sold_count, stock, is_active, sort_order] = params as unknown[];
    const categorySlug = getCategoryMem().find((category) => Number(category.id) === Number(category_id))?.slug ?? "tools-pro";
    mem.push({ id: newId, category_id, name, slug, description, price, compare_price, image_url, images, badge, sold_count, stock, is_active, sort_order, cat_slug: categorySlug });
    return { lastInsertRowid: newId, changes: 1 };
  }
  if (lower.startsWith("delete from products")) {
    const delId = String(params[0]);
    const mem = getSharedMem();
    const idx = mem.findIndex((r) => String(r.id) === delId);
    if (idx >= 0) { mem.splice(idx, 1); return { changes: 1 }; }
    return { changes: 0 };
  }
  if (lower.startsWith("insert into orders")) {
    const mem = getOrderMem();
    const newId = mem.length + 1;
    const [code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, payment_account, proof_url, status] = params as unknown[];
    // UNIQUE code check
    if (mem.some((r) => String(r.code) === String(code))) throw new Error("UNIQUE constraint failed: orders.code");
    mem.push({ id: newId, code, customer_name, customer_wa, customer_email, items, subtotal, payment_method, payment_account, proof_url, status: status ?? "pending", created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as unknown as Row);
    return { lastInsertRowid: newId, changes: 1 };
  }
  if (lower.startsWith("update orders set")) {
    const code = String(params[params.length - 1]);
    const row = getOrderMem().find((r) => String(r.code) === code);
    if (!row) return { changes: 0 };
    if (lower.includes("status=?")) row.status = String(params[0]);
    if (lower.includes("admin_note=?")) (row as Record<string, unknown>).admin_note = String(params[1] ?? params[0]);
    (row as Record<string, unknown>).updated_at = new Date().toISOString();
    return { changes: 1 };
  }
  if (lower.startsWith("insert into articles")) {
    const mem = getArticleMem(); const id = Math.max(0,...mem.map((row)=>Number(row.id)||0)) + 1;
    const columns = (sql.match(/insert into articles\s*\(([^)]+)\)/i)?.[1] ?? "").split(",").map((v) => v.trim());
    const row: Row = { id, is_published: 0, status: "draft", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    columns.forEach((column, index) => { row[column] = params[index]; });
    if (mem.some((item) => item.slug === row.slug || (row.idempotency_key && item.idempotency_key === row.idempotency_key))) throw new Error("UNIQUE constraint failed");
    mem.push(row); return { lastInsertRowid: id, changes: 1 };
  }
  if (lower.startsWith("update articles set")) {
    const row = getArticleMem().find((item) => String(item.id) === String(params[params.length - 1]));
    if (!row) return { changes: 0 };
    const fields = sql.match(/set\s+(.+)\s+where/i)?.[1].split(",") ?? []; let index = 0;
    fields.forEach((field) => { if (field.includes("?")) row[field.trim().split("=")[0].trim()] = params[index++]; });
    row.updated_at = new Date().toISOString(); return { changes: 1 };
  }
  if (lower.startsWith("delete from articles")) { const mem=getArticleMem(), i=mem.findIndex((r)=>String(r.id)===String(params[0])); if(i>=0){mem.splice(i,1);return {changes:1};} return {changes:0}; }
  if (lower.startsWith("insert into banners")) {
    const mem=getBannerMem(),id=Math.max(0,...mem.map((row)=>Number(row.id)||0))+1;
    const columns=(sql.match(/banners\s*\(([^)]+)\)/i)?.[1]??"").split(",").map((column)=>column.trim());
    const row:Row={id};columns.forEach((column,index)=>{row[column]=params[index]});mem.push(row);return{lastInsertRowid:id,changes:1};
  }
  if (lower.startsWith("update banners set")) {
    const row=getBannerMem().find((item)=>String(item.id)===String(params[params.length-1]));if(!row)return{changes:0};
    const fields=sql.match(/set\s+(.+)\s+where/i)?.[1].split(",")??[];let index=0;
    fields.forEach((field)=>{if(field.includes("?"))row[field.trim().split("=")[0].trim()]=params[index++]});row.updated_at=new Date().toISOString();return{changes:1};
  }
  if (lower.startsWith("delete from banners")) {const mem=getBannerMem(),index=mem.findIndex((row)=>String(row.id)===String(params[0]));if(index>=0){mem.splice(index,1);return{changes:1}}return{changes:0};}
  if (lower.startsWith("insert into categories")) { const mem=getCategoryMem(),id=Math.max(0,...mem.map((row)=>Number(row.id)||0))+1;if(mem.some((row)=>row.slug===params[1]))throw new Error("UNIQUE constraint failed: categories.slug");mem.push({id,name:params[0],slug:params[1],icon:params[2],sort_order:params[3]}); return {lastInsertRowid:id,changes:1}; }
  if (lower.startsWith("update categories set")) {const row=getCategoryMem().find((item)=>String(item.id)===String(params[params.length-1]));if(!row)return{changes:0};const fields=sql.match(/set\s+(.+)\s+where/i)?.[1].split(",")??[];let index=0;for(const field of fields){if(!field.includes("?"))continue;const column=field.trim().split("=")[0].trim(),value=params[index++];if(column==="slug"&&getCategoryMem().some((item)=>item!==row&&item.slug===value))throw new Error("UNIQUE constraint failed: categories.slug");row[column]=value}getSharedMem().filter((product)=>Number(product.category_id)===Number(row.id)).forEach((product)=>{product.cat_slug=row.slug});return {changes:1};}
  if (lower.startsWith("delete from categories")) { const mem=getCategoryMem(),i=mem.findIndex(r=>String(r.id)===String(params[0]));if(i>=0){mem.splice(i,1);return {changes:1};}return{changes:0}; }
  if (lower.startsWith("update payment_methods set")) {
    const row = getPaymentMethodMem().find((item) => String(item.id) === String(params[params.length - 1]));
    if (!row) return { changes: 0 };
    const fields = sql.match(/set\s+(.+)\s+where/i)?.[1].split(",") ?? [];
    let index = 0;
    for (const field of fields) {
      if (!field.includes("?")) continue;
      row[field.trim().split("=")[0].trim()] = params[index++];
    }
    return { changes: 1 };
  }
  if (lower.startsWith("insert into payment_methods")) {
    const mem = getPaymentMethodMem();
    const columns = (sql.match(/payment_methods\s*\(([^)]+)\)/i)?.[1] ?? "").split(",").map((column) => column.trim());
    const row: Row = {};
    columns.forEach((column, index) => { row[column] = params[index]; });
    if (mem.some((method) => String(method.id) === String(row.id))) throw new Error("UNIQUE constraint failed: payment_methods.id");
    mem.push(row);
    return { changes: 1 };
  }
  if (lower.startsWith("insert into agent_tokens")) { const mem=getTokenMem(), id=mem.length+1, cols=(sql.match(/agent_tokens\s*\(([^)]+)\)/i)?.[1]??"").split(",").map(v=>v.trim()), row:Row={id,is_active:1,created_at:new Date().toISOString()}; cols.forEach((c,i)=>row[c]=params[i]); mem.push(row); return {lastInsertRowid:id,changes:1}; }
  if (lower.startsWith("insert into newsletter_subscribers")) {const mem=getSubscriberMem(),id=Math.max(0,...mem.map((row)=>Number(row.id)||0))+1,columns=(sql.match(/newsletter_subscribers\s*\(([^)]+)\)/i)?.[1]??"").split(",").map((column)=>column.trim()),row:Row={id,status:"active",created_at:new Date().toISOString(),updated_at:new Date().toISOString()};columns.forEach((column,index)=>{row[column]=params[index]});if(mem.some((item)=>item.email===row.email))throw new Error("UNIQUE constraint failed: newsletter_subscribers.email");mem.push(row);return{lastInsertRowid:id,changes:1};}
  if (lower.startsWith("update agent_tokens set")) { const row=getTokenMem().find((r)=>String(r.id)===String(params[params.length-1])); if(!row)return {changes:0}; if(lower.includes("is_active=?"))row.is_active=params[0]; if(lower.includes("last_used_at=?"))row.last_used_at=params[0]; return {changes:1}; }
  if (lower.startsWith("insert into article_audit_log")) {const mem=getAuditMem(),id=Math.max(0,...mem.map((row)=>Number(row.id)||0))+1,columns=(sql.match(/article_audit_log\s*\(([^)]+)\)/i)?.[1]??"").split(",").map((column)=>column.trim()),row:Row={id};columns.forEach((column,index)=>{row[column]=params[index]});mem.push(row);return {lastInsertRowid:id,changes:1};}
  return { changes: 0 };
}

export class StockReservationError extends Error {
  constructor() {
    super("Stok atau status produk berubah. Muat ulang checkout.");
    this.name = "StockReservationError";
  }
}

export class OrderTransitionError extends Error {
  constructor() {
    super("Status pesanan sudah berubah. Muat ulang daftar pesanan.");
    this.name = "OrderTransitionError";
  }
}

export type AtomicOrderItem = {
  product_id: number;
  variant_id?: number;
  name: string;
  price: number;
  qty: number;
};

type AtomicOrderInput = {
  code: string;
  quoteId: string;
  customerName: string;
  customerWa: string;
  customerEmail: string | null;
  items: AtomicOrderItem[];
  subtotal: number;
  paymentMethod: string;
  paymentAccount: string;
  proofUrl: string;
};

export async function createOrderWithStock(input: AtomicOrderInput): Promise<void> {
  const d1 = getD1();
  if (d1) {
    const guardIds = input.items.map((item) => `${input.quoteId}:stock:${item.variant_id ?? item.product_id}`);
    const statements: D1Statement[] = [];
    input.items.forEach((item, index) => {
      if (item.variant_id) {
        statements.push(
          d1.prepare(
            "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM product_variants WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=?)) THEN 1 ELSE 0 END",
          ).bind(guardIds[index], item.variant_id, item.qty),
        );
      } else {
        statements.push(
          d1.prepare(
            "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=? AND is_active=1 AND (stock=-1 OR stock>=?)) THEN 1 ELSE 0 END",
          ).bind(guardIds[index], item.product_id, item.qty),
        );
      }
    });
    input.items.forEach((item) => {
      if (item.variant_id) {
        statements.push(
          d1.prepare(
            "UPDATE product_variants SET stock=CASE WHEN stock=-1 THEN -1 ELSE stock-? END, updated_at=datetime('now') WHERE id=?",
          ).bind(item.qty, item.variant_id),
        );
      } else {
        statements.push(
          d1.prepare(
            "UPDATE products SET stock=CASE WHEN stock=-1 THEN -1 ELSE stock-? END WHERE id=?",
          ).bind(item.qty, item.product_id),
        );
      }
    });
    const primaryVariantId = input.items.find((it) => it.variant_id)?.variant_id ?? null;
    statements.push(
      d1.prepare(
        "INSERT INTO orders (code,customer_name,customer_wa,customer_email,items,subtotal,payment_method,payment_account,proof_url,status,sales_channel,variant_id,quote_id,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,'web',?,?,datetime('now','+24 hours'))",
      ).bind(
        input.code,
        input.customerName,
        input.customerWa,
        input.customerEmail,
        JSON.stringify(input.items),
        input.subtotal,
        input.paymentMethod,
        input.paymentAccount,
        input.proofUrl,
        "pending",
        primaryVariantId,
        input.quoteId,
      ),
    );
    guardIds.forEach((guardId) => {
      statements.push(d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId));
    });

    try {
      await d1.batch(statements);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint/i.test(message)) throw new StockReservationError();
      throw error;
    }
  }

  const products = getSharedMem();
  for (const item of input.items) {
    const product = products.find((row) => Number(row.id) === item.product_id);
    const stock = Number(product?.stock ?? -1);
    if (!product || Number(product.is_active) === 0 || (stock !== -1 && stock < item.qty)) {
      throw new StockReservationError();
    }
  }
  const orders = getOrderMem();
  if (orders.some((order) => order.quote_id === input.quoteId || order.code === input.code)) {
    throw new Error("UNIQUE constraint failed: orders.quote_id");
  }
  for (const item of input.items) {
    const product = products.find((row) => Number(row.id) === item.product_id)!;
    if (Number(product.stock) !== -1) product.stock = Number(product.stock) - item.qty;
  }
  orders.push({
    id: Math.max(0, ...orders.map((order) => Number(order.id) || 0)) + 1,
    code: input.code,
    customer_name: input.customerName,
    customer_wa: input.customerWa,
    customer_email: input.customerEmail,
    items: JSON.stringify(input.items),
    subtotal: input.subtotal,
    payment_method: input.paymentMethod,
    payment_account: input.paymentAccount,
    proof_url: input.proofUrl,
    status: "pending",
    sales_channel: "web",
    variant_id: input.items.find((it) => it.variant_id)?.variant_id ?? null,
    quote_id: input.quoteId,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function transitionPendingOrder(
  code: string,
  status: "lunas" | "dibatalkan" | "kadaluarsa",
  adminNote: string | null,
  rawItems: { product_id: number; variant_id?: number; qty: number }[],
): Promise<void> {
  const productQuantities = new Map<number, number>();
  const variantQuantities = new Map<number, number>();
  rawItems.forEach((item) => {
    if (item.variant_id) {
      variantQuantities.set(item.variant_id, (variantQuantities.get(item.variant_id) ?? 0) + item.qty);
    } else {
      productQuantities.set(item.product_id, (productQuantities.get(item.product_id) ?? 0) + item.qty);
    }
  });

  const d1 = getD1();
  if (d1) {
    if (status === "dibatalkan" || status === "kadaluarsa") {
      const guardId = `${code}:transition:${status}`;
      const statements: D1Statement[] = [
        d1.prepare(
          "INSERT INTO operation_guards (operation_id,valid) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending') THEN 1 ELSE 0 END",
        ).bind(guardId, code),
      ];
      productQuantities.forEach((qty, productId) => {
        statements.push(
          d1.prepare("UPDATE products SET stock=stock+? WHERE id=? AND stock!=-1").bind(qty, productId),
        );
      });
      variantQuantities.forEach((qty, variantId) => {
        statements.push(
          d1.prepare("UPDATE product_variants SET stock=stock+?, updated_at=datetime('now') WHERE id=? AND stock!=-1").bind(qty, variantId),
        );
      });
      statements.push(
        d1.prepare(
          `UPDATE fulfillment_inventory
           SET status='available', order_code=NULL, reserved_at=NULL
           WHERE order_code=? AND status='reserved'`,
        ).bind(code),
        d1.prepare(
          `UPDATE orders
           SET status=?, admin_note=?,
               payment_status=CASE WHEN ?='kadaluarsa' THEN 'expired' ELSE 'failed' END,
               fulfillment_status='not_required', updated_at=datetime('now')
           WHERE code=? AND status='pending'`,
        ).bind(status, adminNote, status, code),
        d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
      );
      try {
        await d1.batch(statements);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/operation_guards|CHECK constraint/i.test(message)) throw new OrderTransitionError();
        throw error;
      }
    }
    const result = await d1.prepare(
      `UPDATE orders
       SET status=?, admin_note=?, payment_status='paid', updated_at=datetime('now')
       WHERE code=? AND status='pending'`,
    ).bind(status, adminNote, code).run();
    if (!result.meta?.changes) throw new OrderTransitionError();
    return;
  }

  const order = getOrderMem().find((row) => String(row.code) === code);
  if (!order || order.status !== "pending") throw new OrderTransitionError();
  if (status === "dibatalkan" || status === "kadaluarsa") {
    productQuantities.forEach((qty, productId) => {
      const product = getSharedMem().find((row) => Number(row.id) === productId);
      if (product && Number(product.stock) !== -1) product.stock = Number(product.stock) + qty;
    });
  }
  order.status = status;
  order.payment_status = status === "lunas" ? "paid" : status === "kadaluarsa" ? "expired" : "failed";
  if (status !== "lunas") order.fulfillment_status = "not_required";
  order.admin_note = adminNote;
  order.updated_at = new Date().toISOString();
}

export async function transitionPendingPaymentOrder(input: {
  orderCode: string;
  expectedTransactionStatus: "initializing" | "pending";
  transactionStatus: "failed" | "expired";
  orderStatus: "dibatalkan" | "kadaluarsa";
  paymentStatus: "failed" | "expired";
  items: { product_id: number; variant_id?: number; qty: number }[];
  lastError?: string | null;
}): Promise<boolean> {
  const productQuantities = new Map<number, number>();
  const variantQuantities = new Map<number, number>();
  input.items.forEach((item) => {
    if (item.variant_id) {
      variantQuantities.set(item.variant_id, (variantQuantities.get(item.variant_id) ?? 0) + item.qty);
    } else {
      productQuantities.set(item.product_id, (productQuantities.get(item.product_id) ?? 0) + item.qty);
    }
  });

  const d1 = getD1();
  if (d1) {
    const guardId = `${input.orderCode}:payment:${input.transactionStatus}`;
    const statements: D1Statement[] = [
      d1.prepare(
        `INSERT INTO operation_guards (operation_id,valid)
         SELECT ?, CASE WHEN
           EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending')
           AND EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=? AND status=?)
         THEN 1 ELSE 0 END`,
      ).bind(guardId, input.orderCode, input.orderCode, input.expectedTransactionStatus),
    ];

    productQuantities.forEach((qty, productId) => {
      statements.push(
        d1.prepare("UPDATE products SET stock=stock+? WHERE id=? AND stock!=-1").bind(qty, productId),
      );
    });
    variantQuantities.forEach((qty, variantId) => {
      statements.push(
        d1.prepare("UPDATE product_variants SET stock=stock+?, updated_at=datetime('now') WHERE id=? AND stock!=-1")
          .bind(qty, variantId),
      );
    });
    statements.push(
      d1.prepare(
        `UPDATE fulfillment_inventory
         SET status='available', order_code=NULL, reserved_at=NULL
         WHERE order_code=? AND status='reserved'`,
      ).bind(input.orderCode),
      d1.prepare(
        `UPDATE payment_transactions
         SET status=?, last_error=?, updated_at=datetime('now')
         WHERE order_code=? AND status=?`,
      ).bind(
        input.transactionStatus,
        input.lastError ?? null,
        input.orderCode,
        input.expectedTransactionStatus,
      ),
      d1.prepare(
        `UPDATE orders
         SET status=?, payment_status=?, fulfillment_status='not_required', updated_at=datetime('now')
         WHERE code=? AND status='pending'`,
      ).bind(input.orderStatus, input.paymentStatus, input.orderCode),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
    );

    try {
      await d1.batch(statements);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint/i.test(message)) return false;
      throw error;
    }
  }

  const order = getOrderMem().find((row) => String(row.code) === input.orderCode);
  if (!order || String(order.status) !== "pending") return false;
  await transitionPendingOrder(input.orderCode, input.orderStatus, null, input.items);
  order.payment_status = input.paymentStatus;
  order.fulfillment_status = "not_required";
  return true;
}

/** Atomically make KlikQRIS authoritative for both ledger and order. */
export async function transitionPendingPaymentToPaid(
  orderCode: string,
  providerPaidAt?: string | null,
): Promise<boolean> {
  const d1 = getD1();
  if (d1) {
    const guardId = `${orderCode}:payment:paid`;
    const statements: D1Statement[] = [
      d1.prepare(
        `INSERT INTO operation_guards (operation_id,valid)
         SELECT ?, CASE WHEN
           EXISTS(SELECT 1 FROM orders WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending'))
           AND EXISTS(SELECT 1 FROM payment_transactions WHERE order_code=? AND status IN ('pending','paid'))
         THEN 1 ELSE 0 END`,
      ).bind(guardId, orderCode, orderCode),
      d1.prepare(
        `UPDATE payment_transactions
         SET status='paid', paid_at=COALESCE(paid_at,?,datetime('now')),
             last_checked_at=datetime('now'), last_error=NULL, updated_at=datetime('now')
         WHERE order_code=? AND status IN ('pending','paid')`,
      ).bind(providerPaidAt ?? null, orderCode),
      d1.prepare(
        `UPDATE orders
         SET payment_status='paid', payment_method='klikqris', status='lunas', updated_at=datetime('now')
         WHERE code=? AND status='pending' AND payment_status IN ('unpaid','pending')`,
      ).bind(orderCode),
      d1.prepare("DELETE FROM operation_guards WHERE operation_id=?").bind(guardId),
    ];

    try {
      await d1.batch(statements);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/operation_guards|CHECK constraint|UNIQUE/i.test(message)) return false;
      throw error;
    }
  }

  const order = getOrderMem().find((row) => String(row.code) === orderCode);
  if (!order || String(order.status) !== "pending") return false;
  const txResult = await execRun(
    `UPDATE payment_transactions SET status='paid', paid_at=?, updated_at=datetime('now')
     WHERE order_code=? AND status='pending'`,
    providerPaidAt ?? new Date().toISOString(),
    orderCode,
  );
  if (!txResult.changes) return false;
  order.status = "lunas";
  order.payment_status = "paid";
  order.payment_method = "klikqris";
  order.updated_at = new Date().toISOString();
  return true;
}
