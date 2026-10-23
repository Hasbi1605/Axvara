// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const toast=vi.hoisted(()=>({success:vi.fn(),error:vi.fn()}));
vi.mock('@/components/ui/Toast',()=>({useToast:()=>toast}));
import {OrdersManager} from '@/components/admin/OrdersManager';
import {PaymentReconciliation} from '@/components/admin/PaymentReconciliation';
afterEach(()=>{cleanup();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
function delayed(){const pending:{url:string,resolve:(r:Response)=>void}[]=[];vi.stubGlobal('fetch',vi.fn((url:unknown)=>new Promise<Response>(resolve=>pending.push({url:String(url),resolve}))));return pending;}
it('orders keep the newest filter/list/page when an aborted request still resolves late',async()=>{
 window.history.replaceState(null,'','/admin?section=orders&page=3');
 const p=delayed();render(<OrdersManager/>);await waitFor(()=>expect(p).toHaveLength(1));
 expect(p[0].url).toContain('page=3');
 fireEvent.change(screen.getByRole('combobox',{name:'Status'}),{target:{value:'lunas'}});await waitFor(()=>expect(p).toHaveLength(2));
 const body=(code:string,page:number)=>({orders:[{code,customer_name:code,customer_wa:'628000000000',items:'[]',subtotal:1000,payment_method:'qris',status:'lunas',created_at:'2026-10-24T00:00:00Z'}],pagination:{page,pages:4,total:1},stats:{total:1,pending:0,paid:1,revenue:1000}});
 await act(async()=>p[1].resolve(Response.json(body('AXV-NEW',1))));expect(screen.getAllByText('AXV-NEW')[0]).toBeTruthy();
 await act(async()=>p[0].resolve(Response.json(body('AXV-OLD',3))));expect(screen.queryByText('AXV-OLD')).toBeNull();expect(screen.getAllByText('AXV-NEW')[0]).toBeTruthy();expect(p).toHaveLength(2);expect(window.location.search).toContain('status=lunas');
});
it('payment reconciliation ignores a slow response from the previous filter',async()=>{
 const p=delayed();render(<PaymentReconciliation/>);await waitFor(()=>expect(p).toHaveLength(1));fireEvent.click(screen.getByRole('button',{name:'Semua'}));await waitFor(()=>expect(p).toHaveLength(2));
 const body=(name:string)=>({events:[{id:1,provider:'klikqris',amount:1000,sender_name:name,status:'matched',created_at:'2026-10-24T00:00:00Z'}],pagination:{page:1,pages:1,total:1}});
 await act(async()=>p[1].resolve(Response.json(body('NEW EVENT'))));expect(screen.getByText('NEW EVENT')).toBeTruthy();await act(async()=>p[0].resolve(Response.json(body('OLD EVENT'))));expect(screen.queryByText('OLD EVENT')).toBeNull();expect(screen.getByText('NEW EVENT')).toBeTruthy();
});
