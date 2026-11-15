import {afterEach,describe,expect,it,vi} from "vitest";
import {parseAivaultProduct,parseAivaultProducts,parseAivaultQuote,parseAivaultBalance,fetchAivaultProducts,isAivaultConfigured} from "@/lib/aivault/client";
import {aivaultFamily,aivaultSellPrice,aivaultSlugHash} from "@/lib/aivault/families";
import {aivaultEligibility,withoutPrivateBuyerData} from "@/lib/buyer-fields";
const product={service_id:"service_udemy_1m",name:"Udemy",stock:22,custom_pricing:false,pricing_tiers:[{min:1,max:4,price:0.8},{min:5,max:9,price:0.75},{min:10,max:null,price:0.7}]};
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("AIVault pure contracts",()=>{
  it("takes quantity-one tier for catalog pricing",()=>{expect(parseAivaultProduct(product)).toMatchObject({unit_price_usd:0.8});expect(aivaultSellPrice(0.5,18086)).toBe(12300);});
  it.each([{stock:-1},{stock:1.5},{custom_pricing:"false"},{service_id:"../key"},{pricing_tiers:[{min:5,max:null,price:1}]},{pricing_tiers:[{min:1,max:5,price:1},{min:5,max:10,price:2}]}])("rejects malformed product %j",over=>{expect(parseAivaultProduct({...product,...over})).toBeNull();});
  it("rejects duplicate IDs and wrong currency",()=>{expect(parseAivaultProducts({currency:"USD",products:[product,product]})).toBeNull();expect(parseAivaultProducts({currency:"INR",products:[product]})).toBeNull();});
  it("parses balance and actual quote without a custom_pricing flag",()=>{
    expect(parseAivaultBalance({balance:"2.5",currency:"USD"})).toEqual({balance:2.5,currency:"USD"});
    const q={service_id:product.service_id,quantity:1,currency:"USD",stock:2,sufficient_balance:true,pricing:{unit_price:0.8,final_total:0.8},stock_warning:null};
    expect(parseAivaultQuote(q)).toMatchObject({price_conflict:false,final_total:0.8});expect(parseAivaultQuote({...q,requires_accept_normal_price:true})).toMatchObject({price_conflict:true});
    expect(parseAivaultQuote({...q,custom_pricing:true})).toMatchObject({price_conflict:true});expect(parseAivaultQuote({...q,pricing:{final_total:0}})).toBeNull();
  });
  it("accepts the live Gemini quote custom_pricing:null without a price conflict",()=>{
    const quote={service_id:"service_gemini_plus_6m",service_name:"Gemini Plus 6 Months",quantity:1,stock:2952,stock_warning:null,custom_pricing:null,currency:"USD",pricing:{unit_price:0.5,slab_range:"1-10000",base_total:0.5,bulk_discount_pct:0,bulk_discount_amount:0,final_total:0.5,price_source:"normal"},your_balance:2.5,sufficient_balance:true};
    expect(parseAivaultQuote(quote)).toMatchObject({service_id:quote.service_id,quantity:1,price_conflict:false,unit_price:0.5,final_total:0.5});
  });
  it("maps explicit families and collision-safe one-to-one fallbacks",()=>{
    expect(aivaultFamily("service_1789191781","ignored")).toMatchObject({key:"adobe-express",label:"12 Bulan"});
    expect(aivaultFamily("service_adobe_express_6m","ignored")).toMatchObject({key:"adobe-express",label:"6 Bulan"});
    expect(aivaultFamily("a","Same").slug).not.toBe(aivaultFamily("b","Same").slug);
  });
  it("maps ChatGPT Plus Apple Pay explicitly and shortens fallback slugs",()=>{
    expect(aivaultFamily("service_chatgpt_plus_1m","ignored")).toMatchObject({
      key:"chatgpt-plus",name:"ChatGPT Plus",slug:"chatgpt-plus-av",label:"Plus 1 Bulan (Apple Pay)",
      images:["chatgpt-plus-1-bulan","chatgpt-tunvn","chatgpt-sk","chatgpt-premium"],
    });
    const fallback=aivaultFamily("service_chatgpt_plus_1m_unmapped","ChatGPT Plus 1 Month (Apple Pay)");
    expect(fallback.key).toBe("service:service_chatgpt_plus_1m_unmapped");
    expect(fallback.slug).toMatch(/-[0-9a-f]{8}-av$/);
    expect(fallback.slug.length).toBeLessThanOrEqual(80);
    expect(fallback.slug).toBe(aivaultFamily("service_chatgpt_plus_1m_unmapped","ChatGPT Plus 1 Month (Apple Pay)").slug);
    expect(fallback.slug).not.toContain("73657276696365");
    expect(aivaultSlugHash("service_x")).toMatch(/^[0-9a-f]{8}$/);
    expect(aivaultSlugHash("service_x")).not.toBe(aivaultSlugHash("service_y"));
  });
  it("stamps eligible server identities and strips all private markers",()=>{
    const row={id:3,sku:"AV-service_udemy_1m",aivault_service_id:"service_udemy_1m",aivault_family:"udemy",aivault_source_cost_usd:0.8};
    expect(aivaultEligibility(row,2)).toEqual({version:1,service_id:"service_udemy_1m",source_variant_id:3,quantity:2,cost_usd:1.6});
    expect(aivaultEligibility({...row,sku:"TUNVN-86"},1)).toBeUndefined();expect(aivaultEligibility({...row,aivault_family:null},1)).toBeUndefined();
    expect(withoutPrivateBuyerData([{name:"x",aivault_eligibility:{},tunvn_eligibility:{},buyer_fields:{}}])).toEqual([{name:"x"}]);
  });
  it("never fetches without full HTTPS configuration",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);vi.stubEnv("AIVAULT_ENABLED","false");expect(await fetchAivaultProducts()).toMatchObject({kind:"config"});
    vi.stubEnv("AIVAULT_ENABLED","true");vi.stubEnv("AIVAULT_API_KEY","fixture");vi.stubEnv("AIVAULT_BASE_URL","http://supplier.test");expect(isAivaultConfigured()).toBe(false);await fetchAivaultProducts();expect(fetcher).not.toHaveBeenCalled();
  });
});
