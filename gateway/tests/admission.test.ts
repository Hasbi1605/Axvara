import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

test("status bypasses held outbound sends; legacy pacing and pinned-session ledger stay intact", async t => {
  const phone = "6283181632507", nextPhone = "628111111111", groupId = "120363412672344593@g.us";
  let identity = {botNumber:phone,botRevision:"initial"};
  const sockets: { open: () => void; sent: number; hold: boolean }[] = [];
  const settled: unknown[][] = [];
  let finish: (() => void) | undefined;
  const fixture = {
    get BOT_NUMBER() { return identity.botNumber; },
    botIdentity: () => identity,
    matchesBotIdentity: (input: typeof identity) => input.botNumber === identity.botNumber && input.botRevision === identity.botRevision,
    validBotNumber: () => true,
    persistBotNumber: async (number: string) => { identity = {botNumber:number,botRevision:"new-revision"}; },
    pool: {query: async (sql: string) => ({rows:sql.includes("SELECT group_id") ? [{group_id:groupId}] : [{}]})},
    deliveryClaim: async () => ({claimed:true}), settleDelivery: async (...args: unknown[]) => { settled.push(args); },
    pauseOutbound: async () => {}, isRestriction: () => false, groupAllowsBotSend: () => true,
    usePostgresAuthState: async () => ({state:{},saveCreds:async () => {}}),
    registerPromoBot: () => ({onMainBotNumberChanged:() => {},stop:async () => {}}),
    Browsers: {macOS:() => []},
    socket: () => {
      const listeners = new Map<string, (event: unknown) => void>();
      const mock = {sent:0,hold:false,open:() => listeners.get("connection.update")?.({connection:"open"})};
      sockets.push(mock);
      return {
        user:{id:identity.botNumber+":1@s.whatsapp.net"}, end:async () => {},
        ev:{on:(name:string, fn:(event:unknown) => void) => listeners.set(name,fn),removeAllListeners:(name:string) => listeners.delete(name)},
        groupMetadata: async () => ({id:groupId,subject:"AXVARA'S"}),
        sendMessage: () => {
          mock.sent++;
          if (!mock.hold) return Promise.resolve({key:{id:"legacy"}});
          mock.hold = false;
          return new Promise(resolve => { finish = () => resolve({key:{id:"held"}}); });
        },
      };
    },
  };
  const fixtureSymbol = Symbol.for("axvara.admission.fixture");
  Object.defineProperty(globalThis,fixtureSymbol,{value:fixture,configurable:true});
  const sources: Record<string, string> = {
    "./durable.js": `export let BOT_NUMBER=s.BOT_NUMBER; export async function persistBotNumber(...args){await s.persistBotNumber(...args);BOT_NUMBER=s.BOT_NUMBER;}
      export const {botIdentity,matchesBotIdentity,validBotNumber,pool,deliveryClaim,settleDelivery,pauseOutbound,isRestriction,groupAllowsBotSend}=s;
      export const reloadBotIdentity=()=>{},initializeDurable=()=>{},requiresManualReconnect=()=>{},releaseUnsentDelivery=()=>{},fingerprint=()=>{};`,
    "./pg-auth.js": "export const {usePostgresAuthState}=s;",
    "./promo-bot.js": "export const {registerPromoBot}=s;",
    "@whiskeysockets/baileys": "export default s.socket; export const {Browsers}=s; export const proto={},downloadMediaMessage=()=>{},normalizeMessageContent=()=>{};",
  };
  const stubs = new Map<string,string>();
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.includes("/gateway/src/") && sources[specifier]) {
        const url = "mock:fx7-admission:"+specifier;
        stubs.set(url,sources[specifier]);
        return {url,shortCircuit:true};
      }
      return next(specifier,context);
    },
    load(url, context, next) {
      if (stubs.has(url)) return {format:"module",source:`const s=globalThis[Symbol.for("axvara.admission.fixture")];\n${stubs.get(url)}`,shortCircuit:true};
      return next(url,context);
    },
  });
  const oldToken = process.env.AXVARA_WEBHOOK_TOKEN, oldTarget = process.env.TARGET_GROUP_ID;
  process.env.AXVARA_WEBHOOK_TOKEN = "fixture";
  process.env.TARGET_GROUP_ID = groupId;
  t.after(() => {
    hooks.deregister(); Reflect.deleteProperty(globalThis,fixtureSymbol);
    if (oldToken === undefined) delete process.env.AXVARA_WEBHOOK_TOKEN; else process.env.AXVARA_WEBHOOK_TOKEN = oldToken;
    if (oldTarget === undefined) delete process.env.TARGET_GROUP_ID; else process.env.TARGET_GROUP_ID = oldTarget;
  });
  t.mock.timers.enable({apis:["Date","setTimeout"],now:Date.now()});
  t.mock.method(Math,"random",() => 0);
  const {app,startWhatsApp} = await import("../src/index.js");
  const http = (method:"GET"|"POST", url:string, payload?:Record<string,unknown>) => app.inject({method,url,payload,headers:{"x-gateway-token":"fixture"}});
  const drain = async () => { for (let i=0;i<5;i++) await new Promise<void>(resolve => setImmediate(resolve)); };
  const legacy = {target:groupId,message:"fixture"};
  try {
    await startWhatsApp();
    const [old] = sockets; old.open(); old.hold = true;
    const first = http("POST","/send",legacy);
    await drain();
    assert.equal(old.sent,1);
    const second = http("POST","/send",legacy);
    let status: number | undefined;
    void http("GET","/notification-status").then(response => { status = response.statusCode; });
    await drain();
    assert.equal(status,200,"status must return before the held send resolves");
    finish!();
    assert.equal((await first).statusCode,200);
    t.mock.timers.tick(3999); await drain();
    assert.equal(old.sent,1);
    t.mock.timers.tick(1);
    assert.equal((await second).statusCode,200);
    assert.equal(old.sent,2);

    old.hold = true;
    const key = "wa:welcome:"+"a".repeat(64);
    const group = http("POST","/send-welcome",{...legacy,...identity,idempotencyKey:key});
    await drain();
    assert.equal(old.sent,3);
    const stale = http("POST","/send",legacy);
    await drain();
    assert.equal((await http("POST","/notification-number",{...identity,newBotNumber:nextPhone})).statusCode,200);
    const next = sockets[1]; next.open(); finish!();
    assert.equal((await group).statusCode,200);
    t.mock.timers.tick(4000);
    assert.equal((await stale).statusCode,409);
    assert.equal(next.sent,0);
    assert.ok(settled.some(args => args[0] === key && args[1] === "held" && args[2] === phone));
  } finally {
    finish?.(); await drain(); t.mock.timers.tick(30_000); await app.close();
  }
});
