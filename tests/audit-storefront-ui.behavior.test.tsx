// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useParams:()=>({slug:'fixture'}),usePathname:()=>window.location.pathname,useSearchParams:()=>new URLSearchParams(window.location.search),useRouter:()=>({push:vi.fn(),replace:vi.fn(),back:vi.fn()})}));
import ProductDetailClient from '@/app/(shop)/produk/[slug]/product-detail-client';
import Lacak from '@/app/(shop)/lacak-pesanan/lacak-pesanan-client';
import {ToastProvider} from '@/components/ui/Toast';
import {useCart} from '@/stores/cart';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();useCart.setState({items:[],drawerOpen:false});vi.spyOn(window,'scrollTo').mockImplementation(()=>{});Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{value:vi.fn(),configurable:true});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();window.history.replaceState(null,'','/');});
it('the actual PDP repeat-add and cart increment keep effective unique availability',async()=>{
 window.history.replaceState(null,'','/produk/fixture');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({products:[]})));
 const product={id:'1',slug:'fixture',name:'Fixture',price:10000,description:'Fixture',categorySlug:'tools',image:'/brand/axvara-mark.svg',images:[],stock:2,variantCount:1};
 const variant={id:1,label:'Private',price:10000,stock:2,inventory_available:1,min_qty:1,is_active:1,fulfillment_mode:'unique',warranty_type:'none'};
 render(<ToastProvider><ProductDetailClient slug="fixture" initialProducts={[product] as never} initialCatalog={{slug:'fixture',product:{id:1,slug:'fixture',name:'Fixture',variants:[variant]},variantsEnabled:true} as never}/></ToastProvider>);
 const add=screen.getByRole('button',{name:/Tambah ke Keranjang/});fireEvent.click(add);fireEvent.click(add);
 expect(useCart.getState().items[0]).toMatchObject({qty:1,stock:1});useCart.getState().setQty('1',2,1);expect(useCart.getState().items[0].qty).toBe(1);
});
it('actual tracking and credentials panel update the first account through the final account',async()=>{
 vi.useFakeTimers();let ready=1;
 window.history.replaceState(null,'','/lacak-pesanan?code=AXV-20261024-STREAM01&contact=buyer@example.test');
 const fetcher=vi.fn(async(url:unknown)=>{
  if(String(url).includes('/credentials'))return Response.json({credentials:Array.from({length:ready},(_,i)=>({details:'FIXTURE-ACCOUNT-'+(i+1),completed_at:null})),capability_token:'fixture-token'});
  if(String(url).includes('/api/orders/lookup'))return Response.json({order:{code:'AXV-20261024-STREAM01',status:'lunas',items:[{name:'Fixture',qty:3,price:1000}],subtotal:3000,credentials_ready:true,supplier_running:false,unique_units_progress:{ready,total:3}}});
  return Response.json({});
 });vi.stubGlobal('fetch',fetcher);
 await act(async()=>{render(<Lacak/>)});expect(screen.getByText('FIXTURE-ACCOUNT-1')).toBeTruthy();expect(screen.queryByText('FIXTURE-ACCOUNT-3')).toBeNull();
 ready=3;await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(screen.getByText('FIXTURE-ACCOUNT-3')).toBeTruthy();expect(screen.getByText('3 dari 3 akun siap')).toBeTruthy();
 const calls=fetcher.mock.calls.length;await act(async()=>{await vi.advanceTimersByTimeAsync(60000)});expect(fetcher).toHaveBeenCalledTimes(calls);
});
