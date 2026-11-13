"use client";
import { Label, Textarea } from "@/components/admin/ui";
import { useId } from "react";
import { VARIANT_COPY_MAX_CHARS } from "@/lib/product-copy/format";

export type SharedCopyFields = { admin_terms?: string; admin_activation?: string };
export function SharedVariantCopyFields({ value, onChange }: { value: SharedCopyFields; onChange: (patch: SharedCopyFields) => void }) {
  const id = useId();
  return <section className="mt-4 space-y-3 border-t border-admin-border pt-4" aria-label="Panduan bersama varian">
    <div><h4 className="text-xs font-semibold text-admin-fg">S&K dan panduan bersama</h4><p className="mt-1 text-xs leading-5 text-admin-muted">Berlaku untuk setiap pembeli varian ini. Link, akun, atau key khusus pembeli tetap di stok kredensial. Panduan disimpan lewat Simpan Produk.</p></div>
    <Label className="block" htmlFor={`${id}-terms`}><span className="text-xs font-medium text-admin-muted">S&K bersama</span><Textarea id={`${id}-terms`} value={value.admin_terms??''} onChange={e=>onChange({admin_terms:e.target.value})} maxLength={VARIANT_COPY_MAX_CHARS} rows={4} placeholder={'- Link hanya untuk satu pembeli\n- Jangan membagikan akses'} className="mt-2 w-full resize-y rounded-xl border border-admin-border bg-admin-card/65 p-3 text-sm leading-5 text-admin-fg outline-none placeholder:text-admin-muted focus:border-admin-accent/40"/></Label>
    <Label className="block" htmlFor={`${id}-activation`}><span className="text-xs font-medium text-admin-muted">Cara penggunaan / aktivasi bersama</span><Textarea id={`${id}-activation`} value={value.admin_activation??''} onChange={e=>onChange({admin_activation:e.target.value})} maxLength={VARIANT_COPY_MAX_CHARS} rows={4} placeholder={'1. Buka link yang diterima\n2. Ikuti petunjuk aktivasi\n3. Hubungi admin jika ada kendala'} className="mt-2 w-full resize-y rounded-xl border border-admin-border bg-admin-card/65 p-3 text-sm leading-5 text-admin-fg outline-none placeholder:text-admin-muted focus:border-admin-accent/40"/></Label>
  </section>;
}
