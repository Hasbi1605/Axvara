// src/lib/finance/types.ts — kontrak bersama Pengeluaran + Untung Bersih (16 November 2026).
//
// Keputusan owner 16 Nov 2026:
// - Pengeluaran dihitung pada TANGGAL DIBAYAR (cash basis, WIB), nominal Rupiah
//   sesuai yang benar-benar terpotong.
// - Refund ke pembeli & Replace/ganti akun = kategori pengeluaran yang BOLEH
//   ditautkan ke kode order (opsional, divalidasi ada).
// - Pengeluaran berulang bulanan: template membuat satu entri per bulan pada
//   tanggal yang sama (tanggal > akhir bulan dijepit ke hari terakhir).
// - MDR per penyedia QRIS dapat diatur (basis poin, default 0; GoPay gratis).
// File ini HANYA tipe/konstanta: aman diimpor client maupun server.

export const EXPENSE_CATEGORIES = ["hosting", "internet", "ai_tools", "domain", "ads", "refund", "replace", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  hosting: "Hosting & server",
  internet: "Kuota & internet",
  ai_tools: "AI & tools",
  domain: "Domain",
  ads: "Iklan",
  refund: "Refund ke pembeli",
  replace: "Replace / ganti akun",
  other: "Lainnya",
};

/** Kategori yang boleh/umumnya ditautkan ke kode order dan dijumlah sebagai "Refund & replace". */
export const ORDER_LINKED_CATEGORIES = ["refund", "replace"] as const satisfies readonly ExpenseCategory[];
export const isOrderLinkedCategory = (c: ExpenseCategory): boolean => (ORDER_LINKED_CATEGORIES as readonly string[]).includes(c);

export const EXPENSE_MAX_AMOUNT = 1_000_000_000; // Rp1 miliar per entri
export const EXPENSE_NOTE_MAX = 200;

export type Expense = {
  id: number;
  /** YYYY-MM-DD, tanggal dibayar (WIB). */
  spent_on: string;
  category: ExpenseCategory;
  /** Rupiah bulat, > 0. */
  amount: number;
  note: string | null;
  order_code: string | null;
  /** Diisi bila entri dibuat oleh template berulang. */
  recurring_id: number | null;
  created_at: string;
  updated_at: string;
};

export type RecurringExpense = {
  id: number;
  category: ExpenseCategory;
  amount: number;
  note: string | null;
  /** 1..31; dijepit ke hari terakhir bulan pendek. */
  day_of_month: number;
  /** YYYY-MM bulan pertama yang dibuatkan entri. */
  start_month: string;
  active: boolean;
  /** YYYY-MM terakhir yang sudah dibuatkan entri; null = belum pernah. */
  last_generated_month: string | null;
  created_at: string;
  updated_at: string;
};

/** POST /api/admin/expenses */
export type ExpenseCreateInput = {
  spent_on: string;
  category: ExpenseCategory;
  amount: number;
  note?: string | null;
  order_code?: string | null;
  /** true = juga buat template bulanan (day_of_month = hari dari spent_on, start_month = bulan spent_on). */
  repeat_monthly?: boolean;
};
/** PATCH /api/admin/expenses/[id] — semua field opsional, minimal satu. */
export type ExpenseUpdateInput = Partial<Pick<ExpenseCreateInput, "spent_on" | "category" | "amount" | "note" | "order_code">>;
/** PATCH /api/admin/expenses/recurring/[id] */
export type RecurringUpdateInput = Partial<{ amount: number; note: string | null; day_of_month: number; category: ExpenseCategory; active: boolean }>;

/** GET /api/admin/expenses?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD [&category=] */
export type ExpenseListResponse = {
  from: string;
  to: string;
  expenses: Expense[]; // urut spent_on DESC, id DESC
  totals: Record<ExpenseCategory, number>;
  total: number;
  recurring: RecurringExpense[]; // semua template (aktif dulu)
};
export type ExpenseMutationResponse = { expense: Expense; recurring?: RecurringExpense | null };
export type ApiError = { error: string; message?: string };

/** GET/PUT /api/admin/payment-fees — MDR basis poin (100 = 1%). */
export const MDR_PROVIDERS = ["gopay", "klikqris", "dana"] as const;
export type MdrProvider = (typeof MDR_PROVIDERS)[number];
export const MDR_PROVIDER_LABEL: Record<MdrProvider, string> = { gopay: "GoPay Merchant", klikqris: "KlikQRIS", dana: "DANA" };
export const MDR_MAX_BPS = 1000; // 10%
export type PaymentFeeSettings = { mdr_bps: Record<MdrProvider, number> };

/**
 * Tambahan di setiap PeriodReport/SelectedReport (`src/lib/dashboard-report.ts`).
 * `profit` (sudah ada) = untung kotor = omzet − modal produk.
 * net_profit = profit − payment_fees − refund_expenses − operational_expenses.
 */
export type ReportFinance = {
  /** Biaya gateway (payment_transactions.gateway_fee) + estimasi MDR QRIS per penyedia. */
  payment_fees: number;
  /** Kelebihan kode unik QRIS (payable_amount − subtotal) — SUDAH termasuk omzet; info saja. */
  unique_code_bonus: number;
  /** Kategori refund + replace. */
  refund_expenses: number;
  /** Kategori lainnya (hosting, internet, ai_tools, domain, ads, other). */
  operational_expenses: number;
  net_profit: number;
  expenses_by_category: Record<ExpenseCategory, number>;
  /** Maks 20 kode order yang modalnya masih estimasi (untuk "Tinjau"). */
  estimated_order_codes: string[];
};
/** Tambahan per titik seri (harian/jam). Pengeluaran per jam dibukukan di jam 00:00. */
export type ReportPointFinance = { expenses: number; payment_fees: number; net_profit: number };

export const emptyExpenseTotals = (): Record<ExpenseCategory, number> =>
  Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<ExpenseCategory, number>;
