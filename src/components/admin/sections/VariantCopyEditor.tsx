"use client";
// Hook & kompatibilitas editor S&K + cara aktivasi per varian (migrasi 0041).
// Tampilan baru memakai CopyVariantTable + CopyEditorSheet di ./copy/.
import { useCallback, useEffect, useState } from "react";
import type { VariantCopyEntry } from "@/lib/product-copy/format";
import { CopyEditorSheet, type OtherVariantOption } from "./copy/CopyEditorSheet";

export function useVariantCopyEntries(productId?: number | string) {
  const pid = Number(productId);
  const [entries, setEntries] = useState<Map<number, VariantCopyEntry>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { dirty: boolean; saving: boolean }>>({});

  const report = useCallback((id: number, dirty: boolean, saving: boolean) => {
    setDrafts((prev) =>
      prev[id]?.dirty === dirty && prev[id]?.saving === saving
        ? prev
        : { ...prev, [id]: { dirty, saving } },
    );
  }, []);

  const load = useCallback(async () => {
    if (!Number.isInteger(pid) || pid <= 0) {
      setEntries(new Map());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/variant-copy?product_id=${pid}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        variants?: VariantCopyEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `S&K varian gagal dimuat (${res.status})`);
      setEntries(new Map((data.variants ?? []).map((entry) => [entry.variantId, entry])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "S&K varian gagal dimuat");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((entry: VariantCopyEntry) => {
    setEntries((prev) => new Map(prev).set(entry.variantId, entry));
  }, []);

  const updateMany = useCallback((variants: VariantCopyEntry[]) => {
    setEntries((prev) => {
      const next = new Map(prev);
      for (const entry of variants) next.set(entry.variantId, entry);
      return next;
    });
  }, []);

  return {
    entries,
    loading,
    error,
    reload: load,
    update,
    updateMany,
    report,
    dirty: Object.values(drafts).some((d) => d.dirty),
    saving: Object.values(drafts).some((d) => d.saving),
  };
}

export type VariantCopyState = ReturnType<typeof useVariantCopyEntries>;

export { CopyEditorSheet, type OtherVariantOption };
