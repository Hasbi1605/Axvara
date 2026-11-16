// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NonWrFulfillmentPanel } from "@/components/admin/sections/ProductVariantRows";
import { ToastProvider } from "@/components/ui/Toast";
import { AdminPortalContext } from "@/components/admin/ui/portal";
afterEach(async () => {
  cleanup();
  // PointerSensor briefly suppresses the synthetic click after a drag ends.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

function dragGeometry() {
  class TestPointerEvent extends MouseEvent {
    isPrimary = true;
    pointerId = 1;
    pointerType = "mouse";
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const row = this.closest<HTMLElement>("[data-inventory-id]");
    const id = Number(row?.dataset.inventoryId || 0);
    const top = id ? 100 + (id - 1) * 40 - Number(row?.closest("ul")?.scrollTop || 0) : 100;
    const height = id ? 34 : 120;
    return { x: 20, y: top, top, bottom: top + height, left: 20, right: 620, width: 600, height, toJSON() {} };
  });
}

async function liftLast() {
  dragGeometry();
  const handle = await screen.findByLabelText("Geser kredensial 3");
  fireEvent.pointerDown(handle, { button: 0, clientX: 35, clientY: 195, isPrimary: true });
  fireEvent.pointerMove(document, { clientX: 35, clientY: 185 });
  await waitFor(() => expect(document.querySelector("[data-credential-drag-overlay]")).toBeTruthy());
  fireEvent.pointerMove(document, { clientX: 35, clientY: 110 });
  await waitFor(() => expect(screen.getAllByText(/Lepas di urutan 1/).length).toBeGreaterThan(0));
}

function setup(fail = false, count = 3) {
  let inventory = Array.from({ length: count }, (_, index) => ({ id: index + 1, secret: `CREDENTIAL-${index + 1}` }));
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (fail) return { ok: false, json: async () => ({ error: "Stok berubah" }) };
      inventory = body.inventory_ids.map((id: number) => inventory.find(row => row.id === id)!);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ available: count, reserved: 0, delivered: 0, inventory }) };
  });
  vi.stubGlobal("fetch", fetch);
  render(<ToastProvider><NonWrFulfillmentPanel productId={1} variantId={1} mode="unique" /></ToastProvider>);
  return fetch;
}
const order = () => within(screen.getByRole("list", { name: "Urutan pengiriman kredensial" })).getAllByRole("listitem").map(row => row.querySelector(".font-mono")?.textContent);

describe("credential priority controls", () => {
  it("moves credentials with arrows, saves immediately and reflects the server order", async () => {
    const fetch = setup();
    await screen.findByText("CREDENTIAL-3");
    expect((screen.getByLabelText("Naikkan kredensial 1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Naikkan kredensial 3"));
    await waitFor(() => expect(order()).toEqual(["CREDENTIAL-1", "CREDENTIAL-3", "CREDENTIAL-2"]));
    await waitFor(() => expect(screen.getByText("Urutan pengiriman disimpan.")).toBeTruthy());
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST" && JSON.parse(String(init.body)).inventory_ids.join() === "1,3,2")).toBe(true);
    fireEvent.click(screen.getByLabelText("Turunkan kredensial 1"));
    await waitFor(() => expect(order()[0]).toBe("CREDENTIAL-3"));
  });

  it("drags the very last credential directly to the first position", async () => {
    const fetch = setup();
    await liftLast();
    expect(document.querySelector("[data-drop-indicator]")).toBeTruthy();
    const first = within(screen.getByRole("list")).getAllByRole("listitem")[0];
    expect(first.style.transform).toContain("translate");
    await waitFor(() => expect(first.style.transition).toContain("220ms"));
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    fireEvent.pointerUp(document);
    await waitFor(() => expect(screen.getByText("Urutan pengiriman disimpan.")).toBeTruthy());
    expect(order()).toEqual(["CREDENTIAL-3", "CREDENTIAL-1", "CREDENTIAL-2"]);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST" && JSON.parse(String(init.body)).inventory_ids.join() === "3,1,2")).toBe(true);
  });

  it("Escape cancels the preview without saving or changing the queue", async () => {
    const fetch = setup();
    await liftLast();
    fireEvent.keyDown(document, { code: "Escape", key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-drop-indicator]")).toBeNull());
    expect(order()).toEqual(["CREDENTIAL-1", "CREDENTIAL-2", "CREDENTIAL-3"]);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each(["top", "bottom"])("holding near the %s edge scrolls the queue and stops on cancellation", async edge => {
    const fetch = setup(false, 12);
    await screen.findByText("CREDENTIAL-12");
    dragGeometry();
    const list = screen.getByRole("list");
    list.style.overflowY = "auto";
    for (const [key, value] of Object.entries({ clientHeight: 120, scrollHeight: 500, clientWidth: 600, scrollWidth: 600 })) {
      Object.defineProperty(list, key, { configurable: true, value });
    }
    list.scrollTop = 200;
    list.scrollBy = vi.fn((_x: unknown, y?: number) => {
      list.scrollTop = Math.max(0, Math.min(380, list.scrollTop + Number(y || 0)));
      fireEvent.scroll(list);
    }) as typeof list.scrollBy;
    fireEvent.pointerDown(screen.getByLabelText("Geser kredensial 7"), { button: 0, clientX: 35, clientY: 157 });
    fireEvent.pointerMove(document, { clientX: 35, clientY: edge === "top" ? 145 : 169 });
    await waitFor(() => expect(document.querySelector("[data-credential-drag-overlay]")).toBeTruthy());
    fireEvent.pointerMove(document, { clientX: 35, clientY: edge === "top" ? 104 : 216 });
    await waitFor(() => edge === "top" ? expect(list.scrollTop).toBeLessThan(200) : expect(list.scrollTop).toBeGreaterThan(200));
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    const stoppedAt = list.scrollTop;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(list.scrollTop).toBe(stoppedAt);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("honors reduced motion while preserving the destination indicator", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    setup(); await liftLast();
    const first = within(screen.getByRole("list")).getAllByRole("listitem")[0];
    await waitFor(() => expect(first.style.transition).toContain("0ms"));
    expect(document.querySelector("[data-drop-indicator]")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  });

  it("restores the server queue and shows an error when a reservation races the reorder", async () => {
    setup(true);
    await screen.findByText("CREDENTIAL-3");
    fireEvent.click(screen.getByLabelText("Naikkan kredensial 3"));
    await screen.findByText("Stok berubah");
    await waitFor(() => expect(order()).toEqual(["CREDENTIAL-1", "CREDENTIAL-2", "CREDENTIAL-3"]));
  });

  it("select all, partial selection and bulk delete with confirmation", async () => {
    let inventory = [1, 2, 3].map(id => ({ id, secret: `CREDENTIAL-${id}` }));
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        const body = JSON.parse(String(init.body));
        inventory = inventory.filter(row => !body.inventory_ids.includes(row.id));
        return { ok: true, json: async () => ({ ok: true, revoked: body.inventory_ids.length, skipped: 0 }) };
      }
      return { ok: true, json: async () => ({ available: inventory.length, reserved: 0, delivered: 0, inventory }) };
    });
    vi.stubGlobal("fetch", fetch);
    render(<AdminPortalContext.Provider value={document.body}><ToastProvider><NonWrFulfillmentPanel productId={1} variantId={1} mode="unique" /></ToastProvider></AdminPortalContext.Provider>);
    await screen.findByText("CREDENTIAL-3");
    const bulkDelete = () => screen.getByRole("button", { name: /Hapus terpilih/ }) as HTMLButtonElement;
    expect(bulkDelete().disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Pilih semua kredensial"));
    expect(screen.getByText("3 dari 3 dipilih")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Pilih kredensial 2"));
    expect(screen.getByText("2 dari 3 dipilih")).toBeTruthy();
    expect(screen.getByLabelText("Pilih semua kredensial").getAttribute("data-state")).toBe("indeterminate");
    expect(screen.getByLabelText("Pilih semua kredensial").querySelector(".lucide-minus")).toBeTruthy();

    fireEvent.click(bulkDelete());
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Hapus 2 kredensial?")).toBeTruthy();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Hapus 2" }));
    await screen.findByText("2 stok dihapus.");
    const call = fetch.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ product_id: 1, variant_id: 1, inventory_ids: [1, 3] });
    await waitFor(() => expect(order()).toEqual(["CREDENTIAL-2"]));
    expect(screen.getByText("Pilih semua")).toBeTruthy();
  });

  it("reports credentials skipped because checkout reserved them", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => init?.method === "DELETE"
      ? { ok: true, json: async () => ({ ok: true, revoked: 1, skipped: 1 }) }
      : { ok: true, json: async () => ({ available: 2, reserved: 0, delivered: 0, inventory: [1, 2].map(id => ({ id, secret: `CREDENTIAL-${id}` })) }) });
    vi.stubGlobal("fetch", fetch);
    render(<AdminPortalContext.Provider value={document.body}><ToastProvider><NonWrFulfillmentPanel productId={1} variantId={1} mode="unique" /></ToastProvider></AdminPortalContext.Provider>);
    await screen.findByText("CREDENTIAL-2");
    fireEvent.click(screen.getByLabelText("Pilih semua kredensial"));
    fireEvent.click(screen.getByRole("button", { name: /Hapus terpilih/ }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Hapus 2" }));
    await screen.findByText("1 stok dihapus; 1 dilewati karena sudah dipesan/terkirim.");
  });

  it("copies a single credential and the selected credentials in queue order", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    setup();
    await screen.findByText("CREDENTIAL-3");
    fireEvent.click(screen.getByLabelText("Salin kredensial 2"));
    await screen.findByText("Kredensial disalin.");
    expect(writeText).toHaveBeenLastCalledWith("CREDENTIAL-2");
    expect((screen.getByRole("button", { name: /Salin terpilih/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Pilih kredensial 3"));
    fireEvent.click(screen.getByLabelText("Pilih kredensial 1"));
    fireEvent.click(screen.getByRole("button", { name: /Salin terpilih/ }));
    await screen.findByText("2 kredensial disalin.");
    expect(writeText).toHaveBeenLastCalledWith("CREDENTIAL-1\nCREDENTIAL-3");
  });

  it("shows an error when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    setup();
    await screen.findByText("CREDENTIAL-1");
    fireEvent.click(screen.getByLabelText("Salin kredensial 1"));
    await screen.findByText("Gagal menyalin — izinkan akses clipboard di browser.");
  });
});
