// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {PediaCurationPanel} from "@/components/admin/PediaCurationPanel";
const product={id:1,name:"Followers Instagram",platform:"instagram",metric:"followers",target_kind:"profile"};
const row={supplier:"indosmm",service_id:99,name:"Instagram Followers Global",rate_idr_per_1k:1000,min_qty:10,max_qty:1000,estimated_cost:100,region:"Global",warnings:["Belum diuji hasil kirimnya"],suggested_name:"Followers Global · Tanpa refill",suggested_description:"Deskripsi aman <script>literal</script>",suggested_terms:"Tanpa refill dari AXVARA",suggested_instructions:"Gunakan link profil"};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("does not fetch or write before a need is selected, then compares the chosen amount",async()=>{
 const fetch=vi.fn(async(_url:string,_init?:RequestInit)=>Response.json({ok:true,rows:[row]}));vi.stubGlobal("fetch",fetch);
 render(<PediaCurationPanel products={[product]} onCreated={vi.fn()}/>);
 expect(fetch).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Kebutuhan produk"),{target:{value:"1"}});
 await screen.findByText(row.name);expect(String(fetch.mock.calls[0][0])).toContain("quantity=100");
 fireEvent.change(screen.getByLabelText("Jumlah pembanding"),{target:{value:"500"}});
 await waitFor(()=>expect(fetch.mock.calls.some(call=>String(call[0]).includes("quantity=500"))).toBe(true));
 expect(fetch.mock.calls.every(call=>!call[1]?.method)).toBe(true);
});
it("creates an inactive no-refill draft with reviewed edited copy, never publishes it",async()=>{
 let write:Record<string,unknown>|undefined;
 vi.stubGlobal("fetch",vi.fn(async(_url:string,init?:RequestInit)=>{if(init?.method){write=JSON.parse(String(init.body));return Response.json({ok:true,id:8});}return Response.json({ok:true,rows:[row]});}));
 const onCreated=vi.fn(async()=>{});render(<PediaCurationPanel products={[product]} onCreated={onCreated}/>);
 fireEvent.change(screen.getByLabelText("Kebutuhan produk"),{target:{value:"1"}});
 fireEvent.click(await screen.findByRole("button",{name:"Siapkan draf indosmm #99"}));
 expect(document.querySelector("form script")).toBeNull();
 fireEvent.change(screen.getByLabelText("Nama publik"),{target:{value:"Draf ditinjau"}});
 fireEvent.click(screen.getByRole("checkbox"));fireEvent.submit(screen.getByRole("form",{name:"Draf kandidat"}));
 await waitFor(()=>expect(onCreated).toHaveBeenCalledWith(1));
 expect(write).toMatchObject({kind:"tier",supplier:"indosmm",supplier_service_id:99,public_name:"Draf ditinjau",is_active:0,refill_days:0,is_recommended:0});
});
it("clears stale candidate and draft selection when the quantity changes",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,rows:[row]})));
 render(<PediaCurationPanel products={[product]} onCreated={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText("Kebutuhan produk"),{target:{value:"1"}});
 fireEvent.click(await screen.findByRole("button",{name:"Siapkan draf indosmm #99"}));
 fireEvent.change(screen.getByLabelText("Jumlah pembanding"),{target:{value:"500"}});
 expect(screen.queryByRole("form",{name:"Draf kandidat"})).toBeNull();
});

it("qualifies an empty shortlist when the source search was truncated",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({ok:true,rows:[],limited:true})));
 render(<PediaCurationPanel products={[product]} onCreated={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText("Kebutuhan produk"),{target:{value:"1"}});
 expect(await screen.findByText(/Belum ada kandidat cocok dalam 200 layanan pertama/)).toBeTruthy();
 expect(screen.queryByText(/^Belum ada kandidat cocok di mirror/)).toBeNull();
});
