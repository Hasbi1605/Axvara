// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({code:'AXP-20261015-TEST1234'}));
vi.mock('next/navigation',()=>({useParams:()=>route}));
import Page from '@/app/pedia/pesanan/[code]/page';
const order={code:'AXP-20261015-TEST1234',product_name:'Followers',tier_name:'Standar',tier_note:null,quantity:100,target:'https://instagram.com/buyer',status:'awaiting_payment',done:0,percent:0,eta_start:null,eta_finish:null,refill_days:0,refill_eligible:false,refund_credit_code:null,qris:{payable_amount:2501,image_url:'/test-qr.png',expires_at:'2099-01-01',status:'pending'}};
afterEach(()=>{cleanup();vi.unstubAllGlobals();route.code='AXP-20261015-TEST1234';});
const mock=(value:unknown)=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({order:value}),{headers:{'content-type':'application/json'}})));
it('pending shows the actual QR amount and manual refresh can move to completed',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({order}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetcher);render(<Page/>);
 expect(await screen.findByAltText('QRIS pembayaran')).toBeTruthy();expect(screen.getByText('Rp2.501')).toBeTruthy();
 fetcher.mockImplementation(async()=>new Response(JSON.stringify({order:{...order,status:'completed',done:100,percent:100,qris:null}}),{headers:{'content-type':'application/json'}}));fireEvent.click(screen.getByRole('button',{name:'Cek pembayaran'}));
 await waitFor(()=>expect(screen.queryByAltText('QRIS pembayaran')).toBeNull());expect(fetcher).toHaveBeenCalledTimes(2);
});
it('expired invoices cannot keep showing a scannable QR',async()=>{mock({...order,qris:{...order.qris,expires_at:'2000-01-01'}});render(<Page/>);expect(await screen.findByText('QRIS kedaluwarsa')).toBeTruthy();expect(screen.queryByAltText('QRIS pembayaran')).toBeNull();});
it('missing invoice and expired order never pretend that payment is complete',async()=>{mock({...order,qris:null});const page=render(<Page/>);expect(await screen.findByText(/QRIS belum tersedia/)).toBeTruthy();expect(screen.queryByText('Dibayar')).toBeNull();page.unmount();mock({...order,status:'expired',qris:null});render(<Page/>);expect(await screen.findByText('Pesanan kedaluwarsa')).toBeTruthy();expect(screen.queryByText('Dibayar')).toBeNull();});

it('removes an expired QR at the server deadline without waiting for another status response',async()=>{
 const deadline=Date.now()+2000;
 mock({...order,qris:{...order.qris,expires_at:new Date(deadline).toISOString()}});
 render(<Page/>);await screen.findByAltText('QRIS pembayaran');
 try{
  vi.spyOn(Date,'now').mockReturnValue(deadline+1);
  expect(await screen.findByText('QRIS kedaluwarsa',{}, {timeout:2000})).toBeTruthy();
  expect(screen.queryByAltText('QRIS pembayaran')).toBeNull();
  expect(screen.queryByRole('button',{name:'QR baru'})).toBeNull();
 }finally{vi.restoreAllMocks()}
});

it('deduplicates manual payment checks and keeps the visible invoice on a network failure',async()=>{
 const fetcher=vi.fn(async(_url?:string,_options?:unknown)=>new Response(JSON.stringify({order}),{headers:{'content-type':'application/json'}}));
 vi.stubGlobal('fetch',fetcher);render(<Page/>);await screen.findByAltText('QRIS pembayaran');
 let reject!:(error:Error)=>void;
 fetcher.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r}));
 const button=screen.getByRole('button',{name:'Cek pembayaran'});
 fireEvent.click(button);fireEvent.click(button);
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[1][0]).toContain('?wake=1');
 await act(async()=>{reject(new Error('Koneksi terputus'))});
 expect(await screen.findByRole('alert')).toBeTruthy();
 expect(screen.getByAltText('QRIS pembayaran')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Cek pembayaran'})).toBeTruthy();
});

it.each(['in_progress','partial','needs_check','completed'])('shows server state %s without a simulated payment action',async(status)=>{
 mock({...order,product_slug:'followers-instagram',status,done:45,percent:45,qris:null,refund_credit_code:status==='partial'?'PDK-TEST-TEST':null});
 render(<Page/>);await screen.findByRole('region',{name:'Status pesanan'});
 expect(screen.queryByAltText('QRIS pembayaran')).toBeNull();
 expect(screen.queryByText(/Simulasikan pembayaran/)).toBeNull();
 if(status==='in_progress')expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45');
 if(status==='partial')expect(screen.getByText('PDK-TEST-TEST')).toBeTruthy();
 if(status==='needs_check')expect(screen.getByText(/Tidak perlu order ulang/)).toBeTruthy();
 if(status==='completed')expect(screen.getByRole('link',{name:'Pesan lagi'}).getAttribute('href')).toBe('/pedia/o/followers-instagram');
});


it('loads a new invoice during a pending request and ignores the old response',async()=>{
 let resolve!:(response:Response)=>void;
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({order:{...order,code:'AXP-20261020-NEXT1234',status:'expired',qris:null}})));
 fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));
 vi.stubGlobal('fetch',fetcher);const page=render(<Page/>);
 route.code='AXP-20261020-NEXT1234';page.rerender(<Page/>);
 await screen.findByText('Pesanan kedaluwarsa');
 expect(fetcher).toHaveBeenCalledTimes(2);
 await act(async()=>{resolve(new Response(JSON.stringify({order})))});
 expect(screen.getByText('AXP-20261020-NEXT1234')).toBeTruthy();
 expect(screen.queryByAltText('QRIS pembayaran')).toBeNull();
});

it('refreshes pending payments in 5s, catches up after hidden time, then processing in 10s and stops at terminal',async()=>{
 vi.useFakeTimers();let hidden=false;
 vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 let current={...order};
 const fetcher=vi.fn(async(_url?:string)=>Response.json({order:current}));vi.stubGlobal('fetch',fetcher);
 try{
  render(<Page/>);await act(async()=>{});expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(fetcher).toHaveBeenCalledTimes(2);
  hidden=true;await act(async()=>{fireEvent(document,new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(60000)});
  expect(fetcher).toHaveBeenCalledTimes(2);
  current={...order,status:'in_progress'};hidden=false;
  await act(async()=>{fireEvent(document,new Event('visibilitychange'))});expect(fetcher).toHaveBeenCalledTimes(3);
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});expect(fetcher).toHaveBeenCalledTimes(4);
  current={...order,status:'completed'};
  await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});expect(fetcher).toHaveBeenCalledTimes(5);
  await act(async()=>{await vi.advanceTimersByTimeAsync(60000)});expect(fetcher).toHaveBeenCalledTimes(5);
  expect(fetcher.mock.calls.every(call=>!String(call[0]).includes('wake=1'))).toBe(true);
 }finally{cleanup();vi.useRealTimers();vi.restoreAllMocks()}
});
