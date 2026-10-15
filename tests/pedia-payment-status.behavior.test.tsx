// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useParams:()=>({code:'AXP-20261015-TEST1234'})}));
import Page from '@/app/pedia/pesanan/[code]/page';
const order={code:'AXP-20261015-TEST1234',product_name:'Followers',tier_name:'Standar',tier_note:null,quantity:100,target:'https://instagram.com/buyer',status:'awaiting_payment',done:0,percent:0,eta_start:null,eta_finish:null,refill_days:0,refill_eligible:false,refund_credit_code:null,qris:{payable_amount:2501,image_url:'/test-qr.png',expires_at:'2099-01-01',status:'pending'}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const mock=(value:unknown)=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({order:value}),{headers:{'content-type':'application/json'}})));
it('pending shows the actual QR amount and manual refresh can move to completed',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({order}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);render(<Page/>);
 expect(await screen.findByAltText('QRIS pembayaran')).toBeTruthy();expect(screen.getByText('Rp2.501')).toBeTruthy();
 fetcher.mockImplementation(async()=>new Response(JSON.stringify({order:{...order,status:'completed',done:100,percent:100,qris:null}}),{headers:{'content-type':'application/json'}}));fireEvent.click(screen.getByRole('button',{name:'Cek pembayaran'}));
 await waitFor(()=>expect(screen.queryByAltText('QRIS pembayaran')).toBeNull());expect(fetcher).toHaveBeenCalledTimes(2);
});
it('expired invoices cannot keep showing a scannable QR',async()=>{mock({...order,qris:{...order.qris,expires_at:'2000-01-01'}});render(<Page/>);expect(await screen.findByText('QRIS kedaluwarsa')).toBeTruthy();expect(screen.queryByAltText('QRIS pembayaran')).toBeNull();});
it('missing invoice and expired order never pretend that payment is complete',async()=>{mock({...order,qris:null});const page=render(<Page/>);expect(await screen.findByText(/QRIS belum tersedia/)).toBeTruthy();expect(screen.queryByText('Dibayar')).toBeNull();page.unmount();mock({...order,status:'expired',qris:null});render(<Page/>);expect(await screen.findByText('Pesanan kedaluwarsa')).toBeTruthy();expect(screen.queryByText('Dibayar')).toBeNull();});
