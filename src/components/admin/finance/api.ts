// Klien fetch kecil untuk API keuangan admin (pengeluaran + biaya pembayaran).
const MESSAGES: Record<string, string> = {
  order_not_found: "Kode order tidak ditemukan.",
  not_found: "Data sudah tidak ada. Muat ulang halaman.",
  future_date: "Tanggal tidak boleh di masa depan.",
};

export async function financeRequest<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: "no-store", ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
  const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
  if (!res.ok) {
    if (res.status === 401) throw new Error("Sesi admin berakhir. Masuk ulang.");
    if (res.status === 429) throw new Error("Terlalu banyak permintaan, coba lagi 1 menit.");
    throw new Error((body.error && MESSAGES[body.error]) || body.message || body.error || `Permintaan gagal (${res.status}).`);
  }
  return body as T;
}
