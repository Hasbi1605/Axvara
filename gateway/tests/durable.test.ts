import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, requiresManualReconnect, isRestriction, BOT_NUMBER, groupAllowsBotSend } from '../src/durable.js';
test('announcement groups require this bot to be an admin, including LID identities', () => {
  assert.equal(groupAllowsBotSend({participants:[]}), true);
  assert.equal(groupAllowsBotSend({announce:true,participants:[{id:BOT_NUMBER+'@s.whatsapp.net',admin:null}]}), false);
  assert.equal(groupAllowsBotSend({announce:true,participants:[{id:'someone@lid',admin:'admin'}]}, 'bot@lid'), false);
  assert.equal(groupAllowsBotSend({announce:true,participants:[{id:'bot@lid',admin:'admin'}]}, 'bot:5@lid'), true);
  assert.equal(groupAllowsBotSend({announce:true,participants:[{id:'bot@lid',phoneNumber:BOT_NUMBER,admin:'admin'}]}), true);
});
test('keys bind exact destination and payload without exposing either', () => {
  const a = fingerprint('123@g.us', 'paid');
  assert.equal(a, fingerprint('123@g.us', 'paid'));
  assert.notEqual(a, fingerprint('456@g.us', 'paid'));
  assert.notEqual(a, fingerprint('123@g.us', 'other'));
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.equal(BOT_NUMBER, '6283181632507');
});
test('transient disconnects are different from revoked/conflicting sessions', () => {
  for (const code of [401,403,440,500]) assert.equal(requiresManualReconnect(code), true);
  for (const code of [408,428,503,515]) assert.equal(requiresManualReconnect(code), false);
  assert.equal(isRestriction({output:{statusCode:463}}), true);
  assert.equal(isRestriction(new Error('Connection timed out 503')), false);
  assert.equal(isRestriction(new Error('forbidden')), true);
});

test('durable claim never resends sent, unknown, changed or paced keys', async () => {
  const {pool,deliveryClaim}=await import('../src/durable.js');
  const original=pool.connect.bind(pool);
  for(const mode of ['sent','unknown','conflict','paced','paused','fresh']) {
    const queries:string[]=[];let released=false;
    const client={
      query:async(sql:string)=>{
        queries.push(sql);
        if(sql.includes('SELECT * FROM axvara_wa_control')) return {rows:[{next_send_at:new Date(mode==='paced'?Date.now()+60000:0),paused_until:mode==='paused'?new Date(Date.now()+60000):null}]};
        if(sql.includes('SELECT * FROM axvara_wa_delivery')) return {rows: ['sent','unknown','conflict'].includes(mode)?[{status:mode==='sent'?'sent':'unknown',message_id:'WA-ID',fingerprint:mode==='conflict'?'different':fingerprint('123@g.us','hello')}]:[]};
        return {rows:[]};
      }, release:()=>{released=true;}
    };
    pool.connect=(async()=>client) as any;
    try {
      const result=await deliveryClaim('same-key','123@g.us','hello');
      assert.equal(released,true);
      assert.equal(queries[0],'BEGIN');
      assert.ok(queries.some(q=>q.includes('FOR UPDATE')));
      if(mode==='fresh') {
        assert.deepEqual(result,{claimed:true});assert.ok(queries.some(q=>q.includes('INSERT INTO axvara_wa_delivery')));assert.ok(queries.includes('COMMIT'));
      } else {
        assert.equal(queries.some(q=>q.includes('INSERT INTO')),false);
        assert.equal(queries.includes('COMMIT'),false);
        if(mode==='sent') assert.deepEqual(result,{sent:true,id:'WA-ID'});
        if(mode==='unknown') assert.deepEqual(result,{reason:'delivery_outcome_unknown',outcomeUnknown:true});
        if(mode==='conflict') assert.deepEqual(result,{reason:'idempotency_conflict'});
        if(mode==='paced') assert.deepEqual(result,{reason:'notification_paced'});
        if(mode==='paused') assert.deepEqual(result,{reason:'gateway_cooldown_active'});
      }
    } finally { pool.connect=original; }
  }
});
