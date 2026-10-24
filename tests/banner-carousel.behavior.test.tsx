// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({usePathname:()=>'/'}));
import {PopupBanner,BANNER_SESSION_KEY,BANNER_TRANSITION_MS} from '@/components/storefront/PopupBanner';
const banners=[1,2,3].map(id=>({id,title:`Info ${id}`,body:`Body ${id}`,is_active:1,image_url:'/r2/banners/fixture.webp',cta_label:`Baca ${id}`,cta_href:`/info-${id}`}));
beforeEach(()=>{vi.spyOn(HTMLImageElement.prototype,'complete','get').mockReturnValue(true);vi.spyOn(HTMLImageElement.prototype,'naturalWidth','get').mockReturnValue(1122);vi.useFakeTimers();localStorage.clear();sessionStorage.clear();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}));vi.stubGlobal('fetch',vi.fn(async()=>Response.json({banners,settings:{delay_ms:0,interval_ms:4000,autoplay:true,max_show_per_session:1}})));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
async function open(){render(<PopupBanner/>);await act(async()=>{await vi.advanceTimersByTimeAsync(20)});expect(screen.getByRole('dialog',{name:'Info AXVARA'})).toBeTruthy();}
const tick=async(ms:number)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms)});
it('rotates across all slides and loops without counting extra opens; manual navigation pauses',async()=>{
 await open();expect(screen.getByRole('group').textContent).toContain('Info 1');await tick(4000);expect(screen.getByRole('group').textContent).toContain('Info 2');await tick(4000);await tick(4000);expect(screen.getByRole('group').textContent).toContain('Info 1');expect(sessionStorage.getItem(BANNER_SESSION_KEY)).toBe('1');
 await tick(BANNER_TRANSITION_MS+50);fireEvent.keyDown(screen.getByRole('region'),{key:'ArrowLeft'});expect(screen.getByRole('group').textContent).toContain('Info 3');await tick(12000);expect(screen.getByRole('group').textContent).toContain('Info 3');expect(screen.queryByRole('button',{name:/otomatis/})).toBeNull();
});
it('pauses on hover/hidden and stays paused after keyboard focus',async()=>{
 await open();const region=screen.getByRole('region',{name:'Informasi dan promo'});fireEvent.mouseEnter(region);await tick(4000);await tick(4000);expect(screen.getByRole('group').textContent).toContain('Info 1');fireEvent.mouseLeave(region);await tick(4000);expect(screen.getByRole('group').textContent).toContain('Info 2');
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});fireEvent(document,new Event('visibilitychange'));await tick(8000);expect(screen.getByRole('group').textContent).toContain('Info 2');Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});fireEvent(document,new Event('visibilitychange'));await tick(4000);expect(screen.getByRole('group').textContent).toContain('Info 3');
 act(()=>screen.getByRole('link',{name:'Baca 3'}).focus());await tick(12000);expect(screen.getByRole('group').textContent).toContain('Info 3');act(()=>screen.getByRole('button',{name:'Tutup banner'}).focus());await tick(4000);expect(screen.getByRole('group').textContent).toContain('Info 3');
});
it('reduced motion disables autoplay and manual changes remain available',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:true,addEventListener:vi.fn(),removeEventListener:vi.fn()}));await open();await tick(16000);expect(screen.getByRole('group').textContent).toContain('Info 1');fireEvent.keyDown(screen.getByRole('region'),{key:'ArrowRight'});expect(screen.getByRole('group').textContent).toContain('Info 2');expect(screen.queryByRole('button',{name:/otomatis/})).toBeNull();expect(document.querySelector('.banner-slide-out')).toBeNull();
});
function pointer(node:Element,type:string,x:number,y:number){const e=new Event(type,{bubbles:true,cancelable:true});Object.assign(e,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y});fireEvent(node,e)}
it('horizontal swipe moves one slide; vertical scrolling and canceled gestures do not',async()=>{
 await open();const stage=screen.getByRole('group');pointer(stage,'pointerdown',160,100);pointer(stage,'pointerup',60,110);expect(screen.getByRole('group').textContent).toContain('Info 2');const next=screen.getByRole('group');pointer(next,'pointerdown',160,100);pointer(next,'pointerup',110,220);expect(screen.getByRole('group').textContent).toContain('Info 2');pointer(next,'pointerdown',160,100);pointer(next,'pointercancel',60,100);pointer(next,'pointerup',60,100);expect(screen.getByRole('group').textContent).toContain('Info 2');
});
it('failed image preserves text/CTA and focus trap stays inside the modal',async()=>{
 await open();fireEvent.error(screen.getByRole('img'));expect(screen.getByText('Gambar tidak dapat dimuat.')).toBeTruthy();expect(screen.getByRole('link',{name:'Baca 1'})).toBeTruthy();act(()=>screen.getByRole('link',{name:'Baca 1'}).focus());fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Tutup banner'}));
});
it('places navigation over the image, counter before text and checkbox before the acknowledgement',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({banners:[banners[0],{...banners[1],cta_href:null,cta_label:null}],settings:{delay_ms:0,interval_ms:4000,autoplay:true,max_show_per_session:1}})));
 await open();const media=document.querySelector('[data-banner-media]')!;expect(media.contains(screen.getByRole('button',{name:'Banner berikutnya'}))).toBe(true);expect(screen.queryByRole('button',{name:'Banner sebelumnya'})).toBeNull();
 expect(document.querySelector('[data-banner-caption]')?.firstElementChild?.textContent).toBe('1/2');fireEvent.click(screen.getByRole('button',{name:'Banner berikutnya'}));expect(screen.queryByRole('button',{name:'Banner berikutnya'})).toBeNull();expect(screen.getByRole('button',{name:'Banner sebelumnya'})).toBeTruthy();
 const acknowledgement=screen.getByRole('button',{name:'Saya Paham'});expect(screen.getByRole('checkbox').compareDocumentPosition(acknowledgement)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();fireEvent.click(acknowledgement);expect(screen.queryByRole('dialog')).toBeNull();
});

function deferredImages() {
 const pending = new Map<string, { resolve: () => void; reject: () => void }>();
 vi.stubGlobal('Image', class {
  src = '';
  decode() {
   return new Promise<void>((resolve, reject) => {
    pending.set(this.src, { resolve, reject: () => reject(new Error('decode failed')) });
   });
  }
 });
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({
  banners: banners.map(item => ({ ...item, image_url: `/banner-${item.id}.webp` })),
  settings: { delay_ms: 0, interval_ms: 4000, autoplay: true, max_show_per_session: 1 },
 })));
 return async (id: number, fail = false) => act(async () => {
  const image = pending.get(`/banner-${id}.webp`);
  expect(image).toBeTruthy();
  if (fail) image!.reject(); else image!.resolve();
 });
}

it('keeps the old slide until image decode, then retains a decorative backing through the dissolve', async () => {
 const ready = deferredImages();
 await open();
 const oldImage=screen.getByRole('img');
 fireEvent.click(screen.getByRole('button', { name: 'Banner berikutnya' }));
 expect(screen.getByRole('group').textContent).toContain('Info 1');
 expect(document.querySelector('.banner-slide-out')).toBeNull();
 await ready(2);
 expect(screen.getByRole('group').textContent).toContain('Info 2');
 const backing = document.querySelector('.banner-slide-out')!;
 expect(backing.getAttribute('aria-hidden')).toBe('true');
 expect(backing.textContent).toContain('Info 1');
 expect(backing.querySelector('img')).toBe(oldImage);
 expect(backing.querySelector('button,a,input,[tabindex]')).toBeNull();
 expect(screen.getAllByRole('img')).toHaveLength(1);
 expect(screen.getAllByRole('group')).toHaveLength(1);
 await tick(BANNER_TRANSITION_MS + 50);
 expect(document.querySelector('.banner-slide-out')).toBeNull();
 expect(sessionStorage.getItem(BANNER_SESSION_KEY)).toBe('1');
});

it('ignores stale image readiness when a newer destination was requested', async () => {
 const ready = deferredImages();
 await open();
 fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
 fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
 await ready(2);
 expect(screen.getByRole('group').textContent).toContain('Info 1');
 await ready(3);
 expect(screen.getByRole('group').textContent).toContain('Info 3');
});

it('waits for the mounted image load as well as predecode before starting the dissolve', async () => {
 const ready = deferredImages();
 vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
 await open();
 const oldImage = screen.getByRole('img');
 fireEvent.click(screen.getByRole('button', { name: 'Banner berikutnya' }));
 await ready(2);
 expect(document.querySelector('.banner-slide-pending')).toBeTruthy();
 expect(document.querySelector('.banner-slide-in')).toBeNull();
 expect(document.querySelector('.banner-slide-out img')).toBe(oldImage);
 expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true);
 const cta=screen.getByRole('link', {name:'Baca 2'});
 expect(cta.getAttribute('aria-disabled')).toBe('true');
 expect(fireEvent.click(cta)).toBe(false);
 await tick(1000);
 expect(document.querySelector('.banner-slide-out')).toBeTruthy();
 fireEvent.load(screen.getByRole('img'));
 expect(document.querySelector('.banner-slide-in')).toBeTruthy();
 expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(false);
 await tick(BANNER_TRANSITION_MS + 50);
 expect(document.querySelector('.banner-slide-out')).toBeNull();
});

it('coalesces rapid navigation until the current dissolve finishes', async () => {
 await open();
 fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
 fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
 fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
 expect(screen.getByRole('group').textContent).toContain('Info 2');
 await tick(BANNER_TRANSITION_MS + 50);
 expect(screen.getByRole('group').textContent).toContain('Info 1');
 await tick(BANNER_TRANSITION_MS + 50);
 expect(document.querySelector('.banner-slide-out')).toBeNull();
 expect(sessionStorage.getItem(BANNER_SESSION_KEY)).toBe('1');
});

it('closing during image preparation cancels late navigation without reopening', async () => {
 const ready = deferredImages();
 await open();
 fireEvent.click(screen.getByRole('button', { name: 'Banner berikutnya' }));
 fireEvent.click(screen.getByRole('button', { name: 'Tutup banner' }));
 await ready(2);
 await tick(5000);
 expect(screen.queryByRole('dialog')).toBeNull();
});

it('a decode failure still reaches the image fallback and leaves navigation usable', async () => {
 const ready = deferredImages();
 await open();
 fireEvent.click(screen.getByRole('button', { name: 'Banner berikutnya' }));
 await ready(2, true);
 fireEvent.error(screen.getByRole('img'));
 expect(screen.getByRole('group').textContent).toContain('Gambar tidak dapat dimuat.');
 await tick(BANNER_TRANSITION_MS + 50);
 fireEvent.click(screen.getByRole('button', { name: 'Banner berikutnya' }));
 await ready(3);
 expect(screen.getByRole('group').textContent).toContain('Info 3');
});
