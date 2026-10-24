// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BroadcastManager } from '@/components/admin/BroadcastManager';
const t={id:'11111111-1111-4111-8111-111111111111',revision:1,archived:0,name:'Promo',title:'Promo AXVARA',body:'Isi tersimpan',cta_label:'',cta_url:''};
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.clearAllMocks();});
function setup(fail=false){const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
 if(!options?.method)return {ok:true,json:async()=>({templates:[t],campaigns:[]})};
 const b=JSON.parse(String(options.body));calls.push(b);
 if(b.action==='review')return {ok:true,json:async()=>({snapshot:t,counts:{email:2,telegram:3}})};
 if(b.action==='send'&&fail){fail=false;return {ok:false,status:503,json:async()=>({error:'Belum pasti'})};}
 return {ok:true,json:async()=>({id:b.id||t.id})};
}));render(<BroadcastManager/>);return calls;}
it('requires explicit destinations and review, and saving never sends',async()=>{
 const calls=setup();fireEvent.click(await screen.findByRole('button',{name:/^Promo/}));
 expect((screen.getByRole('button',{name:'Tinjau siaran'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Isi siaran'),{target:{value:'Isi diubah'}});
 expect((screen.getByRole('checkbox',{name:'Subscriber email'}) as HTMLInputElement).closest('fieldset')?.disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Simpan template'}));await waitFor(()=>expect(calls[0]?.action).toBe('save'));expect(calls.some(c=>c.action==='send')).toBe(false);
});
it('retains one request ID after an ambiguous launch and retries that same campaign',async()=>{
 const calls=setup(true);fireEvent.click(await screen.findByRole('button',{name:/^Promo/}));fireEvent.click(screen.getByRole('checkbox',{name:'Subscriber email'}));fireEvent.click(screen.getByRole('button',{name:'Tinjau siaran'}));
 fireEvent.click(await screen.findByRole('button',{name:'Kirim siaran sekarang'}));await screen.findByRole('alert');const id=calls.find(c=>c.action==='send').id;expect(JSON.parse(sessionStorage.getItem('axvara-broadcast-pending')!).id).toBe(id);
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi pengiriman'}));await waitFor(()=>expect(calls.filter(c=>c.action==='send')).toHaveLength(2));expect(calls.filter(c=>c.action==='send').map(c=>c.id)).toEqual([id,id]);await waitFor(()=>expect(sessionStorage.getItem('axvara-broadcast-pending')).toBeNull());
});
it('restores an unconfirmed request after reload and blocks launching a different one',async()=>{
 const payload={action:'send',id:'22222222-2222-4222-8222-222222222222',templateId:t.id,revision:1,channels:['email']};sessionStorage.setItem('axvara-broadcast-pending',JSON.stringify(payload));const calls=setup();
 fireEvent.click(await screen.findByRole('button',{name:'Coba lagi pengiriman'}));await waitFor(()=>expect(calls).toContainEqual(payload));
});
