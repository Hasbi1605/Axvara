// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BannerManager } from "@/components/admin/BannerManager";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/admin/ImageDropzone", () => ({ ImageDropzone: () => null }));
const banner = { id: 1, title: "Promo banner", body: "Original", is_active: 0, sort_order: 3, delay_ms: 0, max_show_per_session: 1 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("uses a partial switch request, locks pending writes and synchronizes the unsaved editor", async () => {
  let resolveToggle!: (value: unknown) => void;
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (!options?.method) return { ok: true, json: async () => ({ banners: [{ ...banner, is_active: 1, sort_order: 5 }] }) };
    if (_url === "/api/banners/1") return await new Promise((resolve) => { resolveToggle = resolve; });
    return { ok: true, json: async () => ({ sort_order: 5 }) };
  });
  // Start inactive, then allow load after save to reflect the resolved order.
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ banners: [banner] }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<BannerManager />);
  const toggle = await screen.findByRole("switch", { name: "Aktifkan banner Promo banner" });
  expect(toggle.nextElementSibling).toBe(screen.getByRole("button", { name: /Edit$/ }));
  expect(toggle.textContent).toBe(""); // Same compact track as the product control.
  fireEvent.click(screen.getByRole("button", { name: /Edit$/ }));
  fireEvent.change(screen.getByPlaceholderText("Deskripsi singkat"), { target: { value: "Unsaved content" } });
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-busy")).toBe("true");
  expect((toggle as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /Simpan perubahan$/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ is_active: true });
  resolveToggle({ ok: true, json: async () => ({ banner: { ...banner, is_active: 1 } }) });
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  expect((screen.getByRole("checkbox", { name: "Aktif di storefront" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Simpan perubahan$/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({ body: "Unsaved content", is_active: true });
  expect(screen.getByText(/urutan 1/)).toBeTruthy();
  expect(toast.success).toHaveBeenCalledWith("Perubahan banner disimpan. Urutan 5.");
});

it("keeps failed switches unchanged and exposes an inline accessible error", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => options?.method
    ? { ok: false, json: async () => ({ error: "Status unavailable" }) }
    : { ok: true, json: async () => ({ banners: [banner] }) }));
  render(<BannerManager />);
  const toggle = await screen.findByRole("switch");
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Status unavailable");
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect((toggle as HTMLButtonElement).disabled).toBe(false);
});

it('moves a row with the full expected list and keeps content edits from sending position',async()=>{
 const list=[{...banner,id:1,title:'First',sort_order:0},{...banner,id:2,title:'Second',sort_order:1}];let current=list;
 const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
  if(url==='/api/banners/reorder'){current=[{...list[1],sort_order:0},{...list[0],sort_order:1}];return Response.json({banners:current})}
  return Response.json({banners:current});
 });vi.stubGlobal('fetch',fetcher);render(<BannerManager/>);fireEvent.click(await screen.findByRole('button',{name:'Naikkan Second'}));await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Urutan banner disimpan.'));
 expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ids:[2,1],expected_ids:[1,2]});const names=screen.getAllByRole('button',{name:/Geser urutan/}).map(b=>b.getAttribute('aria-label'));expect(names).toEqual(['Geser urutan Second','Geser urutan First']);
});
it('reloads authoritative order on conflict and exposes the error',async()=>{
 const list=[{...banner,id:1,title:'First',sort_order:0},{...banner,id:2,title:'Second',sort_order:1}];
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/banners/reorder'?Response.json({error:'Daftar berubah'},{status:409}):Response.json({banners:list})));
 render(<BannerManager/>);fireEvent.click(await screen.findByRole('button',{name:'Naikkan Second'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','Daftar berubah ');expect(screen.getAllByRole('button',{name:/Geser urutan/}).map(b=>b.getAttribute('aria-label'))).toEqual(['Geser urutan First','Geser urutan Second']);
});
it('shared settings cannot be saved before loading and are independent from content fields',async()=>{
 const config={delay_ms:1500,interval_ms:6000,autoplay:true,max_show_per_session:1};const fetcher=vi.fn(async(url:string,options?:RequestInit)=>url==='/api/banners/settings'?Response.json({settings:JSON.parse(String(options?.body))}):Response.json({banners:[banner],settings:config}));vi.stubGlobal('fetch',fetcher);
 render(<BannerManager/>);expect(screen.getByRole('button',{name:'Simpan pengaturan'})).toHaveProperty('disabled',true);await screen.findByRole('switch');fireEvent.change(screen.getByRole('spinbutton',{name:'Ganti slide setiap (detik)'}),{target:{value:'8'}});fireEvent.click(screen.getByRole('button',{name:'Simpan pengaturan'}));await waitFor(()=>expect(toast.success).toHaveBeenCalledWith('Pengaturan popup disimpan.'));expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({...config,interval_ms:8000});
});
