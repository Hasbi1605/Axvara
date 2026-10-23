// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(),usePathname:()=>'/lacak-pesanan'}));
vi.mock('@/components/storefront/WrCredentialsPanel',()=>({WrCredentialsPanel:({deliveryProgress}:{deliveryProgress?:{ready:number;total:number}})=><div data-testid="progress">{deliveryProgress?.ready}/{deliveryProgress?.total}</div>}));
vi.mock('@/components/storefront/StoreWhatsAppLink',()=>({StoreWhatsAppLink:({children}:{children:React.ReactNode})=><a>{children}</a>}));
vi.mock('@/components/storefront/DeviceOrders',()=>({DeviceOrders:()=>null}));
import Page from '@/app/(shop)/lacak-pesanan/lacak-pesanan-client';
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear()});
it('polls 1/3 through 3/3, pauses hidden, backs off 429 and never overlaps requests',async()=>{
 vi.useFakeTimers();let hidden=false;vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
 vi.stubGlobal('requestAnimationFrame',()=>1);
 let ready=1;const response=()=>Response.json({order:{code:'AXV-20261024-PROGRESS',status:'lunas',items:[{name:'Fixture',price:1000,qty:3}],subtotal:3000,credentials_ready:true,supplier_running:false,unique_units_progress:{ready,total:3}}});
 const fetcher=vi.fn(async()=>response());vi.stubGlobal('fetch',fetcher);
 render(<Page/>);fireEvent.change(screen.getByLabelText(/Kode pesanan/),{target:{value:'AXV-20261024-PROGRESS'}});const contact=screen.getByLabelText(/No. WA atau email checkout/);fireEvent.change(contact,{target:{value:'buyer@example.test'}});
 await act(async()=>{fireEvent.submit(contact.closest('form')!)});expect(screen.getByTestId('progress').textContent).toBe('1/3');
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(fetcher.mock.calls).toHaveLength(2);
 hidden=true;await act(async()=>{await vi.advanceTimersByTimeAsync(60000)});expect(fetcher).toHaveBeenCalledTimes(2);
 hidden=false;fetcher.mockResolvedValueOnce(Response.json({error:'rate limited'},{status:429,headers:{'Retry-After':'60'}}));await act(async()=>{fireEvent(document,new Event('visibilitychange'))});expect(fetcher).toHaveBeenCalledTimes(3);
 await act(async()=>{await vi.advanceTimersByTimeAsync(55000)});expect(fetcher).toHaveBeenCalledTimes(3);
 let resolve!:(v:Response)=>void;fetcher.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(fetcher).toHaveBeenCalledTimes(4);
 await act(async()=>{await vi.advanceTimersByTimeAsync(10000)});expect(fetcher).toHaveBeenCalledTimes(4);
 ready=3;await act(async()=>{resolve(response())});expect(screen.getByTestId('progress').textContent).toBe('3/3');
 await act(async()=>{await vi.advanceTimersByTimeAsync(60000)});expect(fetcher).toHaveBeenCalledTimes(4);
});
