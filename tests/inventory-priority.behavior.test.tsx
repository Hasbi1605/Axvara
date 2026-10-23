// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NonWrFulfillmentPanel } from "@/components/admin/sections/ProductVariantRows";
import { ToastProvider } from "@/components/ui/Toast";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(fail = false) {
  let inventory = [1, 2, 3].map(id => ({ id, secret: `CREDENTIAL-${id}` }));
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (fail) return { ok: false, json: async () => ({ error: "Stok berubah" }) };
      inventory = body.inventory_ids.map((id: number) => inventory.find(row => row.id === id)!);
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ available: 3, reserved: 0, delivered: 0, inventory }) };
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
    await screen.findByText("CREDENTIAL-3");
    fireEvent.dragStart(screen.getByLabelText("Geser kredensial 3"), { dataTransfer: { setData: vi.fn(), effectAllowed: "" } });
    const first = within(screen.getByRole("list")).getAllByRole("listitem")[0];
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    await waitFor(() => expect(screen.getByText("Urutan pengiriman disimpan.")).toBeTruthy());
    expect(order()).toEqual(["CREDENTIAL-3", "CREDENTIAL-1", "CREDENTIAL-2"]);
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST" && JSON.parse(String(init.body)).inventory_ids.join() === "3,1,2")).toBe(true);
  });

  it("restores the server queue and shows an error when a reservation races the reorder", async () => {
    setup(true);
    await screen.findByText("CREDENTIAL-3");
    fireEvent.click(screen.getByLabelText("Naikkan kredensial 3"));
    await screen.findByText("Stok berubah");
    await waitFor(() => expect(order()).toEqual(["CREDENTIAL-1", "CREDENTIAL-2", "CREDENTIAL-3"]));
  });
});
