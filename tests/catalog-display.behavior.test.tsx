// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { DisplayPreferencesProvider, useDisplayContext, useDisplayPrices, usdText } from "@/hooks/useDisplayPrices";
import { Price, PriceNote } from "@/components/storefront/Price";
import { CHANGE_EVENT } from "@/hooks/usePreferences";
import { catalogDeliveryBadge, catalogDeliveryEta, catalogWarranty } from "@/lib/i18n/catalog-copy";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.cookie = "axv_currency=; Max-Age=0; Path=/"; document.cookie = "axv_locale=; Max-Age=0; Path=/"; });

it("batches catalog amounts and renders the server's cents without writing preferences", async () => {
  document.cookie = "axv_currency=USD; Path=/";
  document.cookie = "axv_locale=en; Path=/";
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const { amounts } = JSON.parse(String(init.body)) as { amounts: number[] };
    return new Response(JSON.stringify({ locale: "en", currency: "USD", fx: { available: true, effectiveAt: "2026-11-04T00:00:00Z" }, items: amounts.map((idr) => ({ idr, usdCents: "123" })) }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  const writes = vi.spyOn(document, "cookie", "set");
  function Catalog() {
    const prices = useDisplayPrices(Array.from({ length: 24 }, (_, i) => 10000 + i));
    return <div>{prices.text(10000)}</div>;
  }
  render(<DisplayPreferencesProvider><Catalog /></DisplayPreferencesProvider>);
  await waitFor(() => expect(screen.getByText("US$1.23")).toBeTruthy());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).amounts).toHaveLength(24);
  expect(writes).not.toHaveBeenCalled();
  writes.mockRestore();
});

it("defaults locally while offline and applies manual choices without a detection request", async () => {
  const fetcher = vi.fn(() => Promise.reject(new Error("offline")));
  vi.stubGlobal("fetch", fetcher);
  function View() { const { locale, currency } = useDisplayContext(); return <div>{locale}/{currency}</div>; }
  render(<DisplayPreferencesProvider><View /></DisplayPreferencesProvider>);
  expect(screen.getByText("id/IDR")).toBeTruthy();
  document.cookie = "axv_locale=en; Path=/";
  act(() => window.dispatchEvent(new Event(CHANGE_EVENT)));
  expect(screen.getByText("en/IDR")).toBeTruthy();
  document.cookie = "axv_currency=USD; Path=/";
  act(() => window.dispatchEvent(new Event(CHANGE_EVENT)));
  expect(screen.getByText("en/USD")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["snapshot", "preference"])("chunks unique amounts and falls back if %s disagrees", async (difference) => {
  document.cookie = "axv_currency=USD; Path=/";
  document.cookie = "axv_locale=en; Path=/";
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const { amounts } = JSON.parse(String(init.body)) as { amounts: number[] };
    return new Response(JSON.stringify({ locale: difference === "preference" && amounts[0] !== 10000 ? "id" : "en", currency: "USD", fx: { available: true, effectiveAt: difference === "snapshot" ? String(amounts[0]) : "same" }, items: amounts.map((idr) => ({ idr, usdCents: "123" })) }));
  });
  vi.stubGlobal("fetch", fetcher);
  function Catalog() {
    const prices = useDisplayPrices([...Array.from({ length: 65 }, (_, i) => 10000 + i), 10000]);
    return <><Price idr={10000} prices={prices} /><PriceNote prices={prices} /></>;
  }
  render(<DisplayPreferencesProvider><Catalog /></DisplayPreferencesProvider>);
  await waitFor(() => expect(screen.getByText("Prices shown in IDR.")).toBeTruthy());
  expect(screen.getByText(/Rp\s*10\.000/)).toBeTruthy();
  expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String(init.body)).amounts.length)).toEqual([64, 1]);
});

it("drops a stale total even when the old request ignores abort", async () => {
  document.cookie = "axv_currency=USD; Path=/";
  document.cookie = "axv_locale=en; Path=/";
  const pending: Array<{ amount: number; signal: AbortSignal; resolve: (value: Response) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => pending.push({ amount: JSON.parse(String(init.body)).amounts[0], signal: init.signal as AbortSignal, resolve }))));
  function Cart() {
    const [amount, setAmount] = useState(99000);
    const prices = useDisplayPrices([amount], { debounce: true });
    return <><button onClick={() => setAmount(108000)}>change</button><Price idr={amount} prices={prices} /></>;
  }
  render(<DisplayPreferencesProvider><Cart /></DisplayPreferencesProvider>);
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.click(screen.getByText("change"));
  expect(pending[0].signal.aborted).toBe(true);
  await waitFor(() => expect(pending).toHaveLength(2));
  const result = (amount: number, cents: string) => new Response(JSON.stringify({ locale: "en", currency: "USD", fx: { available: true, effectiveAt: "now" }, items: [{ idr: amount, usdCents: cents }] }));
  await act(async () => pending[1].resolve(result(108000, "777")));
  await waitFor(() => expect(screen.getByText("US$7.77")).toBeTruthy());
  await act(async () => pending[0].resolve(result(99000, "999")));
  expect(screen.getByText("US$7.77")).toBeTruthy();
});

it.each(["reject", "http", "unavailable", "timeout"])("%s keeps USD preference and cart usable with one IDR note", async (failure) => {
  document.cookie = "axv_currency=USD; Path=/";
  document.cookie = "axv_locale=en; Path=/";
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    if (failure === "reject") return Promise.reject(new Error("offline"));
    if (failure === "http") return Promise.resolve(new Response("", { status: 503 }));
    if (failure === "unavailable") return Promise.resolve(new Response(JSON.stringify({ locale: "en", currency: "USD", fx: { available: false }, items: [{ idr: 10000, usdCents: null }] })));
    return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  }));
  function Cart() {
    const [qty, setQty] = useState(1);
    const prices = useDisplayPrices([10000]);
    return <><button onClick={() => setQty(qty + 1)}>cart {qty}</button><Price idr={10000} prices={prices} /><PriceNote prices={prices} /></>;
  }
  if (failure === "timeout") vi.useFakeTimers();
  render(<DisplayPreferencesProvider><Cart /></DisplayPreferencesProvider>);
  if (failure === "timeout") await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
  else await waitFor(() => expect(screen.getByText("Prices shown in IDR.")).toBeTruthy());
  expect(screen.getAllByText("Prices shown in IDR.")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "cart 1" }));
  expect(screen.getByRole("button", { name: "cart 2" })).toBeTruthy();
  expect(document.cookie).toContain("axv_currency=USD");
  vi.useRealTimers();
});

it("distinguishes zero from a positive amount rounded below one cent", () => {
  expect(usdText("0", 0, "en")).toBe("US$0.00");
  expect(usdText("0", 1, "en")).toBe("< US$0.01");
});

it("translates generated delivery and warranty labels without translating custom labels", () => {
  const v = { fulfillment_mode: "manual", warranty_type: "limited", warranty_value: 2, warranty_unit: "month", warranty_label: null } as never;
  expect(catalogDeliveryBadge(v, "en")).toBe("Made By Order");
  expect(catalogDeliveryEta(v, "en")).toContain("prepared by admin");
  expect(catalogWarranty(v, "en")).toBe("Warranty 2 months");
  expect(catalogWarranty({ ...v as object, warranty_type: "custom", warranty_label: "Owner label" } as never, "en")).toBe("Owner label");
});

it.each([
  ["id", "USD", "id/USD"], ["en", "IDR", "en/IDR"], [null, null, "id/IDR"], ["en", null, "en/IDR"], [null, "USD", "id/USD"],
])("resolves independent manual preferences and fixed defaults without requests or cookie writes", async (locale, currency, expected) => {
  if (locale) document.cookie = `axv_locale=${locale}; Path=/`;
  if (currency) document.cookie = `axv_currency=${currency}; Path=/`;
  const writes = vi.spyOn(document, "cookie", "set");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  function View() { const { locale, currency, settled } = useDisplayContext(); return <div>{settled ? `${locale}/${currency}` : "pending"}</div>; }
  render(<DisplayPreferencesProvider><View /></DisplayPreferencesProvider>);
  await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
  expect(writes).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  writes.mockRestore();
});

it("keeps FX and server environment out of catalog display clients", () => {
  for (const file of ["src/hooks/useDisplayPrices.tsx", "src/components/storefront/Price.tsx", "src/app/(shop)/home-client.tsx", "src/app/(shop)/produk/[slug]/product-detail-client.tsx", "src/components/storefront/QuickVariantModal.tsx", "src/components/storefront/CartDrawer.tsx"]) {
    expect(readFileSync(file, "utf8")).not.toMatch(/payments\/fx|i18n\/format|process\.env\.USD_/);
  }
});
