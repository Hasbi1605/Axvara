// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./setup/admin-render";
import userEvent from "@testing-library/user-event";
import { SupplierLinkActions, type SupplierLink } from "@/components/admin/SupplierLinkActions";
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/IosIcon", async original => ({ ...await original<object>(),IosIcon: () => null }));
vi.mock("@/components/ui/Loading", () => ({ Spinner: () => null }));
vi.mock("@/components/admin/OrderAccessAdmin",()=>({OrderAccessAdmin:()=>null}));
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

const tunvn:SupplierLink={supplier:"tunvn",id:1,item_index:0,status:"needs_admin",attempt_count:0,max_attempts:3,last_error:"insufficient_balance",supplier_order_id:null,delivery_status:null,can_retry:true};
it("explains that legacy cost failures can retry at the current supplier price",()=>{
  render(<SupplierLinkActions links={[{...tunvn,last_error:"cost_changed"}]} onChanged={()=>{}}/>);
  expect(screen.getByText(/harga supplier terkini tanpa batas modal snapshot/)).toBeTruthy();
  expect(screen.getByRole("button",{name:"Retry"})).toBeTruthy();
});
it.each(["wr","sk","tunvn"] as const)("keeps %s actions at the same accessible target height",supplier=>{
  render(<SupplierLinkActions links={[{...tunvn,supplier,status:"blocked_balance"}]} onChanged={()=>{}}/>);
  expect(screen.getByRole("button",{name:/Retry/}).className).toContain("h-12");
});
it("explains SK live preflight and TUNVN read-only status recovery without exposing raw error codes",()=>{
  render(<SupplierLinkActions links={[{...tunvn,supplier:"sk",status:"blocked_balance",last_error:"preflight_insufficient_balance"},{...tunvn,id:2,status:"processing",last_error:"buff_status_unavailable",can_retry:false}]} onChanged={()=>{}}/>);
  expect(screen.getByText(/cukup untuk harga aktual/)).toBeTruthy();
  expect(screen.getByText(/memeriksa ulang otomatis tanpa membeli lagi/)).toBeTruthy();
  expect(screen.queryByText("preflight_insufficient_balance")).toBeNull();
});
it("shows TUNVN balance warning and retries via the protected action, not WR/SK routes",async()=>{
  const fetcher=vi.fn(async()=>Response.json({ok:true,link:{status:"needs_admin",last_error:"insufficient_balance"}}));vi.stubGlobal("fetch",fetcher);
  const changed=vi.fn();render(<SupplierLinkActions links={[tunvn]} onChanged={changed}/>);
  expect(screen.getByText(/Top up saldo TUNVN/)).toBeTruthy();expect(screen.queryByRole("button",{name:"Batal"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledWith("/api/admin/tunvn/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"id":1,"action":"retry"}'});
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Top up"));expect(toast.success).not.toHaveBeenCalled();
});
it("does not offer blind retry for ambiguous TUNVN but can check a known batch",async()=>{
  const changed=vi.fn();const fetcher=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal("fetch",fetcher);
  const {rerender}=render(<SupplierLinkActions links={[{...tunvn,can_retry:false,last_error:"dispatch_unconfirmed"}]} onChanged={changed}/>);
  expect(screen.queryByRole("button",{name:"Retry"})).toBeNull();expect(screen.queryByRole("button",{name:"Cek status"})).toBeNull();
  rerender(<SupplierLinkActions links={[{...tunvn,can_retry:false,can_reconcile:true,supplier_order_id:"BATCH",status:"processing"}]} onChanged={changed}/>);
  fireEvent.click(screen.getByRole("button",{name:"Cek status"}));await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledWith("/api/admin/tunvn/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:'{"id":1,"action":"reconcile"}'});
});
it("keeps retry available after a rejection without reporting success",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"no_safe_retry"},{status:409})));
  const changed=vi.fn();render(<SupplierLinkActions links={[tunvn]} onChanged={changed}/>);
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));await waitFor(()=>expect(toast.error).toHaveBeenCalledWith("no_safe_retry"));
  expect(changed).not.toHaveBeenCalled();expect((screen.getByRole("button",{name:"Retry"}) as HTMLButtonElement).disabled).toBe(false);
});
it("never offers retry or top-up instructions for an order explicitly handled manually",()=>{
  render(<SupplierLinkActions links={[{...tunvn,purchase_disabled:true}]} onChanged={()=>{}}/>);
  expect(screen.getByText(/Pembelian otomatis dinonaktifkan/)).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Retry"})).toBeNull();
  expect(screen.queryByText(/Top up/)).toBeNull();
});
it("replaces handover in both the TUNVN order row and its detail, retaining manual orders",async()=>{
  const {OrdersManager}=await import("@/components/admin/OrdersManager");
  const order={code:"AXV-20261110-FIXTURE1",status:"lunas",payment_status:"paid",fulfillment_status:"manual_required",sales_channel:"web",payment_method:"qris",customer_name:"Fixture",subtotal:1500,items:[{name:"Buff",price:1500,qty:1}],supplier_links:[tunvn]};
  const fetcher=vi.fn(async(url:string)=>Response.json(url.includes("/api/admin/orders?")?{orders:[order]}:{buyerInputs:[]}));vi.stubGlobal("fetch",fetcher);
  const {unmount}=render(<OrdersManager/>);await screen.findByRole("button",{name:"Retry"});
  expect(screen.queryByText("Perlu tindakan")).toBeNull();expect(screen.queryByRole("button",{name:"Kirim ke pembeli"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Detail"}));await screen.findByRole("heading",{name:"Detail pesanan"});
  expect(screen.queryByRole("button",{name:"Kirim ke pembeli"})).toBeNull();unmount();
  order.supplier_links=[{...tunvn,purchase_disabled:true}];
  const manual=render(<OrdersManager/>);await userEvent.click(await screen.findByRole("button",{name:/Tindakan lain/}));expect(screen.getByRole("menuitem",{name:"Kirim ke pembeli"})).toBeTruthy();await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("button",{name:"Retry"})).toBeNull();manual.unmount();
  order.supplier_links=[];render(<OrdersManager/>);await userEvent.click(await screen.findByRole("button",{name:/Tindakan lain/}));expect(screen.getByRole("menuitem",{name:"Kirim ke pembeli"})).toBeTruthy();
});
it("offers manual handover for a TUNVN dead end (needs_admin, no Retry) but not while TUNVN still processes",async()=>{
  const {OrdersManager}=await import("@/components/admin/OrdersManager");
  const deadEnd:SupplierLink={...tunvn,id:39,status:"needs_admin",attempt_count:1,last_error:"unconfirmed_buff_receipt",can_retry:false,can_reconcile:false};
  const order={code:"AXV-20261119-FIXTURE2",status:"lunas",payment_status:"paid",fulfillment_status:"manual_required",sales_channel:"web",payment_method:"qris",customer_name:"Fixture",subtotal:5830,items:[{name:"Buff",price:583,qty:10}],supplier_links:[deadEnd]};
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>Response.json(url.includes("/api/admin/orders?")?{orders:[order]}:{buyerInputs:[]})));
  const first=render(<OrdersManager/>);
  expect(await screen.findByText(/Jangan beli ulang; cek History bot TUNVN/)).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Retry"})).toBeNull();
  await userEvent.click(await screen.findByRole("button",{name:/Tindakan lain/}));expect(screen.getByRole("menuitem",{name:"Kirim ke pembeli"})).toBeTruthy();first.unmount();
  for (const status of ["pending","claimed","processing"]) {
    order.supplier_links=[{...deadEnd,status,last_error:null}];
    const view=render(<OrdersManager/>);await screen.findByRole("button",{name:"Detail"});
    expect(screen.queryByRole("button",{name:/Tindakan lain/})).toBeNull();view.unmount();
  }
});
