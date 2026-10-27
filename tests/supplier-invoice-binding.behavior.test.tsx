// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SupplierLinkActions, type SupplierLink } from "@/components/admin/SupplierLinkActions";
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/IosIcon", () => ({ IosIcon: () => null }));
vi.mock("@/components/ui/Loading", () => ({ Spinner: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const link: SupplierLink = { supplier: "wr", id: 36, status: "submitted", attempt_count: 1, max_attempts: 3, last_error: "ambiguous_timeout", supplier_order_id: null, delivery_status: "not_required" };
it("submits an explicit invoice through an accessible controlled form", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true, link: { status: "completed" } }));
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn(); render(<SupplierLinkActions links={[link]} onChanged={changed} />);
  const input = screen.getByLabelText("Invoice WR yang telah diverifikasi");
  const button = screen.getByRole("button", { name: "Hubungkan invoice WR" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input, { target: { value: "ORD-SELECTED" } });
  fireEvent.click(button);
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledWith("/api/admin/warung/orders/36/sync-now", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"wr_order_id":"ORD-SELECTED"}' });
});
it("known WR IDs retain Cek status without a binding field; SK never exposes WR binding", () => {
  const { rerender } = render(<SupplierLinkActions links={[{ ...link, supplier_order_id: "ORD-KNOWN" }]} onChanged={() => {}} />);
  expect(screen.getByRole("button", { name: "Cek status" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  rerender(<SupplierLinkActions links={[{ ...link, supplier: "sk" }]} onChanged={() => {}} />);
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("keeps the selected invoice editable after rejection and reports no successful change", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: "invoice_mismatch" }, { status: 409 }));
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn(); render(<SupplierLinkActions links={[link]} onChanged={changed} />);
  const input = screen.getByLabelText("Invoice WR yang telah diverifikasi") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "ORD-WRONG" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("invoice_mismatch"));
  expect(changed).not.toHaveBeenCalled();
  expect(input.value).toBe("ORD-WRONG");
  expect(input.disabled).toBe(false);
});
