// Edge-safe DB — prod: D1 binding, dev: in-memory seed from products.ts
// No fs / better-sqlite3 imports — fully edge-compatible for @cloudflare/next-on-pages.
//
// Modul ini menjadi SATU-SATUNYA rumah untuk state in-memory mode dev
// (__AXVARA_MEM, __AXVARA_ORDERS, dst). Helper order (createOrderWithStock,
// transisi status) mengimpor accessor state dari sini alih-alih menyalinnya,
// supaya tidak ada dua salinan store yang bisa desinkron saat dev tanpa D1.
// PURE MOVE: seluruh logika query fallback identik dengan src/lib/db.ts lama.

import type { D1 } from "./types";

export function getD1(): D1 | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const env = process.env as unknown as Record<string, unknown>;
  return (g.DB as D1 | undefined) ?? (env.DB as D1 | undefined) ?? null;
}

// ---- In-memory fallback (dev without D1) ----
import { products as seedProducts } from "@/lib/products";
import { articleSeedRows } from "@/lib/article-seeds";
type Row = Record<string, unknown>;

// diekspor: dipakai helper order untuk memutasi stok/inventory pada mode dev.
export function getSharedMem(): Row[] {
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
  // Query SEO PDP / sitemap (server component, issue #11) memakai fallback
  // in-memory saat dev tanpa D1: sediakan varian default dari kolom produk
  // agar sitemap, metadata, dan JSON-LD tetap terisi di dev.
  if (lower.includes("from product_variants") || lower.includes("join products p on")) {
    const slug = String(params[0] ?? "");
    const product = getSharedMem().find((r) => String(r.slug) === slug && Number(r.is_active) !== 0);
    if (!product) return [];
    return [{ price: product.price, compare_price: product.compare_price ?? null, stock: product.stock ?? -1 }];
  }
  if (lower.includes("from products")) {
    let rows = [...getSharedMem()];
    if (lower.includes("is_active=1")) rows = rows.filter((r) => (r.is_active as number) !== 0);
    if (lower.includes("c.slug=?") && params.length) {
      rows = rows.filter((r) => r.cat_slug === String(params[0]));
      params = params.slice(1);
    }
    if (lower.includes("p.slug=?") && params.length) {
      rows = rows.filter((r) => String(r.slug) === String(params[0]));
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
  if (lower.includes("from store_settings")) return [...getStoreSettingsMem()];
  if (lower.includes("from agent_tokens")) return [...getTokenMem()].sort((a,b)=>String(b.created_at??"").localeCompare(String(a.created_at??"")));
  if (lower.includes("from article_audit_log")) return [...getAuditMem()].sort((a,b)=>String(b.created_at??"").localeCompare(String(a.created_at??""))).slice(0,100);
  return [];
}

// diekspor: dipakai helper order untuk membaca/menulis order pada mode dev.
export function getOrderMem(): Row[] {
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
    { id: "qris", label: "QRIS Dinamis", account_number: "", account_name: "DANA Business", qris_url: null, is_active: 1, sort_order: 1 },
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
function getStoreSettingsMem(): Row[] {
  const g = process as unknown as { __AXVARA_STORE_SETTINGS?: Row[] };
  if (!g.__AXVARA_STORE_SETTINGS) g.__AXVARA_STORE_SETTINGS = [
    { key: "store_name", value: "AXVARA" },
    { key: "tagline", value: "Toko akun premium, AI gateway, dan tools pro." },
    { key: "whatsapp_number", value: "089519388264" },
    { key: "support_hours", value: "09.00–23.00 WIB" },
    { key: "footer_text", value: "AXVARA adalah third-party independen, tidak terafiliasi dengan brand manapun." },
    { key: "logo_url", value: "" },
  ];
  return g.__AXVARA_STORE_SETTINGS;
}

export async function queryFirst(sql: string, ...params: unknown[]): Promise<Row | undefined> {
  const d1 = getD1();
  if (d1) return (await d1.prepare(sql).bind(...params).first()) as Row | undefined;
  const lower = sql.toLowerCase();
  // Query SEO PDP (server component, issue #11) memakai fallback in-memory
  // saat dev tanpa D1: sediakan varian default dari kolom produk agar
  // halaman aktif, metadata, dan JSON-LD tetap terisi di dev.
  if (lower.includes("from product_variants") || lower.includes("join products p on")) {
    const slug = String(params[0] ?? "");
    const product = getSharedMem().find((r) => String(r.slug) === slug && Number(r.is_active) !== 0);
    if (!product) return undefined;
    return { price: product.price, compare_price: product.compare_price ?? null, stock: product.stock ?? -1 };
  }
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
  if (lower.startsWith("insert into store_settings")) {
    const key = String(params[0]);
    const value = String(params[1] ?? "");
    const mem = getStoreSettingsMem();
    const existing = mem.find((row) => row.key === key);
    if (existing) existing.value = value;
    else mem.push({ key, value });
    return { changes: 1 };
  }
  if (lower.startsWith("update agent_tokens set")) { const row=getTokenMem().find((r)=>String(r.id)===String(params[params.length-1])); if(!row)return {changes:0}; if(lower.includes("is_active=?"))row.is_active=params[0]; if(lower.includes("last_used_at=?"))row.last_used_at=params[0]; return {changes:1}; }
  if (lower.startsWith("insert into article_audit_log")) {const mem=getAuditMem(),id=Math.max(0,...mem.map((row)=>Number(row.id)||0))+1,columns=(sql.match(/article_audit_log\s*\(([^)]+)\)/i)?.[1]??"").split(",").map((column)=>column.trim()),row:Row={id};columns.forEach((column,index)=>{row[column]=params[index]});mem.push(row);return {lastInsertRowid:id,changes:1};}
  return { changes: 0 };
}
