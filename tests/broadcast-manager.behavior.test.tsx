// @vitest-environment jsdom
import { afterEach, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { render } from './setup/admin-render';
import userEvent from '@testing-library/user-event';
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
  const calls=setup();fireEvent.click(await screen.findByRole('button',{name:'Kirim Promo'}));
 expect((screen.getByRole('button',{name:'Tinjau siaran'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Tutup'}));
 fireEvent.click(screen.getByRole('button',{name:'Edit Promo'}));
 fireEvent.change(screen.getByLabelText('Isi siaran'),{target:{value:'Isi diubah'}});
 expect(screen.queryByRole('button',{name:'Kirim siaran sekarang'})).toBeNull();
 expect(within(screen.getByRole('region',{name:'Pratinjau pesan'})).getByText('Isi diubah')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Simpan template'}));await waitFor(()=>expect(calls[0]?.action).toBe('save'));expect(calls.some(c=>c.action==='send')).toBe(false);
});
it('retains one request ID after an ambiguous launch and retries that same campaign',async()=>{
 const calls=setup(true);fireEvent.click(await screen.findByRole('button',{name:'Kirim Promo'}));await userEvent.click(screen.getByRole('checkbox',{name:'Subscriber email'}));fireEvent.click(screen.getByRole('button',{name:'Tinjau siaran'}));
 fireEvent.click(await screen.findByRole('button',{name:'Kirim siaran sekarang'}));await screen.findByRole('alert');const id=calls.find(c=>c.action==='send').id;expect(JSON.parse(sessionStorage.getItem('axvara-broadcast-pending')!).id).toBe(id);
 fireEvent.click(screen.getByRole('button',{name:'Coba lagi pengiriman'}));await waitFor(()=>expect(calls.filter(c=>c.action==='send')).toHaveLength(2));expect(calls.filter(c=>c.action==='send').map(c=>c.id)).toEqual([id,id]);await waitFor(()=>expect(sessionStorage.getItem('axvara-broadcast-pending')).toBeNull());
});
it('blocks archived sends and requires cancel confirmation in history',async()=>{
 const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
  if(!options?.method)return {ok:true,json:async()=>({templates:[{...t,archived:1}],campaigns:[{id:'campaign-1',content:t,channels:['email'],status:'queued',created_at:'2026-11-13 00:00:00',progress:[]}]})};
  calls.push(JSON.parse(String(options.body)));return {ok:true,json:async()=>({ok:true})};
 }));
 render(<BroadcastManager/>);
 expect((await screen.findByRole('button',{name:'Kirim Promo'}) as HTMLButtonElement).disabled).toBe(true);
 await userEvent.click(screen.getByRole('tab',{name:'Riwayat'}));fireEvent.click(screen.getByRole('button',{name:'Hentikan'}));
 expect(calls).toHaveLength(0);const dialog=await screen.findByRole('alertdialog');
 fireEvent.click(within(dialog).getByRole('button',{name:'Hentikan siaran'}));
 await waitFor(()=>expect(calls).toEqual([{action:'cancel',id:'campaign-1'}]));
});
it('restores an unconfirmed request after reload and blocks launching a different one',async()=>{
 const payload={action:'send',id:'22222222-2222-4222-8222-222222222222',templateId:t.id,revision:1,channels:['email']};sessionStorage.setItem('axvara-broadcast-pending',JSON.stringify(payload));const calls=setup();
 fireEvent.click(await screen.findByRole('button',{name:'Coba lagi pengiriman'}));await waitFor(()=>expect(calls).toContainEqual(payload));
});
it('keeps template edits until discarding is confirmed and closes a clean new template with Escape',async()=>{
 const calls=setup();const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Edit Promo'}));
 const editor=screen.getByRole('dialog',{name:'Edit template'});
 expect(within(editor).getByLabelText('Isi siaran')).toHaveProperty('value','Isi tersimpan');
 await user.type(within(editor).getByLabelText('Isi siaran'),' diubah');
 await user.keyboard('{Escape}');
 let confirmation=await screen.findByRole('alertdialog',{name:'Buang perubahan template?'});
 await user.click(within(confirmation).getByRole('button',{name:'Batal'}));
 expect(within(editor).getByLabelText('Isi siaran')).toHaveProperty('value','Isi tersimpan diubah');
 await user.click(within(editor).getByRole('button',{name:'Tutup dialog'}));
 confirmation=await screen.findByRole('alertdialog',{name:'Buang perubahan template?'});
 await user.click(within(confirmation).getByRole('button',{name:'Buang perubahan'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await user.click(screen.getByRole('button',{name:'Template baru'}));
 expect(screen.getByRole('dialog',{name:'Template baru'})).toBeTruthy();
 await user.keyboard('{Escape}');
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(calls).toHaveLength(0);
});
