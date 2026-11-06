import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { isPaymentAdminTestEnabled } from "@/lib/payments/rails";
import { PaymentTestProvider } from "@/components/storefront/PaymentTestScope";
import CheckoutPage from "@/app/(shop)/checkout/page";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tes pembayaran admin", robots: { index: false, follow: false } };

export default async function PaymentTestPage() {
  const request = new Request("https://axvara.tech/admin/payments/test", { headers: await headers() });
  if (!await requireAdmin(request)) redirect("/admin");
  if (!isPaymentAdminTestEnabled()) return <p className="mx-auto max-w-3xl px-4 py-24 text-white">Tes pembayaran nonaktif.</p>;
  return <>
    <div className="mx-auto max-w-7xl px-4 pt-8">
      <Link href="/admin" className="text-sm text-cyan-300 underline">Kembali ke admin</Link>
      <p className="mt-3 text-sm text-white/70">Tambahkan produk ke keranjang, lalu kembali ke halaman ini untuk membayar dengan NOWPayments atau Sekalipay. Ini pesanan nyata, bukan simulasi.</p>
    </div>
    <PaymentTestProvider><CheckoutPage /></PaymentTestProvider>
  </>;
}
