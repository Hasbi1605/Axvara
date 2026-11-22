// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SupplierAdminPanel } from "@/components/admin/SupplierAdminPanel";
import { ToastProvider } from "@/components/ui/Toast";
import { render } from "../setup/admin-render";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const panel = (supplier: "warung" | "sekalipay" | "tunvn") => render(<ToastProvider><SupplierAdminPanel supplier={supplier} /></ToastProvider>);
const tab = async (name: string) => { fireEvent.mouseDown(await screen.findByRole("tab", { name }), { button: 0 }); };
const variants = (n: number, supplier = "warung") => Array.from({ length: n }, (_, i) => {
  const id = String(i + 1).padStart(2, "0");
  return { [supplier === "warung" ? "wr_variant_id" : "sk_variant_id"]: `v${id}`, variant_id: i + 1, product_name: "Fixture", variant_label: `Varian ${id}`,
    stock: 10, wr_price: 2000, sk_price: 2000, markup_percent: 20, variant_status: "live" };
});
function api(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>> = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const uri = new URL(String(input), "https://fixture.test");
    const route = `${init?.method ?? "GET"} ${uri.pathname}`;
    if (handlers[route]) return handlers[route](init);
    for (const [suffix, value] of Object.entries({
      saldo: { balance: 12_000 }, "sync-log": { configured: true, sync_enabled: true, logs: [] }, exclusions: { exclusions: [] },
      markup: { variants: [] }, products: { items: [] }, balance: { balance: 1, currency: "USDT" }, orders: { items: [], orders: [] }, buff: { variants: [] },
    })) if (route.startsWith("GET ") && uri.pathname.endsWith(`/${suffix}`)) return Response.json({ ok: true, ...value });
    throw new Error(`Unstubbed fixture request: ${route}`);
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, writes: () => fetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => [url, init?.body ? JSON.parse(String(init.body)) : undefined]) };
}

describe.each(["warung", "sekalipay"] as const)("T6 %s sync copy", supplier => {
  it.each([
    [{ status: "success", synced: 2, variantsSynced: 3 }, "Sync selesai: 2 produk, 3 varian."],
    [{ status: "partial", synced: 2, variantsSynced: 3, errors: ["fixture upstream error"] }, "Sync sebagian: 2 produk, 3 varian. 1 error — fixture upstream error"],
    [{ status: "failed", errors: ["fixture upstream error"] }, "Sinkron: fixture upstream error"],
  ] as const)("renders contract for %j", async (body, copy) => {
    const route = `/api/admin/${supplier}/sync`;
    const { writes } = api({ [`POST ${route}`]: () => Response.json(body) });
    panel(supplier);
    await tab("Alat");
    fireEvent.click(screen.getByRole("button", { name: "Sinkronkan katalog" }));
    expect(await screen.findByText(copy)).toBeTruthy();
    expect(writes()).toEqual([[route, undefined]]);
  });
});

it("T6 bulk markup sends selected IDs once and exposes partial failure with example", async () => {
  const { writes } = api({
    "GET /api/admin/warung/markup": () => Response.json({ variants: variants(2) }),
    "POST /api/admin/warung/markup/bulk": () => Response.json({ updated: 1, failed: [{ id: "v02", error: "fixture failure" }] }),
  });
  panel("warung");
  await tab("Markup");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox", { name: "Pilih halaman ini" }));
  fireEvent.change(screen.getByLabelText("Markup persen bulk"), { target: { value: "42" } });
  await user.click(screen.getByRole("button", { name: "Terapkan ke 2 varian" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Terapkan markup" }));
  expect(await screen.findByText("Bulk: 1 berubah, 1 gagal (cth. v02: fixture failure).")).toBeTruthy();
  expect(writes()).toEqual([["/api/admin/warung/markup/bulk", { variant_ids: ["v01", "v02"], markup_percent: 42, markup_fixed: 0, update_fixed: false }]]);
});

it.each([false, true])("holds one write for competing submits and unlocks (reject=%s)", async reject => {
  const path = "/api/admin/warung/sync";
  let release!: (response: Response) => void;
  let fail!: (error: Error) => void;
  const held = new Promise<Response>((resolve, reject) => { release = resolve; fail = reject; });
  const sync = vi.fn().mockReturnValueOnce(held).mockImplementation(() => Response.json({ synced: 2 }));
  const { writes } = api({ [`POST ${path}`]: sync });
  panel("warung");
  await tab("Alat");
  const button = screen.getByRole("button", { name: "Sinkronkan katalog" });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(writes()).toEqual([[path, undefined]]);
  await tab("Ringkas");
  await tab("Alat");
  expect(screen.getByRole("button", { name: "Menyinkronkan…" })).toHaveProperty("disabled", true);
  expect(writes()).toHaveLength(1);
  if (reject) fail(new Error("fixture offline"));
  else release(Response.json({ synced: 1 }));
  expect(await screen.findByText(reject ? "Sinkron: fixture offline" : "Sync selesai: 1 produk, 0 varian.")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("button", { name: "Sinkronkan katalog" })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: "Sinkronkan katalog" }));
  expect(await screen.findByText("Sync selesai: 2 produk, 0 varian.")).toBeTruthy();
  expect(writes()).toEqual([[path, undefined], [path, undefined]]);
});

it("T6 SK sandbox rejects invalid input locally, then renders isolated success and API failure", async () => {
  const sandbox = vi.fn().mockImplementationOnce(() => Response.json({ ref_id: "fixture-ref", result: { status: "paid" } }))
    .mockImplementationOnce(() => Response.json({ error: "fixture refused" }, { status: 422 }));
  const { writes } = api({ "POST /api/admin/sekalipay/sandbox": sandbox });
  panel("sekalipay");
  await tab("Alat");
  const send = () => fireEvent.click(screen.getByRole("button", { name: "Kirim sandbox" }));
  send();
  expect(await screen.findByText("Sandbox: Isi product_id + variant_id SK (angka dari daftar varian).")).toBeTruthy();
  expect(writes()).toEqual([]);
  fireEvent.change(screen.getByLabelText("product_id sandbox"), { target: { value: "7" } });
  fireEvent.change(screen.getByLabelText("variant_id sandbox"), { target: { value: "9" } });
  send();
  expect(await screen.findByText('OK · ref fixture-ref · {"status":"paid"}')).toBeTruthy();
  expect(screen.getByText("Sandbox order berhasil (saldo tidak terpotong).")).toBeTruthy();
  send();
  expect(await screen.findByText("GAGAL · fixture refused")).toBeTruthy();
  expect(screen.getByText("Sandbox: fixture refused")).toBeTruthy();
  expect(writes()).toEqual(Array.from({ length: 2 }, () => ["/api/admin/sekalipay/sandbox", { product_id: 7, variant_id: 9, quantity: 1 }]));
});

it.each([["products", "Katalog"], ["balance", "Saldo"], ["orders", "Antrean"], ["buff", "Probe Buff"]])("T6 isolated %s loader failure labels only %s", async (slug, label) => {
  const { fetch } = api({ [`GET /api/admin/tunvn/${slug}`]: () => Response.json({ error: "fixture failure" }, { status: 503 }) });
  panel("tunvn");
  expect((await screen.findAllByRole("alert")).map(node => node.textContent)).toEqual([`${label}: HTTP 503: fixture failure`]);
  expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(["balance", "buff", "orders", "products"].map(path => `/api/admin/tunvn/${path}`));
});

it.each(["warung", "sekalipay"] as const)("T6 %s clamps page 3 to page 2 when the catalog shrinks after editing", async supplier => {
  let current = variants(41, supplier);
  const { writes } = api({
    [`GET /api/admin/${supplier}/markup`]: () => Response.json({ variants: current }),
    [`POST /api/admin/${supplier}/markup/bulk`]: () => { current = current.slice(0, 21); return Response.json({ updated: 1 }); },
  });
  panel(supplier);
  await tab("Markup");
  expect(await screen.findByText("Hal 1 dari 3 · 41 varian")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
  fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
  expect(screen.getByText("Hal 3 dari 3 · 41 varian")).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: "Pilih halaman ini" }));
  fireEvent.change(screen.getByLabelText("Markup persen bulk"), { target: { value: "42" } });
  await user.click(screen.getByRole("button", { name: "Terapkan ke 1 varian" }));
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Terapkan markup" }));
  expect(await screen.findByText("Hal 2 dari 2 · 21 varian")).toBeTruthy();
  expect(screen.getByRole("form", { name: "Harga Varian 21" })).toBeTruthy();
  expect(screen.queryByRole("form", { name: "Harga Varian 41" })).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: "Berikutnya" }) as HTMLButtonElement).disabled).toBe(true));
  expect(writes()).toEqual([[`/api/admin/${supplier}/markup/bulk`, { variant_ids: ["v41"], markup_percent: 42, markup_fixed: 0, update_fixed: false }]]);
});
