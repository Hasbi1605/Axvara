import { PAYMENT_MAINTENANCE_MESSAGE, PAYMENT_MANUAL_ORDER_URL } from "@/lib/payment-maintenance";

const linkClass = "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#080C1E] transition hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300";

export function PaymentMaintenanceNotice() {
  return (
    <aside aria-label="Pemberitahuan pembayaran" className="relative border-y border-white/10 bg-white/[0.04]">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="max-w-3xl text-sm leading-relaxed text-white/80">{PAYMENT_MAINTENANCE_MESSAGE}</p>
        <a href={PAYMENT_MANUAL_ORDER_URL} className={linkClass}>Order manual via WhatsApp</a>
      </div>
    </aside>
  );
}

export function ManualOrderPanel() {
  return (
    <section className="mx-auto max-w-xl px-4 py-14 sm:py-20" aria-labelledby="payment-maintenance-title">
      <h1 id="payment-maintenance-title" className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Pembayaran sedang maintenance</h1>
      <p className="mt-5 text-base leading-relaxed text-white/70">Untuk sementara, order dibantu langsung oleh admin lewat WhatsApp.</p>
      <a href={PAYMENT_MANUAL_ORDER_URL} className={`${linkClass} mt-7 w-full sm:w-auto`}>Order manual via WhatsApp</a>
      <p className="mt-6 text-sm leading-relaxed text-white/60">Sudah membayar? Simpan bukti pembayaran dan hubungi admin dengan kode pesananmu.</p>
    </section>
  );
}
