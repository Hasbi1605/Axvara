"use client";
// Panel samping "Catat pengeluaran" (16 November 2026). Dipakai bersama oleh
// Ringkasan, menu Pengeluaran dan detail order (refund/replace). Desktop:
// panel kanan max-w-md; HP: layar penuh. Kontrak: src/lib/finance/types.ts.
import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, Label, Sheet, SheetContent, SheetDescription, SheetTitle, Switch, Textarea } from "../ui";
import { inputStyles } from "../ui/input";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { cn } from "@/lib/utils";
import { todayWibDateString } from "@/lib/revenue";
import {
  EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABEL, EXPENSE_MAX_AMOUNT, EXPENSE_NOTE_MAX, isOrderLinkedCategory,
  type Expense, type ExpenseCategory, type ExpenseCreateInput, type ExpenseMutationResponse,
} from "@/lib/finance/types";
import { financeRequest } from "./api";

export type ExpenseDraft = Partial<Pick<Expense, "spent_on" | "category" | "amount" | "note" | "order_code">>;

export function ExpenseFormSheet({ open, onOpenChange, expense, draft, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mode ubah bila diisi. */
  expense?: Expense | null;
  /** Nilai awal mode baru (mis. dari detail order). */
  draft?: ExpenseDraft;
  onSaved?: (result: ExpenseMutationResponse) => void;
}) {
  const ids = useId();
  const editing = Boolean(expense);
  const [spentOn, setSpentOn] = useState(todayWibDateString());
  const [category, setCategory] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [orderCode, setOrderCode] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const source = expense ?? draft ?? {};
    setSpentOn(source.spent_on ?? todayWibDateString());
    setCategory(source.category ?? null);
    setAmount(source.amount ?? null);
    setNote(source.note ?? "");
    setOrderCode(source.order_code ?? "");
    setRepeat(false);
    setError(null);
  }, [open, expense, draft]);

  const linked = category ? isOrderLinkedCategory(category) : false;
  const today = todayWibDateString();
  const validation = !category ? "Pilih kategori."
    : !amount || amount <= 0 ? "Isi jumlah lebih dari Rp0."
    : amount > EXPENSE_MAX_AMOUNT ? "Jumlah terlalu besar."
    : !spentOn ? "Isi tanggal dibayar."
    : spentOn > today ? "Tanggal tidak boleh di masa depan."
    : null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (validation || !category || !amount) { setError(validation); return; }
    setBusy(true); setError(null);
    const payload: ExpenseCreateInput = {
      spent_on: spentOn, category, amount,
      note: note.trim() || null,
      order_code: linked ? orderCode.trim().toUpperCase() || null : null,
      ...(editing ? {} : { repeat_monthly: repeat && !linked }),
    };
    try {
      const result = editing
        ? await financeRequest<ExpenseMutationResponse>(`/api/admin/expenses/${expense!.id}`, "PATCH", { spent_on: payload.spent_on, category: payload.category, amount: payload.amount, note: payload.note, order_code: payload.order_code })
        : await financeRequest<ExpenseMutationResponse>("/api/admin/expenses", "POST", payload);
      onSaved?.(result);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pengeluaran gagal disimpan.");
    } finally { setBusy(false); }
  };

  return <Sheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
    <SheetContent side="right" className="flex w-full max-w-none flex-col sm:max-w-md"
      onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement | null; }}
      onCloseAutoFocus={(event) => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <div className="border-b border-admin-border px-5 pb-4 pt-5 pr-12">
          <SheetTitle className="text-base font-semibold">{editing ? "Ubah pengeluaran" : "Catat pengeluaran"}</SheetTitle>
          <SheetDescription className="mt-1 text-xs text-admin-muted">Isi nominal yang dibayar.</SheetDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <fieldset>
            <legend className="text-sm font-medium text-admin-fg">Kategori</legend>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Kategori pengeluaran">
              {EXPENSE_CATEGORIES.map((value) => {
                const active = category === value;
                return <label key={value} className="relative cursor-pointer">
                  <Input type="radio" name={`${ids}-category`} value={value} checked={active} onChange={() => setCategory(value)} className="peer sr-only h-px min-h-0 w-px border-0 p-0" />
                  <span className={cn("inline-flex h-9 items-center rounded-full border px-3 text-xs font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-admin-primary",
                    active ? "border-admin-primary bg-admin-primary text-admin-inverse hover:bg-admin-primary hover:text-admin-inverse" : "border-admin-border bg-admin-subtle text-admin-fg hover:border-admin-primary/50")}>
                  {EXPENSE_CATEGORY_LABEL[value]}
                  </span>
                </label>;
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-amount`}>Jumlah (Rp)</Label>
              <MoneyInput id={`${ids}-amount`} value={amount} onChange={setAmount} allowEmpty placeholder="0" className={cn(inputStyles, "h-10 tabular-nums")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${ids}-date`}>Tanggal dibayar</Label>
              <Input id={`${ids}-date`} type="date" min="2026-01-01" max={today} value={spentOn} onChange={(e) => setSpentOn(e.target.value)} className="h-10 [color-scheme:inherit]" />
            </div>
          </div>
          {linked && <div className="space-y-1.5">
            <Label htmlFor={`${ids}-order`}>Kode order <span className="font-normal text-admin-muted">(opsional)</span></Label>
            <Input id={`${ids}-order`} value={orderCode} onChange={(e) => setOrderCode(e.target.value)} placeholder="AXV-20261116-XXXXXXXX" autoCapitalize="characters" spellCheck={false} className="h-10 font-mono" />
          </div>}
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-note`}>Keterangan <span className="font-normal text-admin-muted">(opsional)</span></Label>
            <Textarea id={`${ids}-note`} value={note} maxLength={EXPENSE_NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={linked ? "mis. akun Netflix mati, ganti baru" : "mis. ChatGPT Plus November"} className="min-h-16" />
          </div>
          {!editing && !linked && <label className="flex items-start justify-between gap-4 rounded-xl border border-admin-border bg-admin-subtle p-3">
            <span>
              <span className="block text-sm font-medium text-admin-fg">Berulang tiap bulan</span>
              <span className="mt-0.5 block text-xs text-admin-muted">Setiap tanggal {Number(spentOn.slice(8, 10)) || "yang sama"}.</span>
            </span>
            <Switch checked={repeat} onCheckedChange={setRepeat} aria-label="Berulang tiap bulan" />
          </label>}
          {expense?.recurring_id && <p className="rounded-lg bg-admin-subtle px-3 py-2 text-xs text-admin-muted">Hanya entri ini yang berubah.</p>}
          {error && <p role="alert" className="text-sm text-admin-danger">{error}</p>}
        </div>
        <div className="flex gap-2 border-t border-admin-border px-5 py-4">
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => onOpenChange(false)}>Batal</Button>
          <Button type="submit" className="flex-1" disabled={busy}>{busy ? "Menyimpan…" : editing ? "Simpan perubahan" : "Simpan"}</Button>
        </div>
      </form>
    </SheetContent>
  </Sheet>;
}
