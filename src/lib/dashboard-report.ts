import { queryAll } from "@/lib/db";
import { revenuePaidAtWibSql, todayWibDateString, weekWibStartDateString } from "@/lib/revenue";
import { fillDailySeries } from "@/lib/dashboard-profit";

export type ReportPeriod = "today" | "week" | "month";
export type ReportBucket = { orders: number; revenue: number; cost: number; profit: number };
export type ReportPoint = ReportBucket & { date: string };
export type PeriodReport = ReportBucket & {
  estimated_orders: number;
  series: ReportPoint[];
  suppliers: Record<"wr" | "sk" | "manual" | "pedia", ReportBucket>;
  channels: Record<"web" | "telegram" | "whatsapp", ReportBucket>;
  top_products: { name: string; qty: number; revenue: number; cost: number; profit: number }[];
};
const bucket = (): ReportBucket => ({ orders: 0, revenue: 0, cost: 0, profit: 0 });
const emptyReport = (): PeriodReport => ({ ...bucket(), estimated_orders: 0, series: [],
  suppliers: { wr: bucket(), sk: bucket(), manual: bucket(), pedia: bucket() },
  channels: { web: bucket(), telegram: bucket(), whatsapp: bucket() }, top_products: [] });

/** One bounded aggregate response. All panels derive from the same paid item facts.
 * Supplier totals and QRIS rounding remainders are allocated exactly once.
 * Missing historical cost snapshots use the catalog and remain estimates.
 * D1 limits each compound SELECT to five terms. Keep totals in their own
 * CTE so all six output kinds still share one query/materialized fact set.
 */
export function financialReportSql(now = new Date()): string {
  const today = todayWibDateString(now), week = weekWibStartDateString(now), month = `${today.slice(0, 7)}-01`;
  return `WITH
  paid AS MATERIALIZED (
    SELECT o.*, CAST(ROUND(COALESCE(pt.payable_amount,o.subtotal)) AS INTEGER) amount,
      ${revenuePaidAtWibSql("o")} paid_wib,
      CASE WHEN COALESCE(o.order_kind,'market')='pedia' OR NOT json_valid(o.items)
          OR json_array_length(o.items)=0
        THEN json_array(json_object('name',COALESCE(json_extract(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END,'$[0].name'),'Pesanan'),
          'product_id',NULL,'variant_id',o.variant_id,'qty',1,'price',o.subtotal))
        ELSE o.items END report_items
    FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
    LEFT JOIN (SELECT order_code,MAX(reviewed_at) reviewed_at FROM payment_proofs
      WHERE status='approved' GROUP BY order_code) pp ON pp.order_code=o.code WHERE o.status='lunas'
  ), lines AS (
    SELECT o.code, o.amount, o.order_kind, o.paid_wib, o.sales_channel,
      CAST(j.key AS INTEGER) item_index, json_extract(j.value,'$.name') name,
      COALESCE(json_extract(j.value,'$.product_id'),fi.product_id) product_id,
      COALESCE(json_extract(j.value,'$.variant_id'),fi.variant_id,o.variant_id) variant_id,
      MAX(1,CAST(COALESCE(json_extract(j.value,'$.qty'),fi.qty,1) AS INTEGER)) qty,
      MAX(0,COALESCE(json_extract(j.value,'$.price'),0)) * MAX(1,CAST(COALESCE(json_extract(j.value,'$.qty'),fi.qty,1) AS INTEGER)) gross,
      s.source snapshot_source, s.unit_cost snapshot_cost, s.supplier_variant_id snapshot_supplier_id,
      pv.manual_cost, pv.wr_variant_id, pv.sk_variant_id, fi.wr_link_id, fi.sk_link_id, fi.id fi_id
    FROM paid o JOIN json_each(o.report_items) j
    LEFT JOIN order_item_costs s ON s.order_code=o.code AND s.item_index=CAST(j.key AS INTEGER)
    LEFT JOIN fulfillment_items fi ON fi.order_code=o.code AND fi.item_index=CAST(j.key AS INTEGER)
    LEFT JOIN product_variants pv ON pv.id=COALESCE(json_extract(j.value,'$.variant_id'),fi.variant_id,o.variant_id)
  ), bindings AS (
    SELECT l.*,
      (SELECT w.id FROM wr_order_links w WHERE w.order_code=l.code AND
        (w.id=l.wr_link_id OR w.fulfillment_item_id=l.fi_id OR
         w.wr_variant_id=COALESCE(CASE WHEN l.snapshot_source='wr' THEN l.snapshot_supplier_id END,l.wr_variant_id,
           (SELECT wr_variant_id FROM wr_variants WHERE axvara_variant_id=l.variant_id LIMIT 1)) OR
         (l.product_id IS NULL AND COALESCE(l.order_kind,'market')!='pedia')) ORDER BY w.id LIMIT 1) wl_id,
      (SELECT s.id FROM sk_order_links s WHERE s.order_code=l.code AND
        (s.id=l.sk_link_id OR s.fulfillment_item_id=l.fi_id OR
         s.sk_variant_id=COALESCE(CASE WHEN l.snapshot_source='sk' THEN l.snapshot_supplier_id END,l.sk_variant_id,
           (SELECT sk_variant_id FROM sk_products WHERE axvara_variant_id=l.variant_id LIMIT 1)) OR
         (l.product_id IS NULL AND COALESCE(l.order_kind,'market')!='pedia')) ORDER BY s.id LIMIT 1) sl_id
    FROM lines l
  ), pools AS (
    SELECT l.*,
      CASE WHEN COALESCE(l.order_kind,'market')='pedia' THEN 'pedia' WHEN w.id IS NOT NULL THEN 'wr'
        WHEN s.id IS NOT NULL THEN 'sk' ELSE COALESCE(l.snapshot_source,
          CASE WHEN l.wr_variant_id IS NOT NULL THEN 'wr' WHEN l.sk_variant_id IS NOT NULL THEN 'sk' ELSE 'manual' END) END source,
      CASE WHEN COALESCE(l.order_kind,'market')='pedia' THEN ROUND(COALESCE(pi.supplier_charge,pi.supplier_rate_snapshot*pi.quantity/1000.0,0))
        WHEN w.id IS NOT NULL THEN ROUND(w.wr_cost) WHEN s.id IS NOT NULL THEN ROUND(s.sk_cost) ELSE NULL END cost_pool,
      CASE WHEN COALESCE(l.order_kind,'market')='pedia' THEN pi.supplier_charge IS NULL
        WHEN w.id IS NOT NULL THEN w.status NOT IN ('completed','failed')
        WHEN s.id IS NOT NULL THEN s.status NOT IN ('completed','failed')
        ELSE l.snapshot_cost IS NULL OR COALESCE(l.snapshot_source,'manual')!='manual' END estimated,
      COALESCE(l.snapshot_cost,CASE WHEN l.wr_variant_id IS NOT NULL THEN
        (SELECT wr_price FROM wr_variants WHERE wr_variant_id=l.wr_variant_id)
        WHEN l.sk_variant_id IS NOT NULL THEN (SELECT sk_price FROM sk_products WHERE sk_variant_id=l.sk_variant_id)
        ELSE l.manual_cost END,0)*l.qty own_cost,
      COALESCE(CAST(w.id AS TEXT),CAST(s.id AS TEXT),'own:'||l.item_index) pool_key
    FROM bindings l LEFT JOIN wr_order_links w ON w.id=l.wl_id LEFT JOIN sk_order_links s ON s.id=l.sl_id
    LEFT JOIN pedia_order_items pi ON pi.order_code=l.code
  ), shares AS (
    SELECT p.*,
      CASE WHEN SUM(gross) OVER(PARTITION BY code)>0 THEN
        CAST(amount*gross/SUM(gross) OVER(PARTITION BY code) AS INTEGER)
        ELSE CAST(amount*1.0/COUNT(*) OVER(PARTITION BY code) AS INTEGER) END revenue_share,
      CASE WHEN cost_pool IS NULL THEN own_cost ELSE
        CAST(cost_pool*qty*1.0/SUM(qty) OVER(PARTITION BY code,source,pool_key) AS INTEGER) END cost_share,
      ROW_NUMBER() OVER(PARTITION BY code ORDER BY item_index DESC) last_revenue,
      ROW_NUMBER() OVER(PARTITION BY code,source,pool_key ORDER BY item_index DESC) last_cost
    FROM pools p
  ), facts AS MATERIALIZED (
    SELECT *,
      CASE WHEN last_revenue=1 THEN amount-SUM(revenue_share) OVER(PARTITION BY code)+revenue_share ELSE revenue_share END revenue,
      CASE WHEN cost_pool IS NOT NULL AND last_cost=1 THEN cost_pool-SUM(cost_share) OVER(PARTITION BY code,source,pool_key)+cost_share ELSE cost_share END cost
    FROM shares
  ), periods(period,start) AS (VALUES ('today','${today}'),('week','${week}'),('month','${month}'),('total','0000-01-01')),
  scoped AS MATERIALIZED (SELECT f.*,p.period FROM facts f JOIN periods p ON p.period='total' OR (date(f.paid_wib)>=p.start
    AND date(f.paid_wib)<='${today}')),
  top AS (SELECT period,COALESCE(name,'Produk') label,SUM(qty) qty,SUM(revenue) revenue,SUM(cost) cost,
    ROW_NUMBER() OVER(PARTITION BY period ORDER BY SUM(revenue-cost) DESC,MIN(item_index),COALESCE(name,'Produk')) rank
    FROM scoped GROUP BY period,product_id,variant_id,COALESCE(name,'Produk')),
  totals AS (
  SELECT 'summary' kind,period,'' label,COUNT(DISTINCT code) orders,SUM(revenue) revenue,SUM(cost) cost,
    COUNT(DISTINCT CASE WHEN estimated THEN code END) estimated,0 qty FROM scoped GROUP BY period
  UNION ALL SELECT 'supplier',period,source,COUNT(DISTINCT code),SUM(revenue),SUM(cost),0,0 FROM scoped GROUP BY period,source
  UNION ALL SELECT 'channel',period,CASE WHEN sales_channel IN ('telegram','whatsapp') THEN sales_channel ELSE 'web' END,
    COUNT(DISTINCT code),SUM(revenue),SUM(cost),0,0 FROM scoped GROUP BY period,CASE WHEN sales_channel IN ('telegram','whatsapp') THEN sales_channel ELSE 'web' END
  )
  SELECT * FROM totals
  UNION ALL SELECT 'top',period,label,0,revenue,cost,0,qty FROM top WHERE rank<=5
  UNION ALL SELECT 'daily','',date(paid_wib),COUNT(DISTINCT code),SUM(revenue),SUM(cost),0,0 FROM facts
    WHERE date(paid_wib)>=MIN('${month}',date('${today}','-29 days')) GROUP BY date(paid_wib)
  UNION ALL SELECT 'hourly','today',strftime('%H:00',paid_wib),COUNT(DISTINCT code),SUM(revenue),SUM(cost),0,0 FROM facts
    WHERE date(paid_wib)='${today}' GROUP BY strftime('%H:00',paid_wib)`;
}

export async function readFinancialReport(now = new Date()) {
  const rows = await queryAll(financialReportSql(now));
  const reports: Record<ReportPeriod | "total", PeriodReport> = { today: emptyReport(), week: emptyReport(), month: emptyReport(), total: emptyReport() };
  const daily = new Map<string, ReportPoint>(), hourly = new Map<string, ReportPoint>();
  for (const row of rows) {
    const value = { orders: Number(row.orders || 0), revenue: Number(row.revenue || 0), cost: Number(row.cost || 0), profit: Number(row.revenue || 0)-Number(row.cost || 0) };
    const key = String(row.label), report = reports[row.period as keyof typeof reports];
    if (row.kind === "daily") daily.set(key, { date: key, ...value });
    else if (row.kind === "hourly") hourly.set(key, { date: key, ...value });
    else if (report && row.kind === "summary") Object.assign(report, value, { estimated_orders: Number(row.estimated || 0) });
    else if (report && row.kind === "supplier" && key in report.suppliers) report.suppliers[key as keyof typeof report.suppliers] = value;
    else if (report && row.kind === "channel" && key in report.channels) report.channels[key as keyof typeof report.channels] = value;
    else if (report && row.kind === "top") report.top_products.push({ name: key, qty: Number(row.qty || 0), ...value });
  }
  for (const report of Object.values(reports)) report.top_products.sort((a,b)=>b.profit-a.profit);
  const today = todayWibDateString(now), week = weekWibStartDateString(now);
  const days = (start: string) => {
    const result: ReportPoint[] = [];
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0,10)<=today; d = new Date(d.getTime()+86400000)) {
      const date = d.toISOString().slice(0,10); result.push(daily.get(date) ?? { date, ...bucket() });
    }
    return result;
  };
  reports.week.series = days(week); reports.month.series = days(`${today.slice(0,7)}-01`);
  reports.today.series = Array.from({ length: new Date(now.getTime()+7*3600000).getUTCHours()+1 }, (_,i) => {
    const date = `${String(i).padStart(2,'0')}:00`; return hourly.get(date) ?? { date, ...bucket() };
  });
  return { reports, daily: fillDailySeries([...daily.values()],now) };
}
