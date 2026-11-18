import Link from "next/link";
import { MARKET_INVOICE } from "@/lib/refund/calculate";
import { marketWarrantyClaim, marketWarrantyClaimEn } from "@/lib/warranty-policy";
import type { Locale } from "@/lib/i18n/locale";
import { orderCopy } from "@/lib/i18n/order-copy";
import { MobileCollapsible } from "@/components/storefront/ProductCopy";

/** Accordion pesanan ringkas; halaman ketentuan publik memuat aturan lengkap. */
export function WarrantyClaimBody({ size = "sm", locale = "id" }: { size?: "sm" | "xs"; locale?: Locale }) {
  const claim = locale === "en" ? marketWarrantyClaimEn : marketWarrantyClaim;
  const t = orderCopy(locale);
  const en = locale === "en";
  if (size === "xs") return <div className="space-y-2 text-xs leading-relaxed text-white/75">
    <p>{en ? "Submit a claim while your warranty is active. Include your invoice and a screenshot of the issue." : "Ajukan klaim selama garansi masih berlaku. Sertakan invoice dan screenshot kendala."}</p>
    <ul className="list-disc space-y-1.5 pl-4">
      <li>{en ? <>Warranty claims take <strong>1–3 days</strong>, depending on the queue, replacement stock, or provider issues.</> : <>Proses garansi <strong>1–3 hari</strong>, tergantung antrean, stok akun pengganti, atau gangguan dari pihak terkait.</>}</li>
      <li>{en ? <>If your claim is eligible and the issue remains unresolved after 3 days, we’ll refund the <strong>value of the time remaining when we received your report</strong>.</> : <>Jika klaim memenuhi syarat dan kendala belum teratasi setelah 3 hari, kami akan mengembalikan dana sesuai <strong>nilai sisa masa aktif produk saat laporan diterima</strong>.</>}</li>
    </ul>
    <p>{en ? <>Example: Rp30,000 for 30 days, 20 days left → estimated refund <strong>Rp20,000</strong>.</> : <>Contoh: Paket Rp30.000 untuk 30 hari, sisa 20 hari → estimasi refund <strong>Rp20.000</strong>.</>}</p>
  </div>;
  return (
    <div className="space-y-3 text-white/60 text-sm leading-6">
      <p>{claim.eligibility}</p>
      <ol className="list-decimal space-y-1.5 pl-5">
        {claim.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}
      </ol>
      <p className="font-semibold text-white/80">{t.warranty.note}</p>
      <ul className="list-disc space-y-2 pl-5">
        {claim.notes.map((note) => <li key={note}>{note}</li>)}
      </ul>
      <p>{claim.closing}</p>
    </div>
  );
}

export function WarrantyClaimAccordion({ className = "mt-6 text-left", locale = "id", code, adminView }: { className?: string; locale?: Locale; code?: string; adminView?: boolean }) {
  return (
    <div className={className}>
      <MobileCollapsible title={orderCopy(locale).warranty.title}>
        <WarrantyClaimBody size="xs" locale={locale} />
        {code && MARKET_INVOICE.test(code) && (adminView
          ? <a className="inline-flex min-h-11 items-center font-semibold text-cyan-200 underline underline-offset-4" href={`/admin/refund?code=${encodeURIComponent(code)}`}>Hitung Refund</a>
          : <Link prefetch={false} href={`/kalkulator-refund?code=${encodeURIComponent(code)}`} className="mt-1 inline-flex min-h-11 items-center rounded-md font-semibold text-cyan-200 underline decoration-cyan-200/40 underline-offset-4 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-cyan-300 motion-reduce:transition-none">{locale === "en" ? "Check refund estimate" : "Cek Estimasi Refund"}</Link>)}
      </MobileCollapsible>
    </div>
  );
}
