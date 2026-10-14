"use client";
import { useId } from "react";
import { VARIANT_COPY_MAX_CHARS } from "@/lib/product-copy/format";

export type SharedCopyFields = { admin_terms?: string; admin_activation?: string };
export function SharedVariantCopyFields({ value, onChange }: { value: SharedCopyFields; onChange: (patch: SharedCopyFields) => void }) {
  const id = useId();
  return <section className="mt-4 space-y-3 border-t border-white/10 pt-4" aria-label="Panduan bersama varian">
    <div><h4 className="text-xs font-semibold text-white">S&K dan panduan bersama</h4><p className="mt-1 text-[11px] leading-5 text-white/45">Berlaku untuk setiap pembeli varian ini. Link, akun, atau key khusus pembeli tetap di stok kredensial. Panduan disimpan lewat Simpan Produk.</p></div>
    <label className="block" htmlFor={`${id}-terms`}><span className="text-xs font-medium text-white/65">S&K bersama</span><textarea id={`${id}-terms`} value={value.admin_terms??''} onChange={e=>onChange({admin_terms:e.target.value})} maxLength={VARIANT_COPY_MAX_CHARS} rows={4} placeholder={'- Link hanya untuk satu pembeli\n- Jangan membagikan akses'} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 text-sm leading-5 text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40"/></label>
    <label className="block" htmlFor={`${id}-activation`}><span className="text-xs font-medium text-white/65">Cara penggunaan / aktivasi bersama</span><textarea id={`${id}-activation`} value={value.admin_activation??''} onChange={e=>onChange({admin_activation:e.target.value})} maxLength={VARIANT_COPY_MAX_CHARS} rows={4} placeholder={'1. Buka link yang diterima\n2. Ikuti petunjuk aktivasi\n3. Hubungi admin jika ada kendala'} className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#080C1E]/65 p-3 text-sm leading-5 text-white outline-none placeholder:text-white/25 focus:border-[#00E5FF]/40"/></label>
  </section>;
}
