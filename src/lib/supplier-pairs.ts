// src/lib/supplier-pairs.ts — compatibility shim.
//
// Model pasangan WR vs SK digantikan grup produk lintas supplier
// (`src/lib/product-groups.ts`, keputusan owner 16 November 2026). Nama ekspor
// lama dipertahankan agar pemanggil katalog/Telegram/cron tidak perlu diubah.
// supplier_pairs DIBIARKAN sebagai arsip; jangan menulis ke tabel itu lagi.
export {
  decideAllGroups as decideAllWinners,
  decideDirtyGroups as decideDirtyWinners,
  loserProductIds,
  notLoserProductSql,
  winnerForLoserProduct,
} from "./product-groups";
