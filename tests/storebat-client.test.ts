import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchStorebatProducts, parseStorebatBalance, parseStorebatProducts, STOREBAT_DEFAULT_BASE_URL } from "@/lib/storebat/client";
import { storebatFamily } from "@/lib/storebat/families";
import { product } from "./helpers/storebat-fixture";
beforeEach(()=>{vi.stubEnv("STOREBAT_API_KEY","test-key-only");vi.stubEnv("STOREBAT_BASE_URL","https://storebat.test/api/reseller");vi.stubGlobal("fetch",vi.fn());});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it.each(["http://storebat.test","https://user:pass@storebat.test","https://storebat.test/?key=bad",""])("does not fetch with invalid base %s",async url=>{
  vi.stubEnv("STOREBAT_BASE_URL",url);expect(await fetchStorebatProducts()).toEqual({kind:"config"});expect(fetch).not.toHaveBeenCalled();
});
it("manual redirect, reseller header, and conditional 304",async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{status:304})).mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:"https://redirect.test"}}));
  expect(await fetchStorebatProducts('"sb"')).toEqual({kind:"not_modified"});
  expect(await fetchStorebatProducts()).toMatchObject({kind:"http_error",status:302});
  expect(fetch).toHaveBeenNthCalledWith(1,"https://storebat.test/api/reseller/products",expect.objectContaining({redirect:"manual",headers:expect.objectContaining({"X-Reseller-Key":"test-key-only","If-None-Match":'"sb"'})}));
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("validates duplicate IDs and excludes test products while preserving tiers",()=>{
  expect(parseStorebatProducts({success:true,products:[product(),product()]})).toBeNull();
  expect(parseStorebatProducts({success:true,products:[product(129),product()]})).toMatchObject([{excluded:true},{excluded:false,price_tiers:product().price_tiers}]);
  expect(parseStorebatBalance({success:true,wallet_balance:"4.00"})).toEqual({balance:4,currency:"USD"});
  expect(parseStorebatBalance({success:true,wallet_balance:false})).toBeNull();
  expect(storebatFamily(62,"test").key).toBe(storebatFamily(90,"test").key);
  expect(storebatFamily(123456,"same").slug).not.toBe(storebatFamily(123457,"same").slug);
  expect(storebatFamily(119,"ElevenReader")).toMatchObject({ key:"elevenreader", images:[], imageUrl:"/r2/products/90ceeb28e24ad380d45344dcd0ac71ac.webp" });
  expect(STOREBAT_DEFAULT_BASE_URL).toBe("https://batman.sarl/api/reseller");
});
