export type ProductLifecycle = { archivedAt?: string | null; isActive: boolean; stock: number; liveStatus?: string };
export function productStatus(p: ProductLifecycle) {
  if (p.archivedAt) return "archive";
  return p.liveStatus ?? (!p.isActive ? "off" : p.stock !== -1 && p.stock <= 0 ? "hidden_soldout" : "live");
}
export function productTabCounts(products: ProductLifecycle[]) {
  const counts = { live: 0, hidden: 0, off: 0, all: 0, archive: 0 };
  for (const p of products) {
    const status = productStatus(p);
    if (status === "archive") { counts.archive++; continue; }
    counts.all++;
    if (status === "live") counts.live++;
    else if (status === "off") counts.off++;
    else counts.hidden++;
  }
  return counts;
}
