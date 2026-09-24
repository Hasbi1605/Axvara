/**
 * Browser tidak punya batas waktu bawaan untuk fetch: di jaringan buruk
 * permintaan bisa menggantung berapa menit pun dan spinner berputar tanpa
 * kabar. Helper ini membatalkan permintaan setelah `ms` dan melempar
 * `FetchTimeoutError` agar UI bisa menawarkan "Coba lagi".
 */
export class FetchTimeoutError extends Error {
  constructor(message = "Koneksi lambat — server belum menjawab. Periksa internet lalu coba lagi.") {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 20_000): Promise<Response> {
  const controller = new AbortController();
  const outer = init.signal;
  const onOuterAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new FetchTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuterAbort);
  }
}
