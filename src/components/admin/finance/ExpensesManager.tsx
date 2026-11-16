"use client";
// Menu admin "Pengeluaran" (16 November 2026): ringkasan kategori per bulan,
// daftar per tanggal (ubah/hapus), dan pengelolaan pengeluaran berulang.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Input, Label, NativeSelect, PageHeader, Skeleton, Switch } from "../ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { cn, formatRupiah } from "@/lib/utils";
import { currentWibMonthString } from "@/lib/revenue";
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, isOrderLinkedCategory,
  type Expense, type ExpenseCategory, type ExpenseListResponse, type RecurringExpense,
} from "@/lib/finance/types";
import { financeRequest } from "./api";
import { ExpenseFormSheet } from "./ExpenseFormSheet";

const dayLabel = (date: string) => new Date(`${date}T00:00:00+07:00`).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00+07:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

type CategoryFilter = ExpenseCategory | "" | "refund_replace" | "operational";
function initialFilter(): { month: string; category: CategoryFilter; from: string; to: string } {
  const defaults = { month: currentWibMonthString(), category: "" as CategoryFilter, from: "", to: "" };
  if (typeof window === "undefined") return defaults;
  const params = new URLSearchParams(window.location.search);
  const month = params.get("month") ?? "";
  const category = params.get("category") ?? "";
  const from = params.get("from") ?? "", to = params.get("to") ?? "";
  const range = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return { month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : defaults.month,
    category: [...EXPENSE_CATEGORIES, "refund_replace", "operational"].includes(category) ? category as CategoryFilter : "",
    from: range ? from : "", to: range ? to : "" };
}

export function ExpensesManager({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [{ month, category, from, to }, setFilter] = useState(initialFilter);
  const [data, setData] = useState<ExpenseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ expense?: Expense | null } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "expense"; item: Expense } | { kind: "recurring"; item: RecurringExpense } | null>(null);
  const [busyRecurring, setBusyRecurring] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setData(null);
    try {
      const params = new URLSearchParams(from && to ? { from, to } : { month });
      const result = await financeRequest<ExpenseListResponse>(`/api/admin/expenses?${params}`);
      if (request !== requestId.current) return;
      setData(result);
      setError(null);
    } catch (cause) { if (request === requestId.current) setError(cause instanceof Error ? cause.message : "Pengeluaran gagal dimuat."); }
    finally { if (request === requestId.current) setLoading(false); }
  }, [month, from, to]);
  useEffect(() => { const generation = requestId; void load(); return () => { ++generation.current; }; }, [load]);

  // Filter kategori di klien: total chip tetap menunjukkan semua kategori bulan ini.
  const visible = useMemo(() => (data?.expenses ?? []).filter((e) => !category || (category === "refund_replace" ? isOrderLinkedCategory(e.category) : category === "operational" ? !isOrderLinkedCategory(e.category) : e.category === category)), [data, category]);
  const periodLabel = from && to ? `${from} – ${to}` : monthLabel(month);
  const categoryLabel = category === "refund_replace" ? "Refund & replace" : category === "operational" ? "Operasional" : category ? EXPENSE_CATEGORY_LABEL[category] : "";
  const groups = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const item of visible) map.set(item.spent_on, [...(map.get(item.spent_on) ?? []), item]);
    return [...map.entries()];
  }, [visible]);
  const usedCategories = EXPENSE_CATEGORIES.filter((c) => (data?.totals[c] ?? 0) > 0);
  const refundTotal = (data?.totals.refund ?? 0) + (data?.totals.replace ?? 0);

  const changed = () => { void load(); onChanged?.(); };
  const setMonth = (value: string) => { if (value) setFilter((f) => ({ ...f, month: value, from: "", to: "" })); };
  const setCategory = (value: CategoryFilter) => setFilter((f) => ({ ...f, category: value }));

  const remove = async () => {
    if (!confirm) return;
    setRemoving(true);
    try {
      if (confirm.kind === "expense") await financeRequest(`/api/admin/expenses/${confirm.item.id}`, "DELETE");
      else await financeRequest(`/api/admin/expenses/recurring/${confirm.item.id}`, "DELETE");
      toast.success(confirm.kind === "expense" ? "Pengeluaran dihapus." : "Pengeluaran berulang dihentikan.");
      setConfirm(null);
      changed();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Gagal menghapus."); }
    finally { setRemoving(false); }
  };
  const toggleRecurring = async (item: RecurringExpense, active: boolean) => {
    setBusyRecurring(item.id);
    try {
      await financeRequest(`/api/admin/expenses/recurring/${item.id}`, "PATCH", { active });
      toast.success(active ? "Pengeluaran berulang diaktifkan." : "Pengeluaran berulang dijeda.");
      changed();
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Gagal mengubah."); }
    finally { setBusyRecurring(null); }
  };

  return <div className="mt-4 space-y-5">
    <PageHeader title="Pengeluaran"
      actions={<Button type="button" onClick={() => setEditor({})}>+ Catat pengeluaran</Button>} />

    <div className="flex flex-wrap items-end gap-3">
      {from && to ? <div className="text-xs text-admin-muted">Periode Ringkasan: {periodLabel}<Button type="button" variant="ghost" size="sm" onClick={() => setMonth(to.slice(0, 7))}>Pilih bulan</Button></div> : <div className="space-y-1">
        <Label htmlFor="expense-month" className="text-xs text-admin-muted">Bulan</Label>
        <Input id="expense-month" type="month" max={currentWibMonthString()} value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[180px] [color-scheme:inherit]" />
      </div>}
      <div className="space-y-1">
        <Label htmlFor="expense-category" className="text-xs text-admin-muted">Kategori</Label>
        <NativeSelect id="expense-category" value={category} onChange={(e) => setCategory(e.target.value as CategoryFilter)} className="h-9 w-[200px]">
          <option value="">Semua kategori</option>
          <option value="refund_replace">Refund & replace</option>
          <option value="operational">Operasional</option>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{EXPENSE_CATEGORY_LABEL[c]}</option>)}
        </NativeSelect>
      </div>
    </div>

    {error ? <div role="alert" className="rounded-xl border border-admin-danger/20 bg-admin-danger/[0.06] p-5">
      <p className="text-sm text-admin-danger">{error}</p>
      <Button type="button" className="mt-3" onClick={() => void load()}>Muat ulang</Button>
    </div> : loading && !data ? <div role="status" className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /><span className="sr-only">Memuat pengeluaran…</span></div> : data && <>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-admin-muted">Total {periodLabel}</p>
          <p className="text-2xl font-semibold tabular-nums text-admin-fg">{formatRupiah(data.total)}</p>
        </div>
        {refundTotal > 0 && <p className="mt-1 text-right text-xs text-admin-muted">termasuk refund & replace {formatRupiah(refundTotal)}</p>}
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Total per kategori">
          {usedCategories.length === 0 && <p className="text-xs text-admin-muted">Belum ada pengeluaran bulan ini.</p>}
          {usedCategories.map((c) => <Button key={c} type="button" variant="outline" aria-pressed={category === c} onClick={() => setCategory(category === c ? "" : c)}
            className={cn("h-auto rounded-full px-3 py-1.5 text-xs font-normal",
              category === c ? "border-admin-primary bg-admin-primary text-admin-inverse hover:bg-admin-primary hover:text-admin-inverse" : "border-admin-border bg-admin-subtle text-admin-fg hover:border-admin-primary/50")}>
            {EXPENSE_CATEGORY_LABEL[c]} · <span className="font-semibold tabular-nums">{formatRupiah(data.totals[c])}</span>
          </Button>)}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <section aria-label="Daftar pengeluaran" className={cn("space-y-4", loading && "opacity-60")} aria-busy={loading}>
          {groups.length === 0 && <Card className="p-8 text-center">
            <p className="text-sm font-medium text-admin-fg">{category ? `Tidak ada ${categoryLabel.toLowerCase()} di ${periodLabel}.` : `Belum ada pengeluaran di ${periodLabel}.`}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => setEditor({})}>+ Catat pengeluaran</Button>
          </Card>}
          {groups.map(([date, items]) => <div key={date}>
            <div className="mb-1.5 flex items-center justify-between px-1 text-xs text-admin-muted">
              <span className="font-medium">{dayLabel(date)}</span>
              <span className="tabular-nums">{formatRupiah(items.reduce((sum, e) => sum + e.amount, 0))}</span>
            </div>
            <Card className="divide-y divide-admin-border overflow-hidden">
              {items.map((item) => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-3 sm:flex sm:p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-admin-fg">{EXPENSE_CATEGORY_LABEL[item.category]}</span>
                    {item.recurring_id && <Badge variant="outline" className="text-[10px]" title="Dibuat dari pengeluaran berulang">Bulanan</Badge>}
                    {isOrderLinkedCategory(item.category) && item.order_code && <Badge variant="outline" className="max-w-full break-all whitespace-normal font-mono text-[10px]">{item.order_code}</Badge>}
                  </div>
                  {item.note && <p className="mt-0.5 break-words text-xs text-admin-muted">{item.note}</p>}
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-admin-fg">{formatRupiah(item.amount)}</p>
                <div className="col-span-2 flex shrink-0 justify-end gap-1">
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setEditor({ expense: item })} aria-label={`Ubah ${EXPENSE_CATEGORY_LABEL[item.category]} ${formatRupiah(item.amount)}`}>Ubah</Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-admin-danger" onClick={() => setConfirm({ kind: "expense", item })} aria-label={`Hapus ${EXPENSE_CATEGORY_LABEL[item.category]} ${formatRupiah(item.amount)}`}>Hapus</Button>
                </div>
              </div>)}
            </Card>
          </div>)}
        </section>

        <aside aria-label="Pengeluaran berulang">
          <Card className="p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-admin-fg">Berulang tiap bulan</h2>
            <div className="mt-4 space-y-2">
              {data.recurring.length === 0 && <p className="text-xs text-admin-muted">Belum ada pengeluaran berulang.</p>}
              {data.recurring.map((item) => <div key={item.id} className={cn("rounded-xl bg-admin-subtle p-3", !item.active && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-admin-fg">{item.note || EXPENSE_CATEGORY_LABEL[item.category]}</p>
                    <p className="text-xs text-admin-muted">{EXPENSE_CATEGORY_LABEL[item.category]} · tiap tgl {item.day_of_month}</p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{formatRupiah(item.amount)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-admin-muted">
                    <Switch checked={item.active} disabled={busyRecurring === item.id} onCheckedChange={(v) => void toggleRecurring(item, v)} aria-label={`${item.active ? "Jeda" : "Aktifkan"} ${item.note || EXPENSE_CATEGORY_LABEL[item.category]}`} />
                    {item.active ? "Aktif" : "Dijeda"}
                  </label>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-admin-danger" onClick={() => setConfirm({ kind: "recurring", item })}>Hentikan</Button>
                </div>
              </div>)}
            </div>
          </Card>
        </aside>
      </div>
    </>}

    <ExpenseFormSheet open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }} expense={editor?.expense ?? null}
      onSaved={(result) => {
        toast.success(editor?.expense ? "Pengeluaran diperbarui." : result.recurring ? "Pengeluaran dicatat dan akan berulang tiap bulan." : "Pengeluaran dicatat.");
        if (!editor?.expense && (from ? result.expense.spent_on < from || result.expense.spent_on > to : result.expense.spent_on.slice(0, 7) !== month)) setMonth(result.expense.spent_on.slice(0, 7));
        changed();
      }} />
    <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)} onConfirm={() => void remove()} loading={removing}
      title={confirm?.kind === "recurring" ? "Hentikan pengeluaran berulang?" : "Hapus pengeluaran?"}
      description={confirm?.kind === "recurring"
        ? "Catatan sebelumnya tetap tersimpan."
        : confirm ? `${EXPENSE_CATEGORY_LABEL[confirm.item.category]} ${formatRupiah(confirm.item.amount)} akan dihapus dan Untung Bersih dihitung ulang.` : ""}
      confirmLabel={confirm?.kind === "recurring" ? "Hentikan" : "Hapus"} />
  </div>;
}
