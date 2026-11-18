import { vi } from "vitest";

export const product = (id = 121, stock = 5) => ({ id,name:"Fixture",description:"Upstream",stock,delivery_type:"supplier_api",warranty_days:0,price_usd:0.5,pricing_type:"standard",price_tiers:[{min_qty:1,max_qty:20,price_usd:0.4}],api_test:false });
export const buff = { service:"muse_buff",product_id:124,name:"Fixture Buff",unit:"billion_tokens",price_per_billion:"0.098",min_quantity:1,max_quantity:30,requires_invite_code:true };
export function stubStorebatEnv() {
  vi.stubEnv("STOREBAT_API_KEY","test-key-only");vi.stubEnv("STOREBAT_BASE_URL","https://storebat.test/api/reseller");vi.stubEnv("STOREBAT_ENABLED","true");vi.stubEnv("STOREBAT_SYNC_ENABLED","true");
}
