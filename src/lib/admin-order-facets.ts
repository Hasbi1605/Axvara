/** One scan for all global filter choices. Filtered metrics remain separate. */
export const ORDER_FACETS_SQL = `SELECT COALESCE(sales_channel,'web') AS channel,
  status, LOWER(payment_method) AS method, COUNT(*) AS count
  FROM orders GROUP BY COALESCE(sales_channel,'web'),status,LOWER(payment_method)`;

export function orderFacets(rows: Record<string, unknown>[]) {
  const channels = new Map<string, number>(), statuses = new Map<string, number>(), methods = new Map<string, number>();
  for (const row of rows) {
    for (const [target, key] of [[channels, row.channel], [statuses, row.status], [methods, row.method]] as const) {
      const name = String(key ?? "");
      target.set(name, (target.get(name) ?? 0) + Number(row.count || 0));
    }
  }
  return { counts: { channels: Object.fromEntries(channels), statuses: Object.fromEntries(statuses) },
    methods: [...methods].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([method]) => method).filter(Boolean) };
}
