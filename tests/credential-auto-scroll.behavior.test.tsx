// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WrCredentialsPanel, checkoutContactKey } from "@/components/storefront/WrCredentialsPanel";
import OrderSuccessPage from "@/app/(shop)/pesanan/[code]/page";
import LacakPesananClient from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import { DEFAULT_STORE_SETTINGS } from "@/lib/site";

const CODE = "AXV-20261015-SCROLL01";
const SECOND_CODE = "AXV-20261015-SCROLL02";
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ code: CODE }), useSearchParams: () => nav.params }));
vi.mock("@/hooks/useStoreSettings", () => ({ useStoreSettings: () => DEFAULT_STORE_SETTINGS }));

const scroll = vi.fn();
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); nav.params = new URLSearchParams(); scroll.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("scrollTo", scroll);
  vi.stubGlobal("scrollY", 100);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 640 } as DOMRect);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function response(body: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => body } as Response;
}
function credentials(label = "akun@example.test") {
  return { credentials: [{ details: `Email: ${label}`, completed_at: null, terms: { sections: [{ kind: "aturan", items: ["Gunakan sesuai paket"] }], activation: [], notes: [] } }], capability_token: null };
}
function accountScrolls() {
  return scroll.mock.calls;
}

describe("account details auto-scroll", () => {
  it("waits for verified content, scrolls once in StrictMode, and leaves subsequent interactions alone", async () => {
    let complete!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
    const view = render(<StrictMode><WrCredentialsPanel code={CODE} prefillContact="buyer@example.test" /></StrictMode>);
    await screen.findByRole("button", { name: "Memeriksa…" });
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => { complete(response(credentials())); });
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    const panel = screen.getByRole("region", { name: "Detail akun digital" });
    expect(panel).toBeTruthy();
    // Panel top 640 + current scroll 100 - navbar clearance 96.
    expect(scroll).toHaveBeenCalledWith({ top: 644, behavior: "smooth" });
    fireEvent.click(screen.getByRole("button", { name: "Syarat & Ketentuan" }));
    view.rerender(<StrictMode><WrCredentialsPanel code={CODE} prefillContact="buyer@example.test" contactHint="baru" /></StrictMode>);
    await act(async () => { await new Promise(requestAnimationFrame); });
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("uses instant scrolling for reduced motion even with the site's smooth-scroll CSS", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    sessionStorage.setItem(`wr-cred-token:${CODE}`, "saved-token");
    vi.stubGlobal("fetch", vi.fn(async () => response(credentials())));
    render(<WrCredentialsPanel code={CODE} />);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 644, behavior: "instant" }));
    expect(accountScrolls()).toHaveLength(1);
  });

  it.each([response({ error: "verification_failed" }, 403), response({ credentials: [] })])("does not scroll for failed or empty verification, but scrolls after a successful manual retry", async (initial) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(response(credentials())));
    render(<WrCredentialsPanel code={CODE} />);
    fireEvent.change(screen.getByLabelText("No. WA atau email checkout"), { target: { value: "buyer@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Tampilkan" }) as HTMLButtonElement).disabled).toBe(false));
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Tampilkan" }));
    await waitFor(() => expect(accountScrolls()).toHaveLength(1));
  });

  it("cancels a queued scroll when the panel unmounts", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 123));
    const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
    vi.stubGlobal("fetch", vi.fn(async () => response(credentials())));
    const view = render(<WrCredentialsPanel code={CODE} prefillContact="buyer@example.test" />);
    await screen.findByRole("region", { name: "Detail akun digital" });
    view.unmount();
    expect(cancel).toHaveBeenCalledWith(123);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("waits through payment and fulfillment polling before scrolling to the delivered account", async () => {
    vi.useFakeTimers();
    sessionStorage.setItem(checkoutContactKey(CODE), "buyer@example.test");
    const order = { code: CODE, status: "pending", credentials_ready: false, supplier_owned: true, supplier_running: true, fulfillment_status: "queued", customer_name: "Buyer", customer_wa: "081234567890", payment_method: "qris", subtotal: 10000, items: [{ name: "Akun", qty: 1, price: 10000 }] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => response(String(url).includes("/credentials") ? credentials() : { order })));
    render(<OrderSuccessPage />);
    const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await advance(50);
    expect(scroll).not.toHaveBeenCalled();
    order.status = "lunas";
    await advance(30050);
    expect(screen.getByText("Menyiapkan detail produkmu…")).toBeTruthy();
    expect(scroll).not.toHaveBeenCalled();
    order.credentials_ready = true; order.supplier_running = false; order.fulfillment_status = "delivered";
    await advance(2200); await advance(50);
    expect(accountScrolls()).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Detail akun digital" })).toBeTruthy();
    expect(scroll).toHaveBeenLastCalledWith({ top: 644, behavior: "smooth" });
    await advance(30000);
    expect(accountScrolls()).toHaveLength(1);
  });

  it("tracking scrolls to each newly verified order, without showing or scrolling to the previous account", async () => {
    nav.params = new URLSearchParams({ code: CODE, email: "buyer@example.test" });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/credentials")) return response(credentials(String(url).includes(SECOND_CODE) ? "second@example.test" : "first@example.test"));
      const code = JSON.parse(String(init?.body)).code;
      return response({ order: { code, status: "lunas", credentials_ready: true, customer_name: "Buyer", customer_wa: "081234567890", payment_method: "qris", subtotal: 10000, items: JSON.stringify([{ name: "Akun", price: 10000, qty: 1 }]) } });
    }));
    render(<LacakPesananClient />);
    await waitFor(() => expect(accountScrolls()).toHaveLength(1));
    expect(screen.getByText("Email: first@example.test")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Kode pesanan/), { target: { value: SECOND_CODE } });
    fireEvent.submit(screen.getByRole("form", { name: "Formulir lacak pesanan" }));
    await waitFor(() => expect(accountScrolls()).toHaveLength(2));
    expect(screen.getByText("Email: second@example.test")).toBeTruthy();
    expect(screen.queryByText("Email: first@example.test")).toBeNull();
    expect(scroll).toHaveBeenLastCalledWith({ top: 644, behavior: "smooth" });
  });
});
