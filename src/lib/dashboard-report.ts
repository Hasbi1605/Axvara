import { getD1, queryAll, type D1 } from "@/lib/db";
import { FINANCIAL_SNAPSHOT_TTL_MS, readPrivateFinancialSnapshot } from "@/lib/admin-report-cache";
import { resolveReportRange, revenuePaidAtWibSql, todayWibDateString, weekWibStartDateString, type ReportSelection } from "@/lib/revenue";
import { fillDailySeries } from "@/lib/dashboard-profit";
import { emptyExpenseTotals, type ReportFinance, type ReportPointFinance, type ExpenseCategory, type PaymentFeeSettings } from "@/lib/finance/types";
import { defaultPaymentFees, readPaymentFees, financeCacheRevision } from "@/lib/finance/payment-fees";
import { GAMES_ORDER_LABEL_SQL } from "@/lib/games/order-display";

export type ReportPeriod = "today" | "week" | "month";
export type ReportBucket = { orders: number; revenue: number; cost: number; profit: number };
export type ReportPoint = ReportBucket & ReportPointFinance & { date: string };
export type PeriodReport = ReportBucket & ReportFinance & {
  estimated_orders: number;
  merchant_paid?: number;
  credit_used?: number;
  series: ReportPoint[];
  suppliers: Record<"wr" | "sk" | "manual" | "pedia" | "games" | "tunvn" | "aivault" | "storebat" | "mirai", ReportBucket>;
  channels: Record<"web" | "telegram" | "whatsapp", ReportBucket>;
  top_products: { name: string; qty: number; revenue: number; cost: number; profit: number }[];
};
const bucket = (): ReportBucket => ({ orders: 0, revenue: 0, cost: 0, profit: 0 });
const pointFinance = (): ReportPointFinance => ({ expenses: 0, payment_fees: 0, net_profit: 0 });
const finance = (): ReportFinance => ({ payment_fees: 0, unique_code_bonus: 0, refund_expenses: 0, operational_expenses: 0, net_profit: 0, expenses_by_category: emptyExpenseTotals(), estimated_order_codes: [], estimated_jaspay_order_codes: [] });
export type SelectedReport = PeriodReport & { from: string; to: string; timezone: "Asia/Jakarta"; generated_at: string };
const emptyReport = (): PeriodReport => ({ ...bucket(), ...finance(), estimated_orders: 0, merchant_paid: 0, credit_used: 0, series: [],
  suppliers: { wr: bucket(), sk: bucket(), manual: bucket(), pedia: bucket(), games: bucket(), tunvn: bucket(), aivault: bucket(), storebat: bucket(), mirai: bucket() },
  channels: { web: bucket(), telegram: bucket(), whatsapp: bucket() }, top_products: [] });

export function emptySelectedReport(selection: ReportSelection, now = new Date()): SelectedReport {
  const range = resolveReportRange(selection, now);
  const report: SelectedReport = { ...emptyReport(), ...range, timezone: "Asia/Jakarta", generated_at: now.toISOString() };
  if (selection === "today") {
    report.series = Array.from({ length: new Date(now.getTime() + 7 * 3600000).getUTCHours() + 1 }, (_, i) => ({ date: `${String(i).padStart(2, "0")}:00`, ...bucket(), ...pointFinance() }));
  } else {
    for (let d = new Date(`${range.from}T00:00:00Z`); d.toISOString().slice(0, 10) <= range.to; d = new Date(d.getTime() + 86400000))
      report.series.push({ date: d.toISOString().slice(0, 10), ...bucket(), ...pointFinance() });
  }
  return report;
}

/** One bounded aggregate response. All panels derive from the same paid item facts.
 * Supplier totals and QRIS rounding remainders are allocated exactly once.
 * Missing historical cost snapshots use the catalog and remain estimates.
 * D1 limits compound SELECTs to five terms and caps subquery expansion.
 * Read scoped totals once for all dimensions to avoid multiplying CTE expansion.
 * TUNVN/AIVault costs come from their durable order links (already per-line, not
 * per unit); FX is frozen on the durable link, with legacy NULL fallback.
 */
export function financialReportSql(now = new Date(), selection?: ReportSelection, fees: PaymentFeeSettings = defaultPaymentFees()): string {
  const today = todayWibDateString(now), week = weekWibStartDateString(now), month = `${today.slice(0, 7)}-01`;
  const range = selection === undefined ? undefined : resolveReportRange(selection, now);
  return `WITH
  paid AS MATERIALIZED (
    SELECT o.*, CAST(ROUND(COALESCE(pt.payable_amount,o.subtotal) +
        CASE WHEN o.order_kind='pedia' AND pt.payable_amount IS NOT NULL THEN COALESCE(pi.credit_used,0) ELSE 0 END) AS INTEGER) amount,
      CAST(ROUND(COALESCE(pt.payable_amount,MAX(0,o.subtotal-CASE WHEN o.order_kind='pedia' THEN COALESCE(pi.credit_used,0) ELSE 0 END))) AS INTEGER) merchant_amount,
      CASE WHEN o.order_kind='pedia' THEN COALESCE(pi.credit_used,0) ELSE 0 END order_credit,
      ${revenuePaidAtWibSql("o")} paid_wib,
      COALESCE(pt.gateway_fee,0) + CASE COALESCE(pt.provider,CASE WHEN pt.order_code IS NOT NULL THEN 'dana' END)
        WHEN 'gopay' THEN ROUND(COALESCE(pt.payable_amount,o.subtotal)*${fees.mdr_bps.gopay}/10000.0)
        WHEN 'klikqris' THEN ROUND(COALESCE(pt.payable_amount,o.subtotal)*${fees.mdr_bps.klikqris}/10000.0)
        WHEN 'dana' THEN ROUND(COALESCE(pt.payable_amount,o.subtotal)*${fees.mdr_bps.dana}/10000.0) ELSE 0 END payment_fee,
      CASE WHEN pt.order_code IS NOT NULL AND COALESCE(pt.provider,'dana') IN ('gopay','klikqris','dana') THEN MAX(0,pt.payable_amount-o.subtotal) ELSE 0 END unique_bonus,
      CASE WHEN o.order_kind='games' THEN json_array(json_object('name',${GAMES_ORDER_LABEL_SQL},
          'product_id',gi.product_id,'qty',1,'price',COALESCE(gi.unit_price,o.subtotal)))
        WHEN COALESCE(o.order_kind,'market')='pedia' OR NOT json_valid(o.items)
          OR json_array_length(o.items)=0
        THEN json_array(json_object('name',COALESCE(json_extract(CASE WHEN json_valid(o.items) THEN o.items ELSE '[]' END,'$[0].name'),'Pesanan'),
          'product_id',NULL,'variant_id',o.variant_id,'qty',1,'price',o.subtotal))
        ELSE o.items END report_items
    FROM orders o LEFT JOIN payment_transactions pt ON pt.order_code=o.code
    LEFT JOIN pedia_order_items pi ON pi.order_code=o.code
    LEFT JOIN games_order_items gi ON gi.order_code=o.code AND o.order_kind='games'
    LEFT JOIN games_products gp ON gp.id=gi.product_id
    LEFT JOIN games_meta gm ON gm.slug=gp.game_slug
    LEFT JOIN (SELECT order_code,MAX(reviewed_at) reviewed_at FROM payment_proofs
      WHERE status='approved' GROUP BY order_code) pp ON pp.order_code=o.code WHERE o.status='lunas'
      ${range ? `AND date(${revenuePaidAtWibSql("o")}) BETWEEN '${range.from}' AND '${range.to}'` : ""}
  ), lines AS (
    SELECT o.code, o.amount, o.merchant_amount, o.order_credit, o.payment_fee, o.unique_bonus, o.order_kind, o.paid_wib, o.sales_channel,
      CAST(j.key AS INTEGER) item_index, json_extract(j.value,'$.name') name,
      COALESCE(json_extract(j.value,'$.product_id'),fi.product_id) product_id,
      COALESCE(json_extract(j.value,'$.variant_id'),fi.variant_id,o.variant_id) variant_id,
      MAX(1,CAST(COALESCE(json_extract(j.value,'$.qty'),fi.qty,1) AS INTEGER)) qty,
      MAX(0,COALESCE(json_extract(j.value,'$.price'),0)) * MAX(1,CAST(COALESCE(json_extract(j.value,'$.qty'),fi.qty,1) AS INTEGER)) gross,
      s.source snapshot_source, s.unit_cost snapshot_cost, s.supplier_variant_id snapshot_supplier_id,
      pv.manual_cost, pv.wr_variant_id, pv.sk_variant_id, fi.wr_link_id, fi.sk_link_id, fi.id fi_id,
      CASE WHEN fi.status='delivered' THEN 1 ELSE 0 END fi_delivered,
      pv.sku pv_sku, pv.aivault_service_id pv_aivault_service_id,
      pv.storebat_product_id pv_storebat_product_id,pv.storebat_cost_usd pv_storebat_cost,pv.storebat_fx_idr_per_usd pv_storebat_fx,
      pv.mirai_package_code pv_mirai_package_code,pv.mirai_cost_usdt pv_mirai_cost,pv.mirai_fx_idr_per_usdt pv_mirai_fx,
      pv.tunvn_fx_idr_per_usdt pv_tunvn_fx, pv.tunvn_cost_usdt pv_tunvn_cost,
      json_type(j.value,'$.tunvn_eligibility') tunvn_elig,
      json_extract(j.value,'$.tunvn_eligibility.cost_usdt') tunvn_elig_cost,
      json_extract(j.value,'$.tunvn_eligibility.source_product_id') tunvn_elig_source_id,
      json_type(j.value,'$.aivault_eligibility') aivault_elig,
      json_extract(j.value,'$.aivault_eligibility.cost_usd') aivault_elig_cost,
      json_type(j.value,'$.storebat_eligibility') storebat_elig,
      json_extract(j.value,'$.storebat_eligibility.cost_usd') storebat_elig_cost,
      json_extract(j.value,'$.storebat_eligibility.fx_idr_per_usd') storebat_elig_fx,
      json_type(j.value,'$.mirai_eligibility') mirai_elig,
      json_extract(j.value,'$.mirai_eligibility.cost_usdt') mirai_elig_cost
    FROM paid o JOIN json_each(o.report_items) j
    LEFT JOIN order_item_costs s ON s.order_code=o.code AND s.item_index=CAST(j.key AS INTEGER)
    LEFT JOIN fulfillment_items fi ON fi.order_code=o.code AND fi.item_index=CAST(j.key AS INTEGER)
    LEFT JOIN product_variants pv ON pv.id=COALESCE(json_extract(j.value,'$.variant_id'),fi.variant_id,o.variant_id)
  ), bindings AS MATERIALIZED (
    SELECT l.*,
      (SELECT w.id FROM wr_order_links w WHERE w.order_code=l.code AND
        (w.id=l.wr_link_id OR w.fulfillment_item_id=l.fi_id OR (w.fulfillment_item_id IS NULL AND (
         w.wr_variant_id=COALESCE(CASE WHEN l.snapshot_source='wr' THEN l.snapshot_supplier_id END,l.wr_variant_id,
           (SELECT wr_variant_id FROM wr_variants WHERE axvara_variant_id=l.variant_id LIMIT 1)) OR
         (l.product_id IS NULL AND COALESCE(l.order_kind,'market')!='pedia')))) ORDER BY (w.status='completed') DESC,w.id DESC LIMIT 1) wl_id,
      (SELECT s.id FROM sk_order_links s WHERE s.order_code=l.code AND
        (s.id=l.sk_link_id OR s.fulfillment_item_id=l.fi_id OR (s.fulfillment_item_id IS NULL AND (
         s.sk_variant_id=COALESCE(CASE WHEN l.snapshot_source='sk' THEN l.snapshot_supplier_id END,l.sk_variant_id,
           (SELECT sk_variant_id FROM sk_products WHERE axvara_variant_id=l.variant_id LIMIT 1)) OR
         (l.product_id IS NULL AND COALESCE(l.order_kind,'market')!='pedia')))) ORDER BY (s.status='completed') DESC,s.id DESC LIMIT 1) sl_id
    FROM lines l
  ), pools AS (
    SELECT l.*,
      CASE WHEN l.order_kind='games' THEN 'games'
        WHEN COALESCE(l.order_kind,'market')='pedia' THEN 'pedia' WHEN w.id IS NOT NULL THEN 'wr'
        WHEN s.id IS NOT NULL THEN 'sk'
        WHEN l.tunvn_elig IS NOT NULL OR l.pv_sku LIKE 'TUNVN-%' OR tl.id IS NOT NULL THEN 'tunvn'
        WHEN l.aivault_elig IS NOT NULL OR l.pv_aivault_service_id IS NOT NULL OR al.id IS NOT NULL THEN 'aivault'
        WHEN l.storebat_elig IS NOT NULL OR l.pv_storebat_product_id IS NOT NULL OR sb.id IS NOT NULL THEN 'storebat'
        WHEN l.mirai_elig IS NOT NULL OR l.pv_mirai_package_code IS NOT NULL OR mr.id IS NOT NULL THEN 'mirai'
        ELSE COALESCE(l.snapshot_source,
          CASE WHEN l.wr_variant_id IS NOT NULL THEN 'wr' WHEN l.sk_variant_id IS NOT NULL THEN 'sk' ELSE 'manual' END) END source,
      CASE WHEN l.order_kind='games' THEN CASE
          WHEN gi.status='success' THEN COALESCE(CASE WHEN ga.status='success' AND ga.price>=0 THEN ROUND(ga.price) END,gi.cost_snapshot,0)
          WHEN ga.price>=0 THEN ROUND(ga.price)
          WHEN gi.status='expired' OR ga.status='failed' THEN 0
          ELSE COALESCE(gi.cost_snapshot,0) END
        WHEN COALESCE(l.order_kind,'market')='pedia' THEN ROUND(COALESCE(pi.supplier_charge,pi.supplier_rate_snapshot*pi.quantity/1000.0,0))
        WHEN w.id IS NOT NULL THEN CASE
           WHEN w.wr_variant_id LIKE 'jaspay:%' AND w.jaspay_invoice_total IS NOT NULL
             THEN w.jaspay_invoice_total-COALESCE(w.jaspay_refunded_total,0)
           WHEN w.status='failed' THEN 0 ELSE ROUND(w.wr_cost) END
        WHEN s.id IS NOT NULL THEN CASE WHEN s.status='failed' THEN 0 ELSE ROUND(s.sk_cost) END ELSE NULL END cost_pool,
      CASE WHEN l.order_kind='games' THEN CASE
          WHEN gi.status='success' THEN ga.id IS NULL OR ga.status!='success' OR ga.price IS NULL OR ga.price<0
          WHEN ga.price>=0 OR gi.status='expired' OR ga.status='failed' THEN 0 ELSE 1 END
        WHEN COALESCE(l.order_kind,'market')='pedia' THEN pi.supplier_charge IS NULL
        WHEN w.wr_variant_id LIKE 'jaspay:%' THEN w.status!='failed' AND w.jaspay_invoice_total IS NULL
        WHEN w.id IS NOT NULL THEN w.status NOT IN ('completed','failed')
        WHEN s.id IS NOT NULL THEN s.status NOT IN ('completed','failed')
        WHEN l.tunvn_elig IS NOT NULL OR l.pv_sku LIKE 'TUNVN-%' OR tl.id IS NOT NULL THEN
          tl.id IS NULL OR (tl.status!='completed' AND l.fi_delivered=0)
          OR COALESCE(tl.cost_usdt,l.tunvn_elig_cost,CASE WHEN l.pv_sku LIKE 'TUNVN-BUFF%' THEN l.pv_tunvn_cost ELSE tp.price_usdt END*l.qty) IS NULL
          OR COALESCE(tl.fx_idr_per_usdt,CASE WHEN l.pv_sku LIKE 'TUNVN-BUFF%' THEN l.pv_tunvn_fx ELSE tp.fx_idr_per_usdt END,
            CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END) IS NULL
        WHEN l.aivault_elig IS NOT NULL OR l.pv_aivault_service_id IS NOT NULL OR al.id IS NOT NULL THEN
          al.id IS NULL OR (al.status!='completed' AND l.fi_delivered=0)
          OR COALESCE(al.cost_usd,l.aivault_elig_cost,ap.unit_price_usd*l.qty) IS NULL
          OR COALESCE(al.fx_idr_per_usd,ap.fx_idr_per_usd,CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END) IS NULL
        WHEN l.storebat_elig IS NOT NULL OR l.pv_storebat_product_id IS NOT NULL OR sb.id IS NOT NULL THEN
          sb.id IS NULL OR (sb.status!='completed' AND COALESCE(sb.refunded_usd,0)<=0 AND l.fi_delivered=0)
          OR COALESCE(sb.cost_usd,l.storebat_elig_cost,l.pv_storebat_cost*l.qty) IS NULL
          OR COALESCE(sb.fx_idr_per_usd,l.storebat_elig_fx,l.pv_storebat_fx,CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END) IS NULL
        WHEN l.mirai_elig IS NOT NULL OR l.pv_mirai_package_code IS NOT NULL OR mr.id IS NOT NULL THEN
          mr.id IS NULL OR (mr.status!='completed' AND l.fi_delivered=0)
          OR COALESCE(mr.cost_usdt,l.mirai_elig_cost,mp.cost_usdt*l.qty,l.pv_mirai_cost*l.qty) IS NULL
          OR COALESCE(mr.fx_idr_per_usdt,mp.fx_idr_per_usdt,l.pv_mirai_fx,CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END) IS NULL
        ELSE l.snapshot_cost IS NULL OR COALESCE(l.snapshot_source,'manual')!='manual' END estimated,
      CASE WHEN (l.tunvn_elig IS NOT NULL OR l.pv_sku LIKE 'TUNVN-%' OR tl.id IS NOT NULL)
              AND COALESCE(l.order_kind,'market')!='pedia' AND w.id IS NULL AND s.id IS NULL THEN
          ROUND(COALESCE(COALESCE(tl.cost_usdt,l.tunvn_elig_cost,
            CASE WHEN l.pv_sku LIKE 'TUNVN-BUFF%' THEN l.pv_tunvn_cost ELSE tp.price_usdt END*l.qty),0)
            * COALESCE(tl.fx_idr_per_usdt,CASE WHEN l.pv_sku LIKE 'TUNVN-BUFF%' THEN l.pv_tunvn_fx ELSE tp.fx_idr_per_usdt END,
              CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END,0))
        WHEN (l.aivault_elig IS NOT NULL OR l.pv_aivault_service_id IS NOT NULL OR al.id IS NOT NULL)
              AND COALESCE(l.order_kind,'market')!='pedia' AND w.id IS NULL AND s.id IS NULL THEN
          ROUND(COALESCE(COALESCE(al.cost_usd,l.aivault_elig_cost,ap.unit_price_usd*l.qty),0)
            * COALESCE(al.fx_idr_per_usd,ap.fx_idr_per_usd,
              CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END,0))
        WHEN (l.storebat_elig IS NOT NULL OR l.pv_storebat_product_id IS NOT NULL OR sb.id IS NOT NULL)
              AND COALESCE(l.order_kind,'market')!='pedia' AND w.id IS NULL AND s.id IS NULL THEN
          ROUND(MAX(0,COALESCE(sb.cost_usd,l.storebat_elig_cost,l.pv_storebat_cost*l.qty,0)-COALESCE(sb.refunded_usd,0))
            * COALESCE(sb.fx_idr_per_usd,l.storebat_elig_fx,l.pv_storebat_fx,CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END,0))
        WHEN (l.mirai_elig IS NOT NULL OR l.pv_mirai_package_code IS NOT NULL OR mr.id IS NOT NULL)
              AND COALESCE(l.order_kind,'market')!='pedia' AND w.id IS NULL AND s.id IS NULL THEN
          ROUND(COALESCE(COALESCE(mr.cost_usdt,l.mirai_elig_cost,mp.cost_usdt*l.qty,l.pv_mirai_cost*l.qty),0)
            * COALESCE(mr.fx_idr_per_usdt,mp.fx_idr_per_usdt,l.pv_mirai_fx,
              CASE WHEN CAST(cm.fx_rate_text AS REAL)>0 THEN CAST(cm.fx_rate_text AS REAL) END,0))
        ELSE COALESCE(l.snapshot_cost,CASE WHEN l.wr_variant_id IS NOT NULL THEN
          (SELECT wr_price FROM wr_variants WHERE wr_variant_id=l.wr_variant_id)
          WHEN l.sk_variant_id IS NOT NULL THEN (SELECT sk_price FROM sk_products WHERE sk_variant_id=l.sk_variant_id)
          ELSE l.manual_cost END,0)*l.qty END own_cost,
      w.wr_variant_id LIKE 'jaspay:%' jaspay_link,
      COALESCE(CAST(w.id AS TEXT),CAST(s.id AS TEXT),'own:'||l.item_index) pool_key
    FROM bindings l LEFT JOIN wr_order_links w ON w.id=l.wl_id LEFT JOIN sk_order_links s ON s.id=l.sl_id
    LEFT JOIN pedia_order_items pi ON pi.order_code=l.code
    LEFT JOIN games_order_items gi ON gi.order_code=l.code AND l.order_kind='games'
    LEFT JOIN games_dispatch_attempts ga ON ga.order_code=gi.order_code AND ga.attempt_no=gi.attempt_no
      AND ga.supplier=gi.supplier
    LEFT JOIN tunvn_order_links tl ON tl.order_code=l.code AND tl.item_index=l.item_index
    LEFT JOIN storebat_order_links sb ON sb.order_code=l.code AND sb.item_index=l.item_index
    LEFT JOIN mirai_order_links mr ON mr.order_code=l.code AND mr.item_index=l.item_index
    LEFT JOIN aivault_order_links al ON al.order_code=l.code AND al.item_index=l.item_index
    LEFT JOIN tunvn_products tp ON tp.supplier_product_id=COALESCE(CAST(tl.source_product_id AS INTEGER),
      CAST(l.tunvn_elig_source_id AS INTEGER),CASE WHEN l.pv_sku LIKE 'TUNVN-%' THEN CAST(substr(l.pv_sku,7) AS INTEGER) END)
    LEFT JOIN aivault_products ap ON ap.service_id=COALESCE(al.service_id,l.pv_aivault_service_id)
    LEFT JOIN mirai_packages mp ON mp.package_code=COALESCE(mr.package_code,l.pv_mirai_package_code)
    LEFT JOIN crypto_market_snapshot cm ON cm.id=1
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
   ), periods(period,start) AS (VALUES ${range ? `('selected','${range.from}')` : `('today','${today}'),('week','${week}'),('month','${month}'),('total','0000-01-01')`}),
   scoped AS MATERIALIZED (SELECT f.*,p.period,
     DENSE_RANK() OVER(PARTITION BY p.period ORDER BY CASE WHEN estimated THEN 0 ELSE 1 END,code) estimate_rank
     FROM facts f JOIN periods p ON p.period='total' OR (date(f.paid_wib)>=p.start
     AND date(f.paid_wib)<='${range?.to ?? today}')),
  top AS (SELECT period,COALESCE(name,'Produk') label,SUM(qty) qty,SUM(revenue) revenue,SUM(cost) cost,
    ROW_NUMBER() OVER(PARTITION BY period ORDER BY SUM(revenue-cost) DESC,MIN(item_index),COALESCE(name,'Produk')) rank
    FROM scoped GROUP BY period,product_id,variant_id,COALESCE(name,'Produk')),
  series AS (
    SELECT d.kind,CASE WHEN d.kind='hourly' THEN 'today' ELSE '' END period,
      CASE WHEN d.kind='hourly' THEN strftime('%H:00',paid_wib) ELSE date(paid_wib) END label,
      COUNT(DISTINCT code) orders,SUM(revenue) revenue,SUM(cost) cost,0 estimated,0 qty,0 merchant_paid,0 credit_used,
      SUM(CASE WHEN last_revenue=1 THEN payment_fee ELSE 0 END) payment_fees,
      SUM(CASE WHEN last_revenue=1 THEN unique_bonus ELSE 0 END) unique_code_bonus,'[]' estimated_codes,'[]' estimated_jaspay_codes
      FROM facts CROSS JOIN (SELECT 'daily' kind UNION ALL SELECT 'hourly') d
      WHERE CASE WHEN d.kind='hourly' THEN date(paid_wib)='${today}' ELSE
        ${range ? `date(paid_wib) BETWEEN '${range.from}' AND '${range.to}'` : `date(paid_wib)>=MIN('${month}',date('${today}','-29 days'))`} END
      GROUP BY d.kind,label
  )
  SELECT d.kind,period,CASE d.kind WHEN 'supplier' THEN source WHEN 'channel' THEN
    CASE WHEN sales_channel IN ('telegram','whatsapp') THEN sales_channel ELSE 'web' END ELSE '' END label,
    COUNT(DISTINCT code) orders,SUM(revenue) revenue,SUM(cost) cost,
    COUNT(DISTINCT CASE WHEN d.kind='summary' AND estimated THEN code END) estimated,0 qty,
    SUM(CASE WHEN d.kind='summary' AND last_revenue=1 THEN merchant_amount ELSE 0 END) merchant_paid,
    SUM(CASE WHEN d.kind='summary' AND last_revenue=1 THEN order_credit ELSE 0 END) credit_used,
    SUM(CASE WHEN d.kind='summary' AND last_revenue=1 THEN payment_fee ELSE 0 END) payment_fees,
    SUM(CASE WHEN d.kind='summary' AND last_revenue=1 THEN unique_bonus ELSE 0 END) unique_code_bonus,
    json_group_array(DISTINCT code) FILTER(WHERE d.kind='summary' AND estimated AND estimate_rank<=20) estimated_codes,
    json_group_array(DISTINCT code) FILTER(WHERE d.kind='summary' AND estimated AND jaspay_link AND estimate_rank<=20) estimated_jaspay_codes
    FROM scoped CROSS JOIN (SELECT 'summary' kind UNION ALL SELECT 'supplier' UNION ALL SELECT 'channel') d
    GROUP BY d.kind,period,label
  UNION ALL SELECT 'top',period,label,0,revenue,cost,0,qty,0,0,0,0,'[]','[]' FROM top WHERE rank<=5
  UNION ALL SELECT * FROM series`;
}

export async function readSelectedFinancialReport(selection: ReportSelection, now = new Date()): Promise<SelectedReport> {
  const report = emptySelectedReport(selection, now);
  const fees = await readPaymentFees();
  const [rows, expenses] = await Promise.all([queryAll(financialReportSql(now, selection, fees)), expenseReportRows(report.from,report.to)]);
  const points = new Map<string, ReportPoint>();
  for (const row of rows) {
    const value = { orders: Number(row.orders || 0), revenue: Number(row.revenue || 0), cost: Number(row.cost || 0), profit: Number(row.revenue || 0) - Number(row.cost || 0) };
    const key = String(row.label);
    if (row.kind === (selection === "today" ? "hourly" : "daily")) points.set(key, { date: key, ...value, ...pointFinance(), payment_fees:Number(row.payment_fees || 0) });
    else if (row.kind === "summary") Object.assign(report, value, { estimated_order_codes:JSON.parse(String(row.estimated_codes ?? "[]")), estimated_jaspay_order_codes:JSON.parse(String(row.estimated_jaspay_codes ?? "[]")), payment_fees:Number(row.payment_fees || 0), unique_code_bonus:Number(row.unique_code_bonus || 0), estimated_orders: Number(row.estimated || 0), merchant_paid: Number(row.merchant_paid || 0), credit_used: Number(row.credit_used || 0) });
    else if (row.kind === "supplier" && key in report.suppliers) report.suppliers[key as keyof typeof report.suppliers] = value;
    else if (row.kind === "channel" && key in report.channels) report.channels[key as keyof typeof report.channels] = value;
    else if (row.kind === "top") report.top_products.push({ name: key, qty: Number(row.qty || 0), ...value });
  }
  report.series = report.series.map(point => points.get(point.date) ?? point);
  applyExpenses(report,expenses,report.from,report.to,selection === "today");
  report.top_products.sort((a, b) => b.profit - a.profit);
  return report;
}

export async function readFinancialReport(now = new Date()) {
  const fees = await readPaymentFees();
  const [rows, expenses] = await Promise.all([queryAll(financialReportSql(now,undefined,fees)),expenseReportRows("0000-01-01",todayWibDateString(now))]);
  const reports: Record<ReportPeriod | "total", PeriodReport> = { today: emptyReport(), week: emptyReport(), month: emptyReport(), total: emptyReport() };
  const daily = new Map<string, ReportPoint>(), hourly = new Map<string, ReportPoint>();
  for (const row of rows) {
    const value = { orders: Number(row.orders || 0), revenue: Number(row.revenue || 0), cost: Number(row.cost || 0), profit: Number(row.revenue || 0)-Number(row.cost || 0) };
    const key = String(row.label), report = reports[row.period as keyof typeof reports];
    if (row.kind === "daily") daily.set(key, { date: key, ...value, ...pointFinance(), payment_fees:Number(row.payment_fees || 0) });
    else if (row.kind === "hourly") hourly.set(key, { date: key, ...value, ...pointFinance(), payment_fees:Number(row.payment_fees || 0) });
    else if (report && row.kind === "summary") Object.assign(report, value, { estimated_order_codes:JSON.parse(String(row.estimated_codes ?? "[]")), estimated_jaspay_order_codes:JSON.parse(String(row.estimated_jaspay_codes ?? "[]")), payment_fees:Number(row.payment_fees || 0), unique_code_bonus:Number(row.unique_code_bonus || 0), estimated_orders: Number(row.estimated || 0), merchant_paid: Number(row.merchant_paid || 0), credit_used: Number(row.credit_used || 0) });
    else if (report && row.kind === "supplier" && key in report.suppliers) report.suppliers[key as keyof typeof report.suppliers] = value;
    else if (report && row.kind === "channel" && key in report.channels) report.channels[key as keyof typeof report.channels] = value;
    else if (report && row.kind === "top") report.top_products.push({ name: key, qty: Number(row.qty || 0), ...value });
  }
  for (const report of Object.values(reports)) report.top_products.sort((a,b)=>b.profit-a.profit);
  const today = todayWibDateString(now), week = weekWibStartDateString(now);
  const days = (start: string) => {
    const result: ReportPoint[] = [];
    for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0,10)<=today; d = new Date(d.getTime()+86400000)) {
      const date = d.toISOString().slice(0,10); result.push({ ...(daily.get(date) ?? { date, ...bucket(), ...pointFinance() }) });
    }
    return result;
  };
  reports.week.series = days(week); reports.month.series = days(`${today.slice(0,7)}-01`);
  reports.today.series = Array.from({ length: new Date(now.getTime()+7*3600000).getUTCHours()+1 }, (_,i) => {
    const date = `${String(i).padStart(2,'0')}:00`; return { ...(hourly.get(date) ?? { date, ...bucket(), ...pointFinance() }) };
  });
  for (const [period,report] of Object.entries(reports)) {
    const from = period === "total" ? "0000-01-01" : resolveReportRange(period as ReportPeriod,now).from;
    applyExpenses(report,expenses,from,today,period === "today");
  }
  const dailySeries = fillDailySeries([...daily.values()],now).map(p => ({ ...p, ...pointFinance(), payment_fees:daily.get(p.date)?.payment_fees ?? 0 }));
  applyExpenses({ ...emptyReport(),series:dailySeries },expenses,"0000-01-01",today);
  return { reports, daily: dailySeries };
}

type ExpenseReportRow = { spent_on: string; category: ExpenseCategory; amount: number };
async function expenseReportRows(from: string,to: string): Promise<ExpenseReportRow[]> {
  return await queryAll("SELECT spent_on,category,SUM(amount) amount FROM operating_expenses WHERE spent_on BETWEEN ? AND ? GROUP BY spent_on,category",from,to) as ExpenseReportRow[];
}
function applyExpenses(report: PeriodReport, rows: ExpenseReportRow[], from: string,to: string,hourly = false) {
  const points = new Map(report.series.map(point => [point.date,point]));
  for (const row of rows) {
    if (row.spent_on < from || row.spent_on > to) continue;
    const amount = Number(row.amount);
    report.expenses_by_category[row.category] += amount;
    if (row.category === "refund" || row.category === "replace") report.refund_expenses += amount;
    else report.operational_expenses += amount;
    const point = points.get(hourly ? "00:00" : row.spent_on);
    if (point) point.expenses += amount;
  }
  report.net_profit = report.profit-report.payment_fees-report.refund_expenses-report.operational_expenses;
  for (const point of report.series) point.net_profit = point.profit-point.payment_fees-point.expenses;
}

type FinancialSnapshot = Awaited<ReturnType<typeof readFinancialReport>> & { generatedAt: string };
const overviewSnapshots = new WeakMap<D1, { key: string; expiresAt: number; value: Promise<FinancialSnapshot> }>();

/** Authenticated financial aggregates: five-minute memory + encrypted edge
 * snapshot across isolates. Other report callers retain fresh-read behavior. */
export async function readOverviewFinancialReport(now = new Date()): Promise<FinancialSnapshot> {
  const db = getD1();
  const key = `${todayWibDateString(now)}:${now.getUTCHours()}:${await financeCacheRevision()}`;
  const cached = db && process.env.NODE_ENV === "production" ? overviewSnapshots.get(db) : undefined;
  if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.value;
  const load = () => readFinancialReport(now).then(report => ({ ...report, generatedAt: now.toISOString() }));
  const value = db ? readPrivateFinancialSnapshot(`overview-finance-v5:${key}`, load) : load();
  if (db && process.env.NODE_ENV === "production") {
    overviewSnapshots.set(db, { key, expiresAt: Date.now() + FINANCIAL_SNAPSHOT_TTL_MS, value });
    void value.then(snapshot => {
      const entry = overviewSnapshots.get(db);
      if (entry?.value === value) entry.expiresAt = Date.parse(snapshot.generatedAt) + FINANCIAL_SNAPSHOT_TTL_MS;
    }).catch(() => { if (overviewSnapshots.get(db)?.value === value) overviewSnapshots.delete(db); });
  }
  return value;
}

/** Standard periods already exist in the shared fact set; do not run the
 * entire joins/window/aggregation pipeline twice for the same overview. */
export function selectedReportFromFinancial(selection: ReportPeriod, financial: FinancialSnapshot, now = new Date()): SelectedReport {
  return { ...financial.reports[selection], ...resolveReportRange(selection, now),
    timezone: "Asia/Jakarta", generated_at: financial.generatedAt };
}
