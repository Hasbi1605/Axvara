import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, BOT_NUMBER, botIdentity, matchesBotIdentity, persistBotNumber, initializeDurable, reloadBotIdentity, groupAllowsBotSend } from '../src/durable.js';

const FIRST='6283181632507', SECOND='628123456789';
test('manual replacement preserves the group/delivery history, inherits cooldown, rejects stale revisions and survives restart',async()=>{
 const originalConnect=pool.connect.bind(pool),originalQuery=pool.query.bind(pool);
 const queries:{sql:string,args:any[]}[]=[];
 let runtime={phone:FIRST,revision:'initial'};let failCommit=false;
 const client={on:()=>{},release:()=>{},query:async(sql:string,args:any[]=[])=>{
  queries.push({sql,args});
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};
  if(sql.startsWith('SELECT phone,revision'))return {rows:[{...runtime}]};
  if(sql.startsWith('UPDATE axvara_wa_runtime SET phone='))runtime={phone:args[0],revision:args[1]};
  if(sql==='COMMIT'&&failCommit)throw new Error('connection lost after commit');
  return {rows:[]};
 }};
 pool.connect=(async()=>client) as any;pool.query=client.query as any;
 const oldEnv=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://fixture';
 try{
  await assert.rejects(persistBotNumber('bad',botIdentity()),/invalid_bot_number/);
  assert.equal(queries.length,0);
  const initial=botIdentity();
  const changed=await persistBotNumber(SECOND,initial);
  assert.equal(changed.botNumber,SECOND);assert.notEqual(changed.botRevision,initial.botRevision);
  assert.equal(matchesBotIdentity(initial),false);assert.equal(matchesBotIdentity({}),false);
  assert.equal(groupAllowsBotSend({announce:true,participants:[{id:SECOND+'@s.whatsapp.net',admin:'admin'}]}),true);
  assert.equal(groupAllowsBotSend({announce:true,participants:[{id:FIRST+'@s.whatsapp.net',admin:'admin'}]}),false);
  assert.ok(queries.some(q=>q.sql.includes('GREATEST(axvara_wa_control.paused_until')));
  assert.ok(queries.some(q=>q.sql.includes('GREATEST(axvara_wa_control.next_send_at')));
  assert.equal(queries.some(q=>/DELETE|TRUNCATE|SET group_id/.test(q.sql)),false);
  assert.deepEqual(await persistBotNumber(SECOND,changed),changed);
  await assert.rejects(persistBotNumber(FIRST,initial),/bot_configuration_changed/);
  assert.deepEqual(botIdentity(),changed);
  await initializeDurable(()=>{});
  assert.deepEqual(botIdentity(),changed);
  assert.ok(queries.some(q=>q.args[0]==='axvara-wa:runtime'));
  assert.ok(queries.some(q=>q.args[0]==='axvara-wa:'+FIRST));
  // Returning to the original number cannot authorize old tabs or old sends.
  const returned=await persistBotNumber(FIRST,changed);
  assert.equal(returned.botNumber,FIRST);assert.equal(matchesBotIdentity(initial),false);
  assert.equal(matchesBotIdentity({}),false);
  // An ambiguous commit does not guess; authoritative read recovers the new identity.
  failCommit=true;
  await assert.rejects(persistBotNumber(SECOND,returned),/connection lost/);
  assert.equal(BOT_NUMBER,FIRST);
  failCommit=false;await reloadBotIdentity();assert.equal(BOT_NUMBER,SECOND);
  assert.notEqual(botIdentity().botRevision,changed.botRevision);
 }finally{
  pool.connect=originalConnect;pool.query=originalQuery;
  if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;
 }
});
