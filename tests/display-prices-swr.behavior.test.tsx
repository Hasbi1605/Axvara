// @vitest-environment jsdom
// useDisplayPrices: stale-while-revalidate. Nominal yang sudah diketahui TIDAK pernah dikosongkan saat daftar berubah (qty +/-),
// hanya nominal yang belum diketahui diminta; version/effectiveAt/unavailable mengosongkan cache. Klien tidak pernah menghitung USD.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { DisplayPreferencesProvider, useDisplayPrices } from "@/hooks/useDisplayPrices";
import { CHANGE_EVENT } from "@/hooks/usePreferences";

const clearCookies = () => { document.cookie = "axv_currency=; Max-Age=0; Path=/"; document.cookie = "axv_locale=; Max-Age=0; Path=/"; };
beforeEach(() => { document.cookie = "axv_locale=en; Path=/"; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCookies(); });

type Pending = { amounts: number[]; resolve: (response: Response) => void; reject: (error: Error) => void };
function stubFetch() {
  const pending: Pending[] = [];
  const bodies: number[][] = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const amounts = (JSON.parse(String(init.body)) as { amounts: number[] }).amounts;
    bodies.push(amounts);
    pending.push({ amounts, resolve, reject });
  })));
  return { pending, bodies };
}
const CENTS: Record<number, string> = { 8000: "55", 64000: "441", 80000: "552", 72000: "496" };
const reply = (amounts: number[], effectiveAt = "2026-11-04T00:00:00Z", extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ locale: "en", currency: "USD", fx: { available: true, effectiveAt }, items: amounts.map((idr) => ({ idr, usdCents: CENTS[idr] })), ...extra }), { status: 200 });
const unavailable = (amounts: number[]) =>
  new Response(JSON.stringify({ locale: "en", currency: "USD", fx: { available: false }, items: amounts.map((idr) => ({ idr, usdCents: null })) }), { status: 200 });

let setAmounts: (next: number[]) => void = () => {};
function View({ initial, secondary = false }: { initial: number[]; secondary?: boolean }) {
  const [amounts, set] = useState(initial);
  setAmounts = set;
  const prices = useDisplayPrices(amounts, { secondary, debounce: true });
  return (
    <div>
      <span data-testid="status">{prices.status}</span>
      {amounts.map((idr) => <span key={idr} data-testid={`text-${idr}`}>{prices.text(idr)}</span>)}
      {amounts.map((idr) => <span key={`e${idr}`} data-testid={`eq-${idr}`}>{prices.equivalent(idr) ?? "none"}</span>)}
    </div>
  );
}
const val = (id: string) => screen.getByTestId(id).textContent;
const settle = async (p: Pending, response: Response) => { await act(async () => { p.resolve(response); }); };

describe("secondary USD equivalent (IDR display)", () => {
  it("qty berubah: setara USD nominal yang sudah diketahui tetap tampil selama request jalan; hanya nominal baru yang di-POST", async () => {
    document.cookie = "axv_currency=IDR; Path=/";
    const { pending, bodies } = stubFetch();
    render(<DisplayPreferencesProvider><View initial={[8000, 80000]} secondary /></DisplayPreferencesProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(bodies[0]).toEqual([8000, 80000]);
    expect(val("status")).toBe("loading");
    await settle(pending[0], reply([8000, 80000]));
    expect(val("eq-8000")).toBe("≈ US$0.55");
    expect(val("status")).toBe("ready");
    act(() => setAmounts([8000, 64000]));
    expect(val("eq-8000")).toBe("≈ US$0.55"); // tidak berkedip saat daftar berubah
    expect(val("eq-64000")).toBe("none");
    expect(val("status")).toBe("loading"); // hanya selama ada nominal diminta yang belum diketahui
    await waitFor(() => expect(pending).toHaveLength(2)); // debounce selesai
    expect(bodies[1]).toEqual([64000]); // hanya yang belum diketahui
    expect(val("eq-8000")).toBe("≈ US$0.55"); // masih tampil selama request berjalan
    await settle(pending[1], reply([64000]));
    expect(val("eq-64000")).toBe("≈ US$4.41");
    expect(val("eq-8000")).toBe("≈ US$0.55");
    expect(val("status")).toBe("ready");
    act(() => setAmounts([8000, 80000])); // nominal lama yang pernah diketahui kembali: tanpa request baru
    expect(val("eq-80000")).toBe("≈ US$5.52");
    expect(val("status")).toBe("ready");
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(pending).toHaveLength(2);
  });

  it("perubahan version (preferensi) mengosongkan cache dan meminta ulang SEMUA nominal", async () => {
    document.cookie = "axv_currency=IDR; Path=/";
    const { pending, bodies } = stubFetch();
    render(<DisplayPreferencesProvider><View initial={[8000, 64000]} secondary /></DisplayPreferencesProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0], reply([8000, 64000]));
    expect(val("eq-8000")).toBe("≈ US$0.55");
    document.cookie = "axv_locale=id; Path=/"; // preferensi eksplisit berubah
    act(() => { window.dispatchEvent(new Event(CHANGE_EVENT)); });
    expect(val("eq-8000")).toBe("none");
    expect(val("eq-64000")).toBe("none");
    await waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(2));
    expect(bodies[bodies.length - 1]).toEqual([8000, 64000]);
  });

  it("respons dengan effectiveAt berbeda MENGGANTI cache (nominal lama diminta ulang), bukan menggabung", async () => {
    document.cookie = "axv_currency=IDR; Path=/";
    const { pending, bodies } = stubFetch();
    render(<DisplayPreferencesProvider><View initial={[8000, 80000]} secondary /></DisplayPreferencesProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0], reply([8000, 80000], "2026-11-04T00:00:00Z"));
    act(() => setAmounts([8000, 64000]));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(bodies[1]).toEqual([64000]);
    await settle(pending[1], reply([64000], "2026-11-04T06:00:00Z")); // snapshot FX baru
    expect(val("eq-64000")).toBe("≈ US$4.41");
    expect(val("eq-8000")).toBe("none"); // kurs lama tidak dicampur dengan kurs baru
    await waitFor(() => expect(pending).toHaveLength(3));
    expect(bodies[2]).toEqual([8000]);
    await settle(pending[2], reply([8000], "2026-11-04T06:00:00Z"));
    expect(val("eq-8000")).toBe("≈ US$0.55");
    expect(val("eq-64000")).toBe("≈ US$4.41");
  });

  it("'tidak tersedia' mengosongkan cache; galat jaringan mempertahankan nilai lama (lingkup sama)", async () => {
    document.cookie = "axv_currency=IDR; Path=/";
    const { pending } = stubFetch();
    render(<DisplayPreferencesProvider><View initial={[8000]} secondary /></DisplayPreferencesProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0], reply([8000]));
    act(() => setAmounts([8000, 64000]));
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1].reject(new Error("network")); });
    expect(val("eq-8000")).toBe("≈ US$0.55"); // dipertahankan
    expect(val("eq-64000")).toBe("none");
    expect(val("status")).toBe("unavailable");
    act(() => setAmounts([8000, 72000]));
    await waitFor(() => expect(pending).toHaveLength(3));
    await settle(pending[2], unavailable([72000])); // FX hilang
    expect(val("eq-8000")).toBe("none");
    expect(val("eq-72000")).toBe("none");
    expect(val("status")).toBe("unavailable");
  });
});

describe("USD display mode", () => {
  it("teks harga nominal yang sudah diketahui TIDAK pernah menampilkan '…' saat qty berubah; hanya nominal baru yang '…' sampai respons", async () => {
    document.cookie = "axv_currency=USD; Path=/";
    const { pending, bodies } = stubFetch();
    render(<DisplayPreferencesProvider><View initial={[8000, 80000]} /></DisplayPreferencesProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(val("text-8000")).toBe("…");
    await settle(pending[0], reply([8000, 80000]));
    expect(val("text-8000")).toBe("US$0.55");
    expect(val("text-80000")).toBe("US$5.52");
    act(() => setAmounts([8000, 64000]));
    expect(val("text-8000")).toBe("US$0.55"); // tidak berkedip
    expect(val("text-64000")).toBe("…");
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(bodies[1]).toEqual([64000]);
    expect(val("text-8000")).toBe("US$0.55");
    await settle(pending[1], reply([64000]));
    expect(val("text-64000")).toBe("US$4.41");
    expect(screen.queryByText("…")).toBeNull();
  });

  it("tidak tersedia: kembali ke Rupiah (bukan '…') dan tanpa USD karangan", async () => {
    document.cookie = "axv_currency=USD; Path=/";
    const { pending } = stubFetch();
    render(<DisplayPreferencesProvider><View initial={[8000]} /></DisplayPreferencesProvider>);
    await waitFor(() => expect(pending).toHaveLength(1));
    await settle(pending[0], unavailable([8000]));
    expect(val("text-8000")).toMatch(/^Rp\s?8\.000$/);
  });
});
