// @vitest-environment jsdom
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "./setup/admin-render";
import { useProductManager } from "@/components/admin/useProductManager";
import { ProductsSection } from "@/components/admin/sections/ProductsSection";
import type { Prod } from "@/components/admin/product-types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
const noop=()=>{};
const toast={success:vi.fn(),error:vi.fn()};
function Harness(){
  const p=useProductManager(toast,noop);const {load}=p;useEffect(()=>{void load();},[load]);
  return <><ProductsSection prods={p.prods} paged={p.paged} filtered={p.filtered} q={p.q} safePage={p.safePage} totalPages={p.totalPages} perPage={p.perPage} loadingList={p.loadingList} toggling={p.toggling} activeProducts={p.activeProducts} lowStock={p.lowStock} soldProducts={p.soldProducts} liveProducts={p.liveProducts} hiddenProducts={p.hiddenProducts} offProducts={p.offProducts} liveTab={p.liveTab} onLiveTabChange={p.setLiveTab} perPageAdmin={p.perPageAdmin} onPerPageChange={p.setPerPageAdmin} supplierFilter={p.supplierFilter} onSupplierFilterChange={p.setSupplierFilter} onQueryChange={p.setQ} onPageChange={p.setPage} onlyLowStock={p.onlyLowStock} onClearLowStock={noop} onNew={noop} onEdit={noop} onDelete={p.setDeleteTarget} onRestore={p.restoreProduct} onToggleActive={p.toggleActive} reordering={p.reordering} onMove={p.moveProduct} onJump={p.jumpProduct} onSoldCount={p.saveSoldCount}/>
  <ConfirmDialog open={!!p.deleteTarget} title={p.deleteTarget?.archivedAt?'Hapus permanen produk?':'Arsipkan produk?'} description="Fixture lifecycle confirmation" confirmLabel={p.deleteTarget?.archivedAt?'Hapus permanen':'Arsipkan produk'} onClose={()=>p.setDeleteTarget(null)} onConfirm={p.confirmDelete} loading={p.deleting}/></>;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('moves a row to Arsip, preserves supplier badges, restores inactive, and sends permanent DELETE only for eligible rows',async()=>{
  const base:Prod={id:'1',name:'Manual fixture',slug:'fixture',description:'',price:1000,stock:3,isActive:true,categorySlug:'ai-chatbot',image:'',images:[],soldCount:4,supplier:'Manual'};
  let products:Prod[]=[base,{...base,id:'2',name:'Supplier fixture',supplier:'TUNVN',archivedAt:'2026-11-15',isActive:false,canHardDelete:false,hardDeleteReason:'Produk supplier harus tetap di Arsip.'}];
  const methods:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(url.startsWith('/api/categories'))return Response.json({categories:[]});
    if(url==='/api/products')return Response.json({products});
    methods.push(`${init?.method} ${url}`);
    if(init?.method==='PATCH')products=products.map(p=>p.id==='1'?{...p,archivedAt:null,isActive:false}:p);
    else if(url.includes('permanent=1'))products=products.filter(p=>p.id!=='1');
    else products=products.map(p=>p.id==='1'?{...p,archivedAt:'2026-11-15',isActive:false,canHardDelete:true}:p);
    return Response.json({ok:true});
  }));
  const user=userEvent.setup();render(<Harness/>);
  await screen.findByRole('tab',{name:'Live (1)'});
  expect(screen.getByRole('tab',{name:'Semua (1)'})).toBeTruthy();
  await user.click(screen.getAllByLabelText('Arsipkan Manual fixture')[0]);await user.click(screen.getByRole('button',{name:'Arsipkan produk'}));
  await screen.findByRole('tab',{name:'Arsip (2)'});expect(screen.queryByText('Manual fixture')).toBeNull();
  await user.click(screen.getByRole('tab',{name:'Arsip (2)'}));
  expect(screen.getByLabelText('Hapus permanen Supplier fixture').hasAttribute('disabled')).toBe(true);
  expect(screen.getByText('Produk supplier harus tetap di Arsip.')).toBeTruthy();
  expect(document.querySelector('[data-supplier="TUNVN"]')).toBeTruthy();
  await user.click(screen.getByLabelText('Pulihkan Manual fixture'));
  await screen.findByRole('tab',{name:'Nonaktif manual (1)'});expect(screen.queryByText('Manual fixture')).toBeNull();
  await user.click(screen.getByRole('tab',{name:'Nonaktif manual (1)'}));
  await user.click(screen.getAllByLabelText('Arsipkan Manual fixture')[0]);await user.click(screen.getByRole('button',{name:'Arsipkan produk'}));
  await screen.findByRole('tab',{name:'Arsip (2)'});await user.click(screen.getByRole('tab',{name:'Arsip (2)'}));
  await user.click(screen.getByLabelText('Hapus permanen Manual fixture'));expect(screen.getByRole('alertdialog')).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Hapus permanen'}));
  await waitFor(()=>expect(methods).toContain('DELETE /api/products/1?permanent=1'));
  await screen.findByRole('tab',{name:'Arsip (1)'});expect(toast.error).not.toHaveBeenCalled();
});
