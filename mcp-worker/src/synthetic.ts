import type { CronEnv, PhaseOutcome } from "./cron";

export const SYNTH_TIMEOUT_MS = 10_000;
export const SYNTH_SLOW_MS = 4_000;
export const SYNTH_BUDGET_MS = 20_000;
type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
type Product = { id: number; slug: string; stock: number };
type Variant = { id: number; is_active: number; stock: number; min_qty?: number; max_qty?: number | null; buyer_field_key?: string | null; fulfillment_mode?: string; inventory_available?: number | null };

/** Fixed error labels only: neither response bodies nor tokens enter alarm state. */
export async function runSyntheticProbes(env: CronEnv, fetchFn: FetchFn = fetch, budgetMs = SYNTH_BUDGET_MS): Promise<PhaseOutcome[]> {
  const origin = env.AXVARA_API_ORIGIN.replace(/\/$/, "");
  const deadline = Date.now() + Math.max(0, Math.min(budgetMs, SYNTH_BUDGET_MS));
  let products: Product[] = [];
  const headers = { "user-agent": "axvara-synth/1.0" };
  async function probe(step: string, run: (signal: AbortSignal, request: FetchFn) => Promise<number>): Promise<PhaseOutcome> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { step, calls: 0, ok: false, status: 0, error: "tick_budget_exhausted", alarm: "none" };
    const start = Date.now();
    const controller = new AbortController();
    let calls = 0;
    let status = 0;
    const request: FetchFn = async (url, init) => {
      controller.signal.throwIfAborted();
      calls++;
      const response = await fetchFn(url, init);
      status = response.status;
      return response;
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      status = await Promise.race([
        run(controller.signal, request),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("probe_timeout")); }, Math.min(SYNTH_TIMEOUT_MS, remaining));
        }),
      ]);
      const duration = Date.now() - start;
      return { step, calls, status, ok: duration <= SYNTH_SLOW_MS, alarm: duration > SYNTH_SLOW_MS ? "soft" : "hard", ...(duration > SYNTH_SLOW_MS ? { error: `slow_${duration}ms` } : {}) };
    } catch (error) {
      return { step, calls, status, ok: false, alarm: "hard", error: error instanceof Error && error.message === "probe_timeout" ? "probe_timeout" : "probe_contract_or_fetch_failed" };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  const [home, catalog] = await Promise.all([
    probe("synth:home", async (signal, request) => {
      const res = await request(`${origin}/`, { headers: { ...headers, accept: "text/html" }, redirect: "manual", signal });
      if (res.status !== 200 || !res.headers.get("content-type")?.includes("text/html")) throw new Error("contract");
      const body = await res.text();
      if (!body.includes("AXVARA") || /<title[^>]*>[^<]*maintenance|data-maintenance|sedang (?:dalam )?pemeliharaan/i.test(body)) throw new Error("contract");
      return res.status;
    }),
    probe("synth:catalog", async (signal, request) => {
      const res = await request(`${origin}/api/products?active=1`, { headers: { ...headers, accept: "application/json" }, redirect: "manual", signal });
      if (res.status !== 200) throw new Error("contract");
      const body = await res.json() as { products?: (Omit<Product, "id"> & { id: number | string })[] };
      if (!Array.isArray(body?.products) || !body.products.length) throw new Error("contract");
      // The public list uses string IDs; PDPs and the quote target use numbers.
      products = body.products.map(p => {
        const id = typeof p?.id === "string" ? Number(p.id) : p?.id;
        if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1
          || (typeof p.id === "string" && String(id) !== p.id)
          || typeof p.slug !== "string" || !p.slug) throw new Error("contract");
        return { id, slug: p.slug, stock: p.stock };
      });
      return res.status;
    }),
  ]);
  // Failed catalog means the quote was not assessed, not that checkout failed.
  if (!products.length) return [home, catalog, {
    step: "synth:quote", calls: 0, ok: false, status: 0, error: "catalog_unavailable", alarm: "none",
  }];
  const quote = await probe("synth:quote", async (signal, request) => {
    if (!env.AXVARA_CRON_SECRET) throw new Error("contract");
    // ponytail: inspect at most three ready PDPs; widen only if skipped buyer-field products dominate.
    let target: { product_id: number; variant_id?: number; qty: number } = { product_id: products[0].id, qty: 1 };
    for (const product of products.filter(p => p.stock === -1 || p.stock > 0).slice(0, 3)) {
      const res = await request(`${origin}/api/catalog?slug=${encodeURIComponent(product.slug)}`, { headers, redirect: "manual", signal });
      if (res.status !== 200) throw new Error("contract");
      const body = await res.json() as { product?: { id: number; variants: Variant[] } };
      if (body?.product?.id !== product.id || !Array.isArray(body.product.variants)) throw new Error("contract");
      const variant = body.product.variants.find(v => {
        const qty = Math.max(1, v.min_qty ?? 1);
        return Number.isSafeInteger(v.id) && v.id > 0 && v.is_active === 1 && !v.buyer_field_key
          && Number.isInteger(qty) && qty <= 100 && (v.max_qty == null || qty <= v.max_qty)
          && (v.stock === -1 || v.stock >= qty)
          && (v.fulfillment_mode !== "unique" || (v.inventory_available ?? 0) >= qty);
      });
      if (variant) { target = { product_id: product.id, variant_id: variant.id, qty: Math.max(1, variant.min_qty ?? 1) }; break; }
    }
    const res = await request(`${origin}/api/checkout/quote`, {
      method: "POST", redirect: "manual", signal,
      headers: { ...headers, "content-type": "application/json", "x-axvara-synthetic": "1", authorization: `Bearer ${env.AXVARA_CRON_SECRET}` },
      body: JSON.stringify({ items: [target] }),
    });
    const body = await res.json() as { ok?: boolean; quoteToken?: string; paymentMethods?: { id?: string; available?: boolean }[]; issues?: { type?: string; message?: string }[] };
    if (res.status === 409 && body?.ok === false && Array.isArray(body.issues) && body.issues.length > 0
      && body.issues.every(issue => ["missing", "inactive", "out_of_stock", "insufficient_stock", "below_minimum", "variant_required", "invalid_quantity"].includes(issue?.type ?? "") && typeof issue.message === "string")) return res.status;
    if (res.status !== 200 || body?.ok !== true || typeof body.quoteToken !== "string" || body.quoteToken.length <= 20
      || !Array.isArray(body.paymentMethods) || !body.paymentMethods.some(m => m?.id === "qris" && m.available === true)) throw new Error("contract");
    return res.status;
  });
  return [home, catalog, quote];
}
