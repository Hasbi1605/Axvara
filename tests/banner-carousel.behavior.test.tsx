// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/'}));
import {PopupBanner,BANNER_SESSION_KEY} from '@/components/storefront/PopupBanner';
const banners=[1,2,3].map(id=>({id,title:`Info ${id}`,body:`Body ${id}`,is_active:1,image_url:'/r2/banners/fixture.webp',cta_label:`Baca ${id}`,cta_href:`/info-${id}`}));
beforeEach(()=>{vi.useFakeTimers();localStorage.clear();sessionStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));vi.stubGlobal('fetch',vi.fn(async()=>Response.json({banners,settings:{delay_ms:0,interval_ms:4000,autoplay:true,max_show_per_session:1}})));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
async function open(){render(<PopupBanner/>);await act(async()=>{await vi.advanceTimersByTimeAsync(20)});expect(screen.getByRole('dialog',{name:'Info AXVARA'})).toBeTruthy();}
const tick=async(ms:number)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms)});
it('rotates across all slides and loops without counting extra opens; manual navigation pauses',async()=>{
 await open();expect(screen.getByText('Info 1')).toBeTruthy();await tick(4000);expect(screen.getByText('Info 2')).toBeTruthy();await tick(4000);await tick(4000);expect(screen.getByText('Info 1')).toBeTruthy();expect(sessionStorage.getItem(BANNER_SESSION_KEY)).toBe('1');
 fireEvent.click(screen.getByRole('button',{name:'Banner sebelumnya'}));expect(screen.getByText('Info 3')).toBeTruthy();await tick(12000);expect(screen.getByText('Info 3')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Putar otomatis'}));await tick(4000);expect(screen.getByText('Info 1')).toBeTruthy();
});
it('pauses on hover/hidden and only explicit play resumes after keyboard focus',async()=>{
 await open();const region=screen.getByRole('region',{name:'Informasi dan promo'});fireEvent.mouseEnter(region);await tick(4000);await tick(4000);expect(screen.getByText('Info 1')).toBeTruthy();fireEvent.mouseLeave(region);await tick(4000);expect(screen.getByText('Info 2')).toBeTruthy();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});fireEvent(document,new Event('visibilitychange'));await tick(8000);expect(screen.getByText('Info 2')).toBeTruthy();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});fireEvent(document,new Event('visibilitychange'));await tick(4000);expect(screen.getByText('Info 3')).toBeTruthy();
 act(()=>screen.getByRole('link',{name:'Baca 3'}).focus());await tick(12000);expect(screen.getByText('Info 3')).toBeTruthy();act(()=>screen.getByRole('button',{name:'Tutup banner'}).focus());await tick(4000);expect(screen.getByText('Info 3')).toBeTruthy();
});
it('reduced motion disables autoplay and manual changes remain available',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));await open();await tick(16000);expect(screen.getByText('Info 1')).toBeTruthy();fireEvent.keyDown(screen.getByRole('region'),{key:'ArrowRight'});expect(screen.getByText('Info 2')).toBeTruthy();expect(screen.getByRole('button',{name:'Putar otomatis'})).toHaveProperty('disabled',true);
});
function pointer(node:Element,type:string,x:number,y:number){const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y});fireEvent(node,e)}
it('horizontal swipe moves one slide; vertical scrolling and canceled gestures do not',async()=>{
 await open();const stage=screen.getByRole('group');pointer(stage,'pointerdown',160,100);pointer(stage,'pointerup',60,110);expect(screen.getByText('Info 2')).toBeTruthy();const next=screen.getByRole('group');pointer(next,'pointerdown',160,100);pointer(next,'pointerup',110,220);expect(screen.getByText('Info 2')).toBeTruthy();pointer(next,'pointerdown',160,100);pointer(next,'pointercancel',60,100);pointer(next,'pointerup',60,100);expect(screen.getByText('Info 2')).toBeTruthy();
});
it('failed image preserves text/CTA and focus trap stays inside the modal',async()=>{
 await open();fireEvent.error(screen.getByRole('img'));expect(screen.getByText('Gambar tidak dapat dimuat.')).toBeTruthy();expect(screen.getByRole('link',{name:'Baca 1'})).toBeTruthy();act(()=>screen.getByRole('checkbox').focus());fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Tutup banner'}));
});
