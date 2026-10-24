import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { usePostgresAuthState } from '../src/pg-auth.js';

test('auth writes and revoked-session cleanup stay within the captured phone prefix',async()=>{
 const originalQuery=pg.Pool.prototype.query, originalConnect=pg.Pool.prototype.connect;
 const storage=new Map<string,string>([['legacy:keep','{}']]);
 const query=async(sql:string,args:any[]=[])=>{
  if(sql.includes('SELECT value'))return {rows:storage.has(args[0])?[{value:storage.get(args[0])}]:[]};
  if(sql.includes('INSERT INTO baileys_auth_keys'))storage.set(args[0],args[1]);
  if(sql.includes('key_id LIKE')){for(const key of storage.keys())if(key.startsWith(args[0].slice(0,-1)))storage.delete(key);}
  else if(sql.includes('DELETE FROM'))storage.delete(args[0]);
  if(sql.includes('SELECT key_id'))return {rows:args[0].filter((id:string)=>storage.has(id)).map((id:string)=>({key_id:id,value:storage.get(id)}))};
  return {rows:[]};
 };
 pg.Pool.prototype.query=query as any;
 pg.Pool.prototype.connect=(async()=>({query,release:()=>{}})) as any;
 const oldEnv=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://fixture';
 try{
  await assert.rejects(usePostgresAuthState('bad'),/Invalid auth phone/);
  const first=await usePostgresAuthState('6283181632507');
  const second=await usePostgresAuthState('628123456789');
  await first.saveCreds();await second.saveCreds();
  await first.state.keys.set({'session':{'fixture':Buffer.from('first')}});
  await second.state.keys.set({'session':{'fixture':Buffer.from('second')}});
  assert.equal((await first.state.keys.get('session',['fixture'])).fixture.toString(),'first');
  assert.equal((await second.state.keys.get('session',['fixture'])).fixture.toString(),'second');
  await second.clearAuth();
  assert.equal(storage.has('628123456789:creds.json'),false);
  assert.equal(storage.has('628123456789:session-fixture.json'),false);
  assert.equal(storage.has('6283181632507:creds.json'),true);
  assert.equal(storage.has('legacy:keep'),true);
  // A delayed credential write from the former socket still belongs to that phone.
  await first.saveCreds();assert.equal(storage.has('628123456789:creds.json'),false);
 }finally{
  pg.Pool.prototype.query=originalQuery;pg.Pool.prototype.connect=originalConnect;
  if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;
 }
});
