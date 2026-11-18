// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WrCredentialsPanel } from "@/components/storefront/WrCredentialsPanel";
import { rememberCheckoutCredentialGrant, forgetCheckoutCredentialGrant } from "@/lib/order-access-client";

const CODE = "AXV-20261116-PAIDPIN1", PIN = "A3B7K2", TOKEN = "c".repeat(64);
vi.mock("next/navigation", () => ({ useParams: () => ({ code: "AXV-20261116-PAIDPIN1" }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/lacak-pesanan" }));
const grant = () => `c1.${Math.floor(Date.now() / 1000) + 86400}.${"a".repeat(43)}`;
const credentials = [{ details: "Email: fixture@example.test\nPassword: fixture-password", completed_at: null }];
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); forgetCheckoutCredentialGrant(CODE);
  vi.stubGlobal("requestAnimationFrame", () => 1);
});
afterEach(() => { cleanup(); forgetCheckoutCredentialGrant(CODE); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const hasNoPinPersistence = () => {
  expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain(PIN);
  expect(JSON.stringify(Object.entries(localStorage))).not.toContain(PIN);
  expect(location.href).not.toContain(PIN);
};

it("shows the PIN while processing, then opens ready products without a PIN form or reload", async () => {
  rememberCheckoutCredentialGrant(CODE, grant());
  let resolveCredentials!: (response: Response) => void;
  const fetcher = vi.fn((url: string) => url.endsWith("/pin") ? Promise.resolve(Response.json({ pin: PIN })) : new Promise<Response>(resolve => { resolveCredentials = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const view = render(<WrCredentialsPanel code={CODE} credentialsReady={false} />);
  await screen.findByText(PIN);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const notice = screen.getByRole("region", { name: "PIN pesanan" });
  expect(notice.className).toContain("ax-glass-card");
  expect(screen.getByText("Simpan untuk akses di perangkat lain.")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  view.rerender(<WrCredentialsPanel code={CODE} credentialsReady />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.queryByLabelText("Email atau No. WA checkout")).toBeNull();
  await act(async () => resolveCredentials(Response.json({ credentials, capability_token: TOKEN })));
  await screen.findByText(/fixture-password/);
  expect(screen.queryByLabelText("Email atau No. WA checkout")).toBeNull();
  await screen.findByText(PIN); hasNoPinPersistence();
});
it("reuses valid capability automatically and follows the order locale, not display locale", async () => {
  sessionStorage.setItem(`wr-cred-token:${CODE}`, TOKEN);
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.cache).toBe("no-store");
    return Response.json(url.endsWith("/pin") ? { pin: PIN } : { credentials });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<WrCredentialsPanel code={CODE} locale="en" />);
  await screen.findByText(PIN); await screen.findByText(/fixture-password/);
  expect(screen.getByRole("button", { name: "Copy PIN" })).toBeTruthy();
  expect(screen.queryByLabelText("Email or checkout WhatsApp number")).toBeNull();
  const credentialCall = fetcher.mock.calls.find(([url]) => url.endsWith("/credentials"))!;
  expect(credentialCall[1]?.headers).toEqual({ "x-credential-token": TOKEN });
  expect(credentialCall[1]?.method).toBeUndefined();
  hasNoPinPersistence();
});
it("contact or status session alone never discloses a PIN or consumes one, and still needs manual proof when ready", async () => {
  sessionStorage.setItem(`axvara-buyer-session:${CODE}`, `p1.${Math.floor(Date.now()/1000)+86400}.${"a".repeat(43)}`);
  const fetcher = vi.fn(async () => Response.json({ error: "verification_failed" }, { status: 404 })); vi.stubGlobal("fetch", fetcher);
  render(<WrCredentialsPanel code={CODE} prefillContact="buyer@example.test" />);
  await screen.findByLabelText("Email atau No. WA checkout");
  expect(screen.queryByText(PIN)).toBeNull();
  // Only the header-less device probes run: no contact, PIN or session header leaves the tab.
  for (const [, init] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/x-order-contact|x-buyer-access-session|x-checkout/);
    expect(String(init.body ?? "")).not.toContain("buyer@example.test");
  }
});
it("a rejected automatic credential proof falls back to contact + PIN without disclosing a PIN", async () => {
  sessionStorage.setItem(`wr-cred-token:${CODE}`, TOKEN);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "verification_failed" }, { status: 403 })));
  render(<WrCredentialsPanel code={CODE} />);
  await screen.findByLabelText("Email atau No. WA checkout");
  expect(screen.queryByText(PIN)).toBeNull();
});
it.each([TOKEN, null])("manual verification displays the verified PIN immediately, including when issuance returns %s", async capability_token => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => String(init?.body ?? "").includes('"device"')
    ? Response.json({ error: "device_unrecognized" }, { status: 404 }) : Response.json({ credentials, capability_token })); vi.stubGlobal("fetch", fetcher);
  render(<WrCredentialsPanel code={CODE} />);
  fireEvent.change(await screen.findByLabelText("Email atau No. WA checkout"), { target: { value: "buyer@example.test" } });
  fireEvent.change(screen.getByLabelText("PIN akses"), { target: { value: PIN } });
  fireEvent.click(screen.getByRole("button", { name: "Tampilkan" }));
  await screen.findByText(PIN); await screen.findByText(/fixture-password/);
  hasNoPinPersistence();
  const [, init] = fetcher.mock.calls.find(([, call]) => String(call?.body ?? "").includes("access_code")) as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body))).toEqual({ contact: "buyer@example.test", access_code: PIN });
});
it("PIN copy works, blocked clipboard leaves selectable text and a manual-copy message", async () => {
  rememberCheckoutCredentialGrant(CODE, grant());
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pin: PIN })));
  const copy = vi.fn().mockResolvedValue(undefined); vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  render(<WrCredentialsPanel code={CODE} credentialsReady={false} />);
  fireEvent.click(await screen.findByRole("button", { name: "Salin PIN" }));
  await screen.findByRole("button", { name: "Tersalin" }); expect(copy).toHaveBeenCalledWith(PIN);
  copy.mockRejectedValueOnce(new Error("blocked")); fireEvent.click(screen.getByRole("button", { name: "Tersalin" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/salin manual/);
  expect(screen.getByText(PIN).className).toContain("select-all");
});
it("a transient PIN failure can be retried without blocking product access", async () => {
  rememberCheckoutCredentialGrant(CODE, grant()); let fail = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/pin") ? Response.json(fail ? { error: "unavailable" } : { pin: PIN }, { status: fail ? 503 : 200 }) : Response.json({ credentials })));
  render(<WrCredentialsPanel code={CODE} />);
  await screen.findByText(/fixture-password/);
  await screen.findByRole("button", { name: "Coba lagi" });
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
  await screen.findByText(PIN);
});
it.each(["checkout", "capability"])("temporary product failure retains %s access and retries without demanding a PIN", async proof => {
  if (proof === "checkout") rememberCheckoutCredentialGrant(CODE, grant());
  else sessionStorage.setItem(`wr-cred-token:${CODE}`, TOKEN);
  let fail = true;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/pin") ? Response.json({ pin: PIN })
    : fail ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ credentials })));
  render(<WrCredentialsPanel code={CODE} />);
  const retry = await screen.findByRole("button", { name: "Coba lagi" });
  expect(screen.queryByLabelText("Email atau No. WA checkout")).toBeNull();
  fail = false; fireEvent.click(retry);
  await screen.findByText(/fixture-password/);
  expect(screen.queryByLabelText("Email atau No. WA checkout")).toBeNull();
});
it.each(["order", "tracking"])("mounts protected PIN disclosure on the paid %s page before credentials exist", async page => {
  rememberCheckoutCredentialGrant(CODE, grant());
  const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith("/pin") ? { pin: PIN } : { order: {
    code: CODE, status: "lunas", buyer_pin_required: true, credentials_ready: false, supplier_running: true, supplier_owned: true,
    items: [{ name: "Fixture", price: 1000, qty: 1 }], subtotal: 1000, payment_method: "qris", customer_name: "Fixture", customer_wa: "6281****0000",
  } }));
  vi.stubGlobal("fetch", fetcher);
  if (page === "order") {
    const Page = (await import("@/app/(shop)/pesanan/[code]/page")).default;
    render(<Page />);
  }
  else {
    const Page = (await import("@/app/(shop)/lacak-pesanan/lacak-pesanan-client")).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Kode pesanan *"), { target: { value: CODE } });
    const contact = screen.getByLabelText("No. WA atau email checkout *");
    fireEvent.change(contact, { target: { value: "buyer@example.test" } });
    fireEvent.submit(contact.closest("form")!);
  }
  await screen.findByText(PIN);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/credentials"))).toBe(false);
  hasNoPinPersistence();
});
