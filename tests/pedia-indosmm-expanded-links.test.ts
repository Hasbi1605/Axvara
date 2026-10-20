import fs from "node:fs";
import {describe,expect,it} from "vitest";
import {detectPediaLink,pediaTargetMatches} from "@/lib/pedia/link";
import {PEDIA_ADDITIONAL_PLATFORMS,PEDIA_ADDITIONAL_EXAMPLES} from "@/lib/pedia/additional-platforms";
import release from "@/lib/pedia/curation-20261020.json";
import {pediaTargetExample} from "@/lib/pedia/platforms";

describe("IndoSMM expansion target contracts",()=>{
 it.each(PEDIA_ADDITIONAL_PLATFORMS)("recognizes every documented $id target and has a local icon",platform=>{
  for(const [kind,url] of Object.entries(PEDIA_ADDITIONAL_EXAMPLES[platform.id])){
   const found=detectPediaLink(url,platform.id);
   expect(found,`${platform.id}:${kind}`).toMatchObject({platform:platform.id,targetKind:kind});
   expect(found&&detectPediaLink(found.normalized,platform.id)).toEqual(found);
  }
  expect(fs.readFileSync(`public/icons/platforms/${platform.id}.svg`,"utf8")).toContain("<svg");
 });
 it.each([...release.products,...release.replacements])("validates the actual $slug order example without confusing kinds",p=>{
  const detected=detectPediaLink(pediaTargetExample(p.platform,p.target_kind),p.platform);
  expect(detected?.platform,p.slug).toBe(p.platform);
  expect(detected&&pediaTargetMatches(p.target_kind,detected.targetKind),p.slug).toBe(true);
 });
 it.each([
  "https://roblox.com.evil.test/users/123/profile","https://whatsapp.com.evil.test/channel/0029VaExampleChannel",
  "https://kick.com/login","https://vimeo.com/settings","https://medium.com/login","https://reddit.com/r/test/comments",
  "https://lazada.co.id/shop/test/extra","https://roblox.com/users/not-a-number/profile","https://coinmarketcap.com/currencies/bitcoin/",
  "https://tidal.com/browse/playlist/invalid","https://rutube.ru/video/not-a-video/","https://sck.io/other/path",
  "https://audiomack.com/user/song/title/extra","https://dribbble.com/shots/not-a-number","https://mixcloud.com/discover/",
  "https://redd.it/abc123", "https://facebook.com/people/name/no-id", "https://facebook.com/people/name/123/extra",
  "https://example.com/username","https://user:password@kick.com/username","ftp://vimeo.com/12345678"
 ])("rejects unsupported or misleading URL %s",url=>expect(detectPediaLink(url)).toBeNull());
 it("distinguishes Story, product, group and Threads share links from profile targets",()=>{
  expect(detectPediaLink("https://instagram.com/stories/username/12345/?igsh=x")?.targetKind).toBe("story");
  expect(detectPediaLink("https://shopee.co.id/Produk-i.123.456?xptdk=x")?.targetKind).toBe("post");
  expect(detectPediaLink("https://shopee.co.id/product/123/456")?.targetKind).toBe("post");
  expect(detectPediaLink("https://facebook.com/groups/123456/")?.targetKind).toBe("group");
  expect(detectPediaLink("https://threads.com/share/BBWnHNpxxxx/")).toMatchObject({platform:"threads",targetKind:"post"});
  expect(pediaTargetMatches("profile","story")).toBe(false);
  expect(pediaTargetMatches("shop","post")).toBe(false);
  expect(pediaTargetMatches("track","album")).toBe(false);
 });
});

it("preserves the Facebook people Page identity instead of dropping the numeric ID",()=>{
 expect(detectPediaLink("https://www.facebook.com/people/Nama-Halaman/123456789/?mibextid=abc")).toMatchObject({platform:"facebook",targetKind:"profile",normalized:"https://www.facebook.com/people/Nama-Halaman/123456789/"});
 expect(detectPediaLink("https://facebook.com/people/")).toBeNull();
});
it("requires Facebook feed posts for Share without rejecting Reel links for ordinary post services",()=>{
 const context={platform:"facebook",metric:"shares"};
 for(const url of ['https://facebook.com/reel/123456','https://facebook.com/username/videos/123456/','https://fb.watch/abc123/']){
  const found=detectPediaLink(url)!;expect(pediaTargetMatches('post',found.targetKind,context)).toBe(false);
 }
 expect(pediaTargetMatches('post',detectPediaLink('https://facebook.com/username/posts/123456/')!.targetKind,context)).toBe(true);
 expect(pediaTargetMatches('post','reel',{platform:'instagram',metric:'likes'})).toBe(true);
});
