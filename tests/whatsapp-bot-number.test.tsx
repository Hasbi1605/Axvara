// @vitest-environment jsdom
import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WhatsAppNotifications} from '@/components/admin/WhatsAppNotifications';
import {normalizeBotNumber} from '@/lib/whatsapp/bot-number';

const FIRST='6283181632507',NEXT='628123456789',REV='11111111-2222-4333-8444-555555555555';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('normalizes common phone formats and rejects invalid input',()=>{
 for(const value of ['+62 812-3456-789','08123456789',NEXT])expect(normalizeBotNumber(value)).toBe(NEXT);
 for(const value of ['',null,'123','0'.repeat(12),'9'.repeat(16),'62812hello3456789','<script>1234567890','62+8123456789'])expect(normalizeBotNumber(value)).toBeNull();
});
function mockApi(fail=false){
 let gateway={connected:true,botNumber:FIRST,botRevision:'initial',groupName:"AXVARA'S",pairingCode:undefined as string|undefined};
 let config={enabled:true,botNumber:FIRST,botRevision:'initial'};
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const body=init?.body?JSON.parse(String(init.body)):null;
  if(body?.action==='number'){
   config={...config,enabled:false};gateway={connected:false,botNumber:NEXT,botRevision:REV,groupName:'',pairingCode:undefined};
   if(fail)return {ok:false,json:async()=>({error:'Koneksi terputus. Cek koneksi.'})};
  }
  if(body?.action==='pair')gateway={...gateway,pairingCode:'1234-5678'};
  if(body?.action==='enable')config={enabled:true,botNumber:NEXT,botRevision:REV};
  return {ok:true,json:async()=>({config:{...config},gateway:{...gateway}})};
 });
 vi.stubGlobal('fetch',fetcher);
 return {fetcher,connect:()=>{gateway={...gateway,connected:true,groupName:"AXVARA'S",pairingCode:undefined};},disconnect:()=>{gateway={...gateway,connected:false};},replaceElsewhere:()=>{gateway={...gateway,botNumber:NEXT,botRevision:REV,pairingCode:undefined};}};
}
describe('manual bot-number controls',()=>{
 it('changes a connected bot, clears activation, pairs the new number and activates only its reviewed revision',async()=>{
  const api=mockApi();render(<WhatsAppNotifications/>);
  await waitFor(()=>expect(screen.getByText(/Bot tersambung/).textContent).toContain('Notifikasi aktif'));
  fireEvent.click(screen.getByText('Ganti nomor bot'));
  const input=screen.getByLabelText('Nomor WhatsApp bot baru');
  fireEvent.change(input,{target:{value:'not-a-phone'}});expect((screen.getByText('Simpan nomor bot') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(input,{target:{value:'08123456789'}});fireEvent.submit(input.closest('form')!);
  await waitFor(()=>expect(screen.getByText(/Bot belum tersambung/).textContent).toContain('Notifikasi belum aktif'));
  expect(screen.queryByLabelText('Nomor WhatsApp bot baru')).toBeNull();
  expect(screen.getByText(new RegExp('Bot '+NEXT))).toBeTruthy();
  const changed=api.fetcher.mock.calls.map(call=>call[1]?.body&&JSON.parse(String(call[1].body))).find(body=>body?.action==='number');
  expect(changed).toEqual({action:'number',botNumber:FIRST,botRevision:'initial',newBotNumber:'08123456789'});
  fireEvent.click(screen.getByText('Hubungkan nomor bot'));
  await screen.findByText('1234-5678');expect(screen.getByText(new RegExp('Di WhatsApp '+NEXT))).toBeTruthy();
  api.connect();fireEvent.click(screen.getByText('Cek koneksi'));
  await waitFor(()=>expect(screen.queryByText('1234-5678')).toBeNull());
  fireEvent.click(screen.getByText('Aktifkan notifikasi'));
  await waitFor(()=>expect(screen.getByText(/Bot tersambung/).textContent).toContain('Notifikasi aktif'));
  const activation=api.fetcher.mock.calls.map(call=>call[1]?.body&&JSON.parse(String(call[1].body))).find(body=>body?.action==='enable');
  expect(activation).toEqual({action:'enable',botNumber:NEXT,botRevision:REV});
 });
 it('refreshes authoritative identity after an ambiguous save and keeps notifications paused',async()=>{
  mockApi(true);render(<WhatsAppNotifications/>);
  await screen.findByText('Ganti nomor bot');await waitFor(()=>expect((screen.getByText('Ganti nomor bot') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Ganti nomor bot'));const input=screen.getByLabelText('Nomor WhatsApp bot baru');
  fireEvent.change(input,{target:{value:NEXT}});fireEvent.submit(input.closest('form')!);
  await screen.findByRole('alert');expect(screen.getByText(new RegExp('Bot '+NEXT))).toBeTruthy();
  expect(screen.getByText(/Bot belum tersambung/).textContent).toContain('Notifikasi belum aktif');
 });
 it('clears a pairing code when another admin changes the selected session',async()=>{
  const api=mockApi();api.disconnect();render(<WhatsAppNotifications/>);
  await waitFor(()=>expect((screen.getByText('Hubungkan nomor bot') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Hubungkan nomor bot'));await screen.findByText('1234-5678');
  api.replaceElsewhere();fireEvent.click(screen.getByText('Cek koneksi'));
  await waitFor(()=>expect(screen.queryByText('1234-5678')).toBeNull());
  expect(screen.getByText(new RegExp('Bot '+NEXT))).toBeTruthy();
  expect(screen.getByText(/Bot belum tersambung/).textContent).toContain('Notifikasi belum aktif');
 });
 it('hides old identity and pairing codes when gateway status is unavailable',async()=>{
  const api=mockApi();api.disconnect();render(<WhatsAppNotifications/>);
  await waitFor(()=>expect((screen.getByText('Hubungkan nomor bot') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Hubungkan nomor bot'));await screen.findByText('1234-5678');
  api.fetcher.mockResolvedValueOnce({ok:true,json:async()=>({config:{enabled:true,botNumber:FIRST},gateway:null,error:'Gateway belum tersedia.'})} as any);
  fireEvent.click(screen.getByText('Cek koneksi'));
  await screen.findByRole('alert');expect(screen.queryByText('1234-5678')).toBeNull();
  expect(screen.getByText(/Bot belum tersedia/)).toBeTruthy();
  expect((screen.getByText('Ganti nomor bot') as HTMLButtonElement).disabled).toBe(true);
 });
});
