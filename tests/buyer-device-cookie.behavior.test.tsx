// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/lacak-pesanan" }));
vi.mock("@/components/storefront/StoreWhatsAppLink", () => ({ StoreWhatsAppLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/storefront/DeviceOrders", () => ({ DeviceOrders: () => null }));
import { WrCredentialsPanel } from "@/components/storefront/WrCredentialsPanel";
import Page from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
import { forgetCheckoutCredentialGrant } from "@/lib/order-access-client";

const CODE = "AXV-20261118-DEVBEH01", TOKEN = "d".repeat(64), PIN = "A3B7K2";
const credentials = [{ details: "Email: device@example.test\nPassword: device-password", completed_at: null }];
beforeEach(() => { sessionStorage.clear(); localStorage.clear(); forgetCheckoutCredentialGrant(CODE); vi.stubGlobal("requestAnimationFrame", () => 1); });
afterEach(() => { cleanup(); forgetCheckoutCredentialGrant(CODE); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const isDevice = (init?: RequestInit) => String(init?.body ?? "") === JSON.stringify({ device: true });

it("a new tab without tab proof auto-opens through the device cookie and stores only the capability", async () => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => url.endsWith("/pin") ? Response.json({ pin: PIN })
    : isDevice(init) ? Response.json({ credentials, capability_token: TOKEN }) : Response.json({ error: "unexpected" }, { status: 500 }));
  vi.stubGlobal("fetch", fetcher);
  render(<WrCredentialsPanel code={CODE} />);
  await screen.findByText(/device-password/);
  expect(screen.queryByLabelText("Email atau No. WA checkout")).toBeNull();
  const call = fetcher.mock.calls.find(([url]) => url.endsWith("/credentials"))!;
  expect(call[1]?.method).toBe("POST");
  expect(JSON.stringify(call[1]?.headers)).not.toMatch(/x-order-contact|x-checkout|x-credential/);
  expect(sessionStorage.getItem(`wr-cred-token:${CODE}`)).toBe(TOKEN);
  await screen.findByText(PIN);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/credentials"))).toHaveLength(1);
});

it.each([404, 403, 409, 400])("an unrecognized device (%s) shows the contact + PIN form without an error", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "device_unrecognized" }, { status })));
  render(<WrCredentialsPanel code={CODE} />);
  await screen.findByLabelText("Email atau No. WA checkout");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/device-password/)).toBeNull();
});

it("a temporary device failure offers retry and the retry attempts the device path again", async () => {
  let fail = true;
  const fetcher = vi.fn(async (url: string) => url.endsWith("/pin") ? Response.json({ error: "x" }, { status: 404 })
    : fail ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ credentials, capability_token: TOKEN }));
  vi.stubGlobal("fetch", fetcher);
  render(<WrCredentialsPanel code={CODE} />);
  const retry = await screen.findByRole("button", { name: "Coba lagi" });
  expect(screen.queryByLabelText("Email atau No. WA checkout")).toBeNull();
  fail = false; fireEvent.click(retry);
  await screen.findByText(/device-password/);
});

it("legacy orders without a PIN never probe the device cookie", async () => {
  const fetcher = vi.fn(async () => Response.json({}, { status: 404 })); vi.stubGlobal("fetch", fetcher);
  render(<WrCredentialsPanel code={CODE} buyerPinRequired={false} />);
  await screen.findByLabelText("Email atau No. WA checkout");
  expect(fetcher).not.toHaveBeenCalled();
});

it("the PIN fields block password-manager autofill and an invalid PIN shows a clear inline error", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "device_unrecognized" }, { status: 404 })));
  render(<WrCredentialsPanel code={CODE} />);
  const field = await screen.findByLabelText("PIN akses") as HTMLInputElement;
  for (const attr of ["type", "autocomplete", "name"]) expect(field.getAttribute(attr)).toBe({ type: "text", autocomplete: "one-time-code", name: "order-pin" }[attr]);
  expect(field.hasAttribute("data-1p-ignore")).toBe(true); expect(field.getAttribute("data-lpignore")).toBe("true");
  expect(field.maxLength).toBe(26);
  fireEvent.change(screen.getByLabelText("Email atau No. WA checkout"), { target: { value: "buyer@example.test" } });
  fireEvent.change(field, { target: { value: "abcdefghijklmnopqrstuvwx" } });
  const submit = screen.getByRole("button", { name: "Tampilkan" }) as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  fireEvent.click(submit);
  expect((await screen.findByRole("alert")).textContent).toBe("PIN berisi 6 huruf/angka dari email pesanan.");
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([, init]) => String(init?.body ?? "").includes("access_code"))).toHaveLength(0));
});

it("the tracking PIN field blocks password-manager autofill", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(<Page />);
  const field = document.getElementById("track-pin") as HTMLInputElement;
  expect(field.type).toBe("text"); expect(field.getAttribute("autocomplete")).toBe("one-time-code");
  expect(field.getAttribute("name")).toBe("order-pin"); expect(field.hasAttribute("data-1p-ignore")).toBe(true);
  expect(field.maxLength).toBe(26);
});

it("device helpers POST the checkout grant, DELETE without proof, and swallow network errors", async () => {
  const { rememberDeviceForOrder, forgetDeviceForOrder } = await import("@/lib/order-access-client");
  const fetcher = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal("fetch", fetcher);
  await rememberDeviceForOrder(CODE, "c1.grant"); await forgetDeviceForOrder(CODE);
  expect(fetcher.mock.calls[0]).toEqual([`/api/orders/${CODE}/device`, { method: "POST", headers: { "x-checkout-credential-grant": "c1.grant" }, cache: "no-store", keepalive: true }]);
  expect(fetcher.mock.calls[1]).toEqual([`/api/orders/${CODE}/device`, { method: "DELETE", cache: "no-store", keepalive: true }]);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
  await expect(rememberDeviceForOrder(CODE, "c1.grant")).resolves.toBeUndefined();
  await expect(forgetDeviceForOrder(CODE)).resolves.toBeUndefined();
});
