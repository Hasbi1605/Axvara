import assert from "node:assert/strict";
import { test } from "node:test";
import { botIdentity, pool } from "../src/durable.js";
import { queueWelcome, drainWelcomes } from "../src/welcome-inbox.js";

test("durable welcome handoff retries Pages or lost ACK without changing identity or event time", async t => {
  t.mock.timers.enable({apis:["Date"],now:Date.parse("2026-11-21T23:59:59Z")});
  type Event = Parameters<typeof queueWelcome>[0];
  const pending = new Map<string,{key:string;payload:Event;attempts:number}>();
  t.mock.method(pool,"query",async (sql:string,values:unknown[] = []) => {
    const key = String(values[0]);
    if (sql.startsWith("INSERT")) {
      if (!pending.has(key)) pending.set(key,{key,payload:JSON.parse(String(values[1])),attempts:0});
    } else if (sql.startsWith("SELECT")) return {rows:[...pending.values()]};
    else if (sql.startsWith("UPDATE")) pending.get(key)!.attempts++;
    else if (sql.includes("WHERE key=$1")) pending.delete(key);
    return {rows:[]};
  });
  const join: Event = {event:"member_join",groupId:"123@g.us",...botIdentity(),observedAt:Date.now(),members:[{id:"123@lid",name:"Fixture"}]};
  await queueWelcome(join);
  await queueWelcome({...join,members:[{id:"123:2@lid",name:"Changed display name"}]});
  assert.equal(pending.size,1);
  const seen: unknown[] = [];
  const warn = () => assert.fail("transient delivery must not exhaust the handoff");
  const endpoint = new URL("https://fixture.test/api/whatsapp/group-events");
  const mockFetch: typeof fetch = async (_url,init) => {
    seen.push([JSON.parse(String(init?.body)),new Headers(init?.headers).get("x-wa-join-observed-at")]);
    if (seen.length === 1) return new Response(null,{status:503});
    if (seen.length === 2) throw new Error("lost ACK");
    return Response.json({ok:true,status:"queued"},{status:202});
  };
  await drainWelcomes(endpoint,"fixture",warn,mockFetch);
  assert.equal([...pending.values()][0].attempts,1);
  t.mock.timers.setTime(Date.now()+10_000);
  await drainWelcomes(endpoint,"fixture",warn,mockFetch);
  assert.equal([...pending.values()][0].attempts,2);
  await drainWelcomes(endpoint,"fixture",warn,mockFetch);
  assert.equal(pending.size,0);
  assert.equal(seen.length,3);
  assert.deepEqual(seen[0],seen[1]); assert.deepEqual(seen[0],seen[2]);
});
