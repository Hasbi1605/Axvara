// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./setup/admin-render";
import { AivaultManager } from "@/components/admin/AivaultManager";
import { formatRupiah } from "@/lib/utils";

afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const tiers=[{min_qty:5,markup_percent:58},{min_qty:10,markup_percent:47},{min_qty:50,markup_percent:36}];
async function setup(options:{off?:boolean;manual?:number;error?:string;archived?:number;unmapped?:boolean}={}) {
  vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}});
  const patches:unknown[]=[];
  const item={service_id:"gemini",name:"Gemini",label:"Gemini Plus 6 Bulan",stock:100,unit_price_usd:0.5,fx_idr_per_usd:18272.9,markup_percent:80,variant_price:16500,aivault_admin_price_idr:options.manual ?? null,variant_id:options.unmapped?null:1,variant_active:1,product_active:1,product_archived:options.archived ?? 0,family:{key:"gemini",name:"Gemini"},bulk_markup_tiers:options.off?null:tiers,bulk_tiers_preview:options.off?[]:[{min_qty:5,unit_price:14500},{min_qty:10,unit_price:13500},{min_qty:50,unit_price:12500}]};
  vi.stubGlobal("fetch",vi.fn(async(input:unknown,init?:RequestInit)=>{
    let body:unknown={};
    if(init?.method==="PATCH") {patches.push({url:String(input),body:JSON.parse(String(init.body))});body=options.error?{error:options.error}:{ok:true};}
    else if(String(input).endsWith("/products")) body={items:[item],configured:true,last_sync_at:null};
    else if(String(input).endsWith("/orders")) body={items:[]};
    else body={balance:2};
    return {ok:!(init?.method==="PATCH" && options.error),status:options.error && init?.method==="PATCH"?400:200,json:async()=>body};
  }));
  render(<AivaultManager/>);
  await screen.findByText("Saldo");
  await userEvent.click(screen.getByRole("tab",{name:"Markup"}));
  await screen.findByText("Gemini Plus 6 Bulan");
  return {patches};
}
async function open(){await userEvent.click(screen.getByRole("button",{name:"Grosir"}));return within(screen.getByRole("dialog"));}
describe("grosir markup AIVault",()=>{
  it("shows derived prices for a changed formula markup and saves without tier input", async () => {
    const { patches } = await setup();
    const row = within(screen.getByRole("form", { name: "Harga Gemini Plus 6 Bulan" }));
    const markup = row.getByRole("spinbutton", { name: "Markup %" });
    expect(row.queryByText(/^Grosir ikut disesuaikan:/)).toBeNull();
    fireEvent.change(markup, { target: { value: "0" } });
    expect(row.getByText("Grosir ikut disesuaikan: tidak ada tier aktif pada markup ini.")).toBeTruthy();
    fireEvent.change(markup, { target: { value: "35" } });
    const summary = [11500, 11100, 10600].map((price, i) => `${tiers[i].min_qty}+ ${formatRupiah(price)}`).join(" · ");
    const preview = row.getByText(/^Grosir ikut disesuaikan:/);
    expect(preview.textContent).toBe(`Grosir ikut disesuaikan: ${summary}`);
    expect(preview.classList.contains("text-admin-muted")).toBe(true);
    const manual = row.getByRole("spinbutton", { name: "Harga manual (Rp)" });
    fireEvent.change(manual, { target: { value: "15000" } });
    expect(row.queryByText(/^Grosir ikut disesuaikan:/)).toBeNull();
    fireEvent.change(manual, { target: { value: "" } });
    await userEvent.click(row.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(patches).toEqual([{ url: "/api/admin/aivault/products/gemini", body: { markup_percent: 35 } }]));
  });

  it.each([{ manual: 20000 }, { off: true }])("does not preview scaling for %j", async (options) => {
    await setup(options);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Markup %" }), { target: { value: "35" } });
    expect(screen.queryByText(/^Grosir ikut disesuaikan:/)).toBeNull();
  });

  it("shows Gemini preview and summary, then PATCHes markup tiers",async()=>{
    const {patches}=await setup();
    expect(screen.getByText(/Grosir: 5\+/).textContent).toContain(formatRupiah(14500));
    const dialog=await open();
    expect(dialog.getByText(/Harga dasar/).textContent).toContain(formatRupiah(16500));
    for(const [price,saving] of [[14500,12],[13500,18],[12500,24]])expect(dialog.getByText((_,el)=>el?.tagName==="P" && el.textContent===`${formatRupiah(price)} · hemat ${saving}%`)).toBeTruthy();
    await userEvent.click(dialog.getByRole("button",{name:"Simpan harga grosir"}));
    await waitFor(()=>expect(patches).toEqual([{url:"/api/admin/aivault/products/gemini",body:{bulk_markup_tiers:tiers}}]));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("blocks non-increasing qty, markup at base and non-decreasing markup",async()=>{
    const {patches}=await setup();const dialog=await open();
    const save=dialog.getByRole("button",{name:"Simpan harga grosir"}) as HTMLButtonElement;
    fireEvent.change(dialog.getByLabelText("Min. qty tier 2"),{target:{value:"5"}});
    expect(dialog.getByRole("alert").textContent).toContain("meningkat");expect(save.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText("Min. qty tier 2"),{target:{value:"10"}});
    fireEvent.change(dialog.getByLabelText("Markup % tier 1"),{target:{value:"80"}});
    expect(dialog.getByRole("alert").textContent).toBe("Markup tier harus lebih kecil dari markup dasar.");expect(save.disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText("Markup % tier 1"),{target:{value:"47"}});
    expect(dialog.getByRole("alert").textContent).toContain("menurun");expect(save.disabled).toBe(true);expect(patches).toEqual([]);
  });
  it("toggle off sends null",async()=>{
    const {patches}=await setup();const dialog=await open();
    await userEvent.click(dialog.getByLabelText("Aktifkan harga grosir"));
    expect(dialog.queryByLabelText("Min. qty tier 1")).toBeNull();
    await userEvent.click(dialog.getByRole("button",{name:"Simpan harga grosir"}));
    await waitFor(()=>expect(patches).toEqual([{url:"/api/admin/aivault/products/gemini",body:{bulk_markup_tiers:null}}]));
  });
  it("starts empty when enabling and limits to five labelled rows",async()=>{
    await setup({off:true});const dialog=await open();
    await userEvent.click(dialog.getByLabelText("Aktifkan harga grosir"));
    expect((dialog.getByLabelText("Min. qty tier 1") as HTMLInputElement).value).toBe("");
    for(let i=0;i<4;i++)await userEvent.click(dialog.getByRole("button",{name:"Tambah tier"}));
    expect((dialog.getByRole("button",{name:"Tambah tier"}) as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getAllByLabelText(/^Min. qty tier/)).toHaveLength(5);
    await userEvent.click(dialog.getByRole("button",{name:"Hapus tier 5"}));
    expect(dialog.getAllByLabelText(/^Min. qty tier/)).toHaveLength(4);
  });
  it("preserves dialog after server rejection with Indonesian error",async()=>{
    await setup({error:"bulk_markup_not_below_base"});const dialog=await open();
    await userEvent.click(dialog.getByRole("button",{name:"Simpan harga grosir"}));
    await waitFor(()=>expect(dialog.getByRole("alert").textContent).toBe("Markup tier harus lebih kecil dari markup dasar."));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it.each([{archived:1},{unmapped:true}])("hides action for unavailable row %j",async(options)=>{
    await setup(options);expect(screen.queryByRole("button",{name:"Grosir"})).toBeNull();
  });
  it("allows tier markup above base markup when a manual base price exists",async()=>{
    await setup({manual:20000});const dialog=await open();
    fireEvent.change(dialog.getByLabelText("Markup % tier 1"),{target:{value:"90"}});
    expect(dialog.queryByRole("alert")).toBeNull();
    expect((dialog.getByRole("button",{name:"Simpan harga grosir"}) as HTMLButtonElement).disabled).toBe(false);
  });
});
