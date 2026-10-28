// @vitest-environment jsdom
// PIN storage/disclosure cases are inverted after the owner removed that flow.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { OrderAccessNotice } from "@/components/storefront/OrderAccessNotice";
import { WrCredentialsPanel } from "@/components/storefront/WrCredentialsPanel";
import { formatOrderAccessCode, normalizeOrderAccessCode } from "@/lib/order-access-format";
import { ensureBuyerAccessSession, forgetBuyerAccessSession, forgetCheckoutCredentialGrant, forgetOrderContact, isValidOrderContact, orderAccessHeaders, orderCheckoutPath, readBuyerAccessSession, readCheckoutCredentialGrant, readOrderAccessCode, readOrderContact, rememberBuyerAccessSession, rememberCheckoutCredentialGrant, rememberOrderAccessCode, rememberOrderContact } from "@/lib/order-access-client";
const nav=vi.hoisted(()=>({params:new URLSearchParams()}));
vi.mock("next/navigation",()=>({useSearchParams:()=>nav.params,usePathname:()=>"/lacak-pesanan",useRouter:()=>({push:vi.fn()})}));
import Lacak from "@/app/(shop)/lacak-pesanan/lacak-pesanan-client";
const CODE="AXV-20261027-ABCD1234",PIN="0A1B2C",CONTACT="buyer@example.test",RAW="71111-22222-33333-44444-555556";
const session=()=>`p1.${Math.floor(Date.now()/1000)+86400}.${"a".repeat(43)}`;
beforeEach(()=>{forgetBuyerAccessSession(CODE);forgetCheckoutCredentialGrant(CODE);forgetOrderContact(CODE);sessionStorage.clear();localStorage.clear();nav.params=new URLSearchParams();window.history.replaceState({},"","/lacak-pesanan");vi.stubGlobal("requestAnimationFrame",()=>0)});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()});
it("keeps six-character PIN leading zeros and code26 normalization",()=>{expect(formatOrderAccessCode("0a1b2c")).toBe(PIN);expect(formatOrderAccessCode(RAW.toLowerCase())).toBe(RAW);expect(normalizeOrderAccessCode("ABC")).toBe("");expect(normalizeOrderAccessCode("U".repeat(26))).toBe("")});
it("preserves Crockford aliases without accepting invalid contacts",()=>{expect(normalizeOrderAccessCode("7O111-22222-33333-44444-55555I")).toBe("70111222223333344444555551");expect(isValidOrderContact(PIN)).toBe(false);expect(isValidOrderContact(RAW)).toBe(false);expect(isValidOrderContact(CONTACT)).toBe(true);expect(isValidOrderContact("081234567890")).toBe(true)});
it("never stores PINs through the deprecated access-code helpers",()=>{expect(rememberOrderAccessCode(CODE,PIN)).toBe(false);expect(readOrderAccessCode(CODE)).toBe("");expect(sessionStorage.length).toBe(0);expect(localStorage.length).toBe(0)});
it("purges old PIN storage and fragments on the real status contact path",()=>{sessionStorage.setItem(`axvara-order-access:${CODE}`,PIN);window.history.replaceState({},"",`/lacak-pesanan#access=${PIN}`);expect(readOrderContact(CODE)).toBe("");expect(sessionStorage.length).toBe(0);expect(location.hash).toBe("")});
it("stores only full contact and p1 status session, never a PIN header",()=>{rememberOrderContact(CODE,CONTACT);const grant=session();rememberBuyerAccessSession(CODE,grant);expect(orderAccessHeaders(CODE,PIN)).toEqual({"x-order-contact":CONTACT,"x-buyer-access-session":grant});expect(JSON.stringify(sessionStorage)).not.toContain(PIN);expect(localStorage.length).toBe(0)});
it("checkout handoff ignores old PIN arguments and has no URL fragment",()=>{const grant=session();expect(orderCheckoutPath(`/pesanan/${CODE}`,CODE,PIN,grant)).toBe(`/pesanan/${CODE}`);expect(readBuyerAccessSession(CODE)).toBe(grant);expect(JSON.stringify(sessionStorage)).not.toContain(PIN);expect(location.href).not.toContain(PIN)});
it("tab-memory fallback keeps status usable when sessionStorage writes are blocked",()=>{vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked")});const grant=session();rememberOrderContact(CODE,CONTACT);rememberBuyerAccessSession(CODE,grant);expect(readOrderContact(CODE)).toBe(CONTACT);expect(readBuyerAccessSession(CODE)).toBe(grant);expect(orderCheckoutPath(`/pesanan/${CODE}`,CODE,PIN,grant)).not.toContain("#")});
it("rejects old b1 and expired status sessions",()=>{expect(rememberBuyerAccessSession(CODE,session().replace(/^p1/,"b1"))).toBe(false);expect(rememberBuyerAccessSession(CODE,`p1.${Math.floor(Date.now()/1000)-1}.${"a".repeat(43)}`)).toBe(false);expect(readBuyerAccessSession(CODE)).toBe("")});
it("exchanges checkout contact for a read-only status session once",async()=>{const grant=session(),fetcher=vi.fn(async(_url: RequestInfo | URL,_init?: RequestInit)=>Response.json({buyer_access_session:grant}));vi.stubGlobal("fetch",fetcher);await ensureBuyerAccessSession(CODE,CONTACT);await ensureBuyerAccessSession(CODE,CONTACT);expect(fetcher).toHaveBeenCalledTimes(1);expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({code:CODE,contact:CONTACT});expect(localStorage.length).toBe(0)});
it("a PIN cannot be exchanged for a status session without contact",async()=>{const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);await expect(ensureBuyerAccessSession(CODE,PIN)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled()});
it("failed lookup does not retain a status session",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"not_found"},{status:404})));await expect(ensureBuyerAccessSession(CODE,CONTACT)).rejects.toThrow("not_found");expect(readBuyerAccessSession(CODE)).toBe("")});
it("the private admin reveal component still copies an explicitly revealed code",async()=>{const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});render(<OrderAccessNotice accessCode={RAW}/>);fireEvent.click(screen.getByRole("button",{name:"Salin kode akses"}));await screen.findByRole("button",{name:"Tersalin"});expect(writeText).toHaveBeenCalledWith(RAW)});
it("PIN-shaped history is scrubbed from recent history",async()=>{localStorage.setItem("axvara-track-recent",JSON.stringify([{code:CODE,wa:PIN,savedAt:Date.now()}]));vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"not_found"},{status:404})));render(<Lacak/>);await waitFor(()=>expect(JSON.stringify(localStorage)).not.toContain(PIN));expect(JSON.stringify(localStorage)).not.toContain(PIN)});

it("new credential unlock requires separate contact and PIN inputs without storing the typed PIN",async()=>{
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({credentials:[{details:"PRIVATE-ACCOUNT-FIXTURE",completed_at:null}],capability_token:"z".repeat(64)}));vi.stubGlobal("fetch",fetcher);
 render(<WrCredentialsPanel code={CODE} buyerPinRequired/>);
 const button=screen.getByRole("button",{name:"Tampilkan"});
 fireEvent.change(screen.getByLabelText("PIN akses"),{target:{value:PIN}});expect((button as HTMLButtonElement).disabled).toBe(true);expect(fetcher).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Email atau No. WA checkout"),{target:{value:CONTACT}});
 expect(screen.getByLabelText("PIN akses").getAttribute("type")).toBe("password");fireEvent.click(button);
 await screen.findByText("PRIVATE-ACCOUNT-FIXTURE");
 expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({contact:CONTACT,access_code:PIN});
 expect(JSON.stringify(sessionStorage)).not.toContain(PIN);expect(JSON.stringify(localStorage)).not.toContain(PIN);
});

it("the original checkout tab opens new credentials automatically without entering or storing a PIN", async () => {
 const grant=session().replace(/^p1/,"c1");
 expect(rememberCheckoutCredentialGrant(CODE,grant)).toBe(true);
 const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>Response.json({credentials:[{details:"ORIGINAL-CHECKOUT-ACCOUNT",completed_at:null}],capability_token:"k".repeat(64)}));
 vi.stubGlobal("fetch",fetcher); render(<WrCredentialsPanel code={CODE} buyerPinRequired/>);
 await screen.findByText("ORIGINAL-CHECKOUT-ACCOUNT");
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("x-checkout-credential-grant")).toBe(grant);
 expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).not.toHaveProperty("access_code");
 expect(screen.queryByLabelText("PIN akses")).toBeNull();
 expect(localStorage.length).toBe(0); expect(location.href).not.toContain(grant);
});

it("checkout proof stays per order in tab memory when sessionStorage is blocked and never enters status headers", () => {
 const grant=session().replace(/^p1/,"c1");
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked")});
 expect(rememberCheckoutCredentialGrant(CODE,session())).toBe(false);
 expect(rememberCheckoutCredentialGrant(CODE,grant)).toBe(true);
 expect(readCheckoutCredentialGrant(CODE)).toBe(grant);
 expect(readCheckoutCredentialGrant("AXV-20261027-OTHER001")).toBe("");
 expect(orderAccessHeaders(CODE)).not.toHaveProperty("x-checkout-credential-grant");
 expect(localStorage.length).toBe(0); expect(location.hash).toBe("");
});
