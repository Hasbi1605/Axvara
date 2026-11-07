// @vitest-environment jsdom
// Kontrol preferensi: bahasa (axv_locale ID/EN) dan mata uang (axv_currency
// IDR/USD) saling bebas, hanya cookie valid, tanpa menyentuh quote/pesanan,
// tanpa FX di klien; preferensi USD dipertahankan saat konversi server tidak ada.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";

configure({ asyncUtilTimeout: 4000 });

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({ code: "AXV-20261104-ABCD1234" }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/payment-maintenance", () => ({ isPaymentMaintenanceEnabled: () => false }));

import { PreferenceControls } from "@/components/storefront/PreferenceControls";
import { preferenceCookie } from "@/lib/i18n/locale";
import { readExplicitPreferences } from "@/hooks/usePreferences";
import { formatUsdCentsText, usdPreferenceView } from "@/lib/payment-ui";
import CheckoutPage from "@/app/(shop)/checkout/page";
import OrderPage from "@/app/(shop)/pesanan/[code]/page";
import { useCart, type CartItem } from "@/stores/cart";

const norm = (t: string | null | undefined) => String(t ?? "").replace(/\s/g, " ");
const clearCookies = () => document.cookie.split(";").forEach((c) => { const name = c.split("=")[0].trim(); if (name) document.cookie = `${name}=; Max-Age=0; Path=/`; });
const open = () => fireEvent.click(screen.getByRole("button", { name: /Bahasa dan mata uang|Language and currency/ }));
const radio = (group: string, re: RegExp) => (screen.getAllByRole("radio") as HTMLInputElement[]).filter((r) => r.name === group).find((r) => re.test(r.closest("label")?.textContent ?? ""))!;

beforeEach(() => { clearCookies(); nav.refresh.mockClear(); localStorage.clear(); sessionStorage.clear(); document.documentElement.lang = "id"; window.scrollTo = vi.fn(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PreferenceControls (bendera bulat + menu ringkas dua bagian)", () => {
  const trigger = () => screen.getByRole("button", { name: /Bahasa dan mata uang|Language and currency/ });

  it("belum dipilih: globe netral (bukan bendera tebakan), nama aksesibel jujur, tanpa radio tercentang; menu dua bagian independen; Escape menutup dan fokus kembali", () => {
    render(<PreferenceControls />);
    const button = trigger();
    expect(button.getAttribute("aria-label")).toBe("Bahasa dan mata uang: Bahasa belum dipilih, Mata uang belum dipilih");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.className).toContain("h-11");
    expect(button.className).toContain("w-11");
    expect(button.querySelector("[data-globe]")).toBeTruthy();
    expect(button.querySelector("[data-flag]")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const dialog = screen.getByRole("dialog", { name: "Bahasa dan mata uang" });
    expect(button.getAttribute("aria-controls")).toBe(dialog.id);
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((r) => !r.checked)).toBe(true); // auto: tanpa centang
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    const labels = Array.from(dialog.querySelectorAll("label"));
    expect(labels.every((l) => l.className.includes("min-h-11"))).toBe(true);
    expect(labels.map((l) => norm(l.textContent))).toEqual(["Bahasa Indonesia", "English (UK)", "RpRupiah (IDR)", "US$US Dollar (USD)"]);
    expect(screen.getByRole("group", { name: "Bahasa" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Mata uang" })).toBeTruthy();
    expect(dialog.textContent).toContain("Pesanan yang sudah dibuat tidak berubah.");
    expect(dialog.textContent).not.toMatch(/Tutup|Dipilih otomatis/); // tanpa tombol Tutup / copy besar
    expect(dialog.className).toContain("w-[min(320px,calc(100vw-1.5rem))]"); // kompak, bukan bottom sheet
    expect(dialog.className).not.toContain("bottom-0");
    button.blur();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("pemicu = bendera bulat sesuai bahasa efektif (ID/GB) dan nama aksesibel memuat bahasa + mata uang; klik luar menutup", () => {
    document.cookie = preferenceCookie("axv_locale", "en", false);
    document.cookie = preferenceCookie("axv_currency", "IDR", false);
    render(<PreferenceControls />);
    const button = trigger();
    expect(button.getAttribute("aria-label")).toBe("Language and currency: English (UK), Rupiah (IDR)");
    const flag = button.querySelector("img[data-flag]")!;
    expect(flag.getAttribute("src")).toBe("/flags/gb.svg");
    expect(flag.className).toContain("rounded-full");
    expect(flag.getAttribute("alt")).toBe("");
    fireEvent.click(button);
    expect(radio("axv-pref-locale", /English/).checked).toBe(true);
    expect(radio("axv-pref-currency", /Rupiah/).checked).toBe(true);
    expect(screen.getByRole("dialog").textContent).toContain("Existing orders don't change.");
    const checked = screen.getByRole("dialog").querySelectorAll("svg"); // ✓ hanya pada baris terpilih (bukan warna saja)
    expect(checked.length).toBe(2);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    document.cookie = preferenceCookie("axv_locale", "id", false);
    render(<PreferenceControls />);
    expect(trigger().querySelector("img[data-flag]")!.getAttribute("src")).toBe("/flags/id.svg");
  });

  it("bahasa dan mata uang saling bebas: memilih satu hanya menulis cookie itu, refresh native, <html lang> mengikuti; EN tidak mengubah mata uang", () => {
    render(<PreferenceControls />);
    const writes: string[] = [];
    const setter = vi.spyOn(document, "cookie", "set");
    setter.mockImplementation((value: string) => { writes.push(value); });
    fireEvent.click(trigger());
    fireEvent.click(radio("axv-pref-locale", /English/));
    expect(writes).toEqual(["axv_locale=en; Path=/; Max-Age=31536000; SameSite=Lax"]);
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(document.documentElement.lang).toBe("en");
    fireEvent.click(radio("axv-pref-currency", /US Dollar/));
    expect(writes).toEqual(["axv_locale=en; Path=/; Max-Age=31536000; SameSite=Lax", "axv_currency=USD; Path=/; Max-Age=31536000; SameSite=Lax"]);
    expect(nav.refresh).toHaveBeenCalledTimes(2);
    expect(document.documentElement.lang).toBe("en");
    setter.mockRestore();
  });

  it("cookie tersimpan dibaca (valid saja); EN+IDR dan ID+USD sama-sama mungkin; mengganti satu tidak menyentuh yang lain", () => {
    document.cookie = preferenceCookie("axv_currency", "USD", false);
    render(<PreferenceControls />);
    fireEvent.click(trigger());
    expect(radio("axv-pref-currency", /US Dollar/).checked).toBe(true);
    expect(radio("axv-pref-locale", /Indonesia/).checked).toBe(false);
    fireEvent.click(radio("axv-pref-locale", /English/));
    expect(readExplicitPreferences()).toEqual({ locale: "en", currency: "USD" });
    fireEvent.click(radio("axv-pref-currency", /Rupiah/));
    expect(readExplicitPreferences()).toEqual({ locale: "en", currency: "IDR" }); // EN + IDR
    fireEvent.click(radio("axv-pref-locale", /Indonesia/));
    fireEvent.click(radio("axv-pref-currency", /US Dollar/));
    expect(readExplicitPreferences()).toEqual({ locale: "id", currency: "USD" }); // ID + USD
    expect(trigger().querySelector("img[data-flag]")!.getAttribute("src")).toBe("/flags/id.svg");
    expect(trigger().getAttribute("aria-label")).toBe("Bahasa dan mata uang: Indonesia, US Dollar (USD)");
  });

  it("cookie rusak/tidak valid diabaikan (tidak jadi pilihan); nilai ter-encode yang valid diterima; tak ada penyimpulan dari browser", () => {
    document.cookie = "axv_locale=fr; Path=/";
    document.cookie = "axv_currency=EUR; Path=/";
    expect(readExplicitPreferences()).toEqual({ locale: null, currency: null });
    document.cookie = "axv_locale=%65n; Path=/";
    document.cookie = "axv_currency=%E0%A4%A; Path=/"; // percent-encoding rusak
    expect(readExplicitPreferences()).toEqual({ locale: "en", currency: null });
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
    clearCookies();
    render(<PreferenceControls />);
    fireEvent.click(trigger());
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((r) => !r.checked)).toBe(true); // navigator tidak dipakai
    expect(trigger().querySelector("[data-flag]")).toBeNull(); // bendera tidak ditebak
  });

  it("preferensi tidak membuat klaim katalog lama atau mengubah pesanan; tanpa cookie tulis saat dibuka; radio native; tanpa fetch klien", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const writes: string[] = [];
    const setter = vi.spyOn(document, "cookie", "set");
    setter.mockImplementation((value: string) => { writes.push(value); });
    render(<PreferenceControls />);
    fireEvent.click(trigger());
    expect(writes).toEqual([]);
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).every((r) => r.type === "radio")).toBe(true); // panah/roving native dari browser
    fireEvent.click(radio("axv-pref-currency", /US Dollar/));
    expect(screen.getByRole("dialog").textContent).not.toContain("Harga katalog saat ini tetap Rupiah");
    fireEvent.click(radio("axv-pref-locale", /English/));
    expect(screen.getByRole("dialog").textContent).toContain("Pesanan yang sudah dibuat tidak berubah."); // cookie dimock: bahasa efektif tetap ID
    expect(fetcher).not.toHaveBeenCalled();
    setter.mockRestore();
  });

  it("USD dipilih tetapi konversi server tidak ada: catatan jujur di menu; hanya POST /api/display-prices (hook harga yang sama)", async () => {
    const { DisplayPreferencesProvider } = await import("@/hooks/useDisplayPrices");
    document.cookie = preferenceCookie("axv_currency", "USD", false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ locale: "id", currency: "USD", fx: { available: false, effectiveAt: null }, items: [{ idr: 0, usdCents: null }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<DisplayPreferencesProvider><PreferenceControls /></DisplayPreferencesProvider>);
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Harga ditampilkan dalam Rupiah."));
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.every(([url, init]) => url === "/api/display-prices" && (init as RequestInit).method === "POST")).toBe(true);
  });

  it("cookie: Secure hanya di HTTPS; nilai tidak valid ditolak", () => {
    expect(preferenceCookie("axv_locale", "en", true)).toBe("axv_locale=en; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    expect(preferenceCookie("axv_currency", "IDR", false)).toBe("axv_currency=IDR; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(() => preferenceCookie("axv_currency", "EUR" as never, false)).toThrow("invalid_preference");
    expect(() => preferenceCookie("axv_locale", "fr" as never, false)).toThrow("invalid_preference");
  });
});

describe("tampilan USD dari server (tanpa FX klien)", () => {
  it("sen string server -> teks persis, besar/kecil; bukan angka valid -> null", () => {
    expect(formatUsdCentsText("1563", "en")).toBe("US$15.63");
    expect(formatUsdCentsText("5", "en")).toBe("US$0.05");
    expect(formatUsdCentsText("123456789012345", "en")).toBe("US$1,234,567,890,123.45");
    expect(formatUsdCentsText("1563", "id")).toBe("US$15,63");
    for (const bad of ["15.63", "-1", "abc", "", 15, null, "1".repeat(16)]) expect(formatUsdCentsText(bad, "en")).toBeNull();
  });
  it("preferensi USD tanpa konversi tersedia tetap 'unavailable' (bukan IDR berlabel USD)", () => {
    expect(usdPreferenceView({ currency: "USD", usdAvailable: false, usdCents: null }, "id")).toEqual({ kind: "unavailable" });
    expect(usdPreferenceView({ currency: "USD", usdAvailable: true, usdCents: "oops" }, "id")).toEqual({ kind: "unavailable" });
    expect(usdPreferenceView({ currency: "USD", usdAvailable: true, usdCents: "1563" }, "en")).toEqual({ kind: "equivalent", text: "US$15.63" });
    expect(usdPreferenceView({ currency: "IDR", usdAvailable: true, usdCents: "1563" }, "id")).toBeNull();
    expect(usdPreferenceView(undefined, "id")).toBeNull();
  });
});

describe("checkout menghormati preferensi tanpa mengubah rel/jumlah", () => {
  const qrisM = { id: "qris", kind: "qris", label: "QRIS", sublabel: null, account_number: "", account_name: "", qris_url: null, currency: "IDR", available: true };
  function quote(displayPreferences: Record<string, unknown>) {
    const line = { product_id: 1, variant_id: 11, name: "GPT Plus", price: 250_000, qty: 1, stock: -1, image: "/x.png", queued_delivery: false };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [line], subtotal: 250_000, quoteToken: "quote-token-fixture-123456", paymentMethods: [qrisM], locale: displayPreferences.locale, displayPreferences }), { status: 200, headers: { "Content-Type": "application/json" } })));
    useCart.setState({ items: [{ id: "1", slug: "gpt-plus", name: "GPT Plus", description: "", categorySlug: "ai", image: "/x.png", price: 250_000, qty: 1, variantId: 11, variantLabel: "1 Bulan", minQty: 1 } as unknown as CartItem] });
  }
  const rail = () => norm(document.querySelector("aside")?.textContent);

  it("USD tersedia: setara dari server di bawah total; jumlah IDR dan rel tetap; USD tidak tersedia: catatan Rupiah jujur", async () => {
    quote({ locale: "en", currency: "USD", usdAvailable: true, usdCents: "1563" });
    render(<CheckoutPage />);
    await waitFor(() => expect(screen.getAllByTestId("usd-preference-note").length).toBeGreaterThan(0));
    expect(screen.getAllByTestId("usd-preference-note").map((el) => norm(el.textContent))).toEqual(Array(screen.getAllByTestId("usd-preference-note").length).fill("Order subtotal ≈ US$15.63 (converted by the server)"));
    expect(rail()).toContain("Rp 250.000"); // IDR tidak diberi label USD dan tidak diganti
    await waitFor(() => expect((screen.getByRole("radio", { name: /QRIS/ }) as HTMLInputElement).checked).toBe(true)); // grup QRIS terbuka setelah efek pemilihan bawaan
    cleanup();
    quote({ locale: "id", currency: "USD", usdAvailable: false, usdCents: null });
    render(<CheckoutPage />);
    await waitFor(() => expect(screen.getAllByTestId("usd-preference-note").length).toBeGreaterThan(0));
    expect(norm(screen.getAllByTestId("usd-preference-note")[0].textContent)).toBe("Harga ditampilkan dalam Rupiah. Konversi USD belum tersedia.");
    expect(rail()).not.toMatch(/US\$/);
    expect(rail()).toContain("Rp 250.000");
    cleanup();
    quote({ locale: "id", currency: "IDR", usdAvailable: true, usdCents: "1563" });
    render(<CheckoutPage />);
    await waitFor(() => expect(screen.getAllByRole("radio").length).toBe(1));
    expect(screen.queryByTestId("usd-preference-note")).toBeNull();
  });

  it("mengganti preferensi global saat checkout tidak mengubah pilihan rel, quote, atau total", async () => {
    quote({ locale: "id", currency: "IDR", usdAvailable: false, usdCents: null });
    render(<><PreferenceControls /><CheckoutPage /></>);
    await waitFor(() => expect(screen.getAllByRole("radio").length).toBe(1 + 0));
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>;
    const before = fetcher.mock.calls.length;
    fireEvent.change(document.getElementById("checkout-wa")!, { target: { value: "081234567890" } });
    fireEvent.change(document.getElementById("checkout-email")!, { target: { value: "buyer@example.com" } });
    fireEvent.click(document.getElementById("checkout-agree")!);
    expect(rail()).toContain("Rp 250.000");
    open();
    fireEvent.click(radio("axv-pref-locale", /English/));
    fireEvent.click(radio("axv-pref-currency", /US Dollar/));
    expect(fetcher.mock.calls.length).toBe(before); // tanpa quote baru
    expect(rail()).toContain("Rp 250.000");
    expect(rail()).toContain("Order Summary");
    await waitFor(() => expect((screen.getByRole("radio", { name: /QRIS/ }) as HTMLInputElement).checked).toBe(true)); // grup QRIS terbuka setelah efek pemilihan bawaan
    expect((document.getElementById("checkout-wa") as HTMLInputElement).value).toBe("081234567890");
    expect((document.getElementById("checkout-email") as HTMLInputElement).value).toBe("buyer@example.com");
    expect((document.getElementById("checkout-agree") as HTMLInputElement).checked).toBe(true);
    expect(useCart.getState().items[0].price).toBe(250_000);
  });
});

describe("pesanan lama: locale tersimpan tidak berubah oleh preferensi global", () => {
  it("cookie axv_locale=id tetapi pesanan EN -> teks panel tetap EN; sebaliknya juga", async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const crypto = { provider: "nowpayments", kind: "crypto", label: "USDT", sublabel: "BNB Smart Chain", symbol: "USDT", network_label: "BNB Smart Chain", state: "pending", currency: "USD", amount_text: "15.87", pay_amount_text: "15.634512", pay_currency: "usdtbsc", network: "bsc", pay_address: "0x1234567890abcdef1234567890abcdef12345678", expires_at: future, fee_payer: "merchant", fixed_rate: false, sender_gas_extra: true };
    const order = (locale: string) => ({ order: { code: "AXV-20261104-ABCD1234", customer_name: "H", customer_wa: "08", customer_email: null, items: [{ name: "GPT", price: 250_000, qty: 1 }], subtotal: 250_000, payment_method: "nowpayments:usdtbsc", status: "pending", locale, expires_at: future, qris: null, credentials_ready: false, buyer_pin_required: true, payment: crypto } });
    for (const [cookieLocale, orderLocale, heading] of [["id", "en", "Crypto Payment"], ["en", "id", "Pembayaran Crypto"]] as const) {
      document.cookie = preferenceCookie("axv_locale", cookieLocale, false);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(order(orderLocale)), { status: 200, headers: { "Content-Type": "application/json" } })));
      render(<OrderPage />);
      await screen.findByRole("heading", { name: heading });
      cleanup();
    }
  });
});
