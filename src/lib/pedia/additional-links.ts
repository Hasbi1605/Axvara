import type { PediaLinkDetect, PediaPlatform, PediaTargetKind } from "./link";

/** Exact hosts and explicit public routes only. No network request or redirect expansion. */
export function detectAdditionalPediaLink(host: string, path: string): PediaLinkDetect | null {
  const seg = path.split("/").filter(Boolean);
  const user = /^[a-z\d][a-z\d_.-]{0,79}$/i;
  const reserved = new Set(["login","signup","settings","search","discover","upload","privacy","terms","help","about","downloads","directory","browse","home","feed","users"]);
  const profile = (s: string | undefined) => !!s && user.test(s) && !reserved.has(s.toLowerCase());
  const out = (platform: PediaPlatform, targetKind: PediaTargetKind, normalized: string): PediaLinkDetect => ({platform,targetKind,normalized,displayUser:null});
  if (host === "roblox.com" && seg.length === 3 && seg[0] === "users" && /^[1-9]\d*$/.test(seg[1]) && seg[2] === "profile") return out("roblox","profile",`https://www.roblox.com/users/${seg[1]}/profile`);
  if (host === "whatsapp.com" && seg[0] === "channel" && /^[a-z\d]{10,100}$/i.test(seg[1] ?? "") && (seg.length === 2 || seg.length === 3 && /^\d+$/.test(seg[2]))) return out("whatsapp",seg.length === 2 ? "channel" : "post",`https://www.whatsapp.com/${seg.join("/")}`);
  if (host === "lazada.co.id") {
    if (seg.length === 2 && seg[0] === "shop" && profile(seg[1])) return out("lazada","shop",`https://www.lazada.co.id/shop/${seg[1].toLowerCase()}/`);
    if (seg.length === 2 && seg[0] === "products" && /-i\d+(?:-s\d+)?\.html$/.test(seg[1])) return out("lazada","post",`https://www.lazada.co.id/products/${seg[1]}`);
  }
  if (host === "sck.io" && seg.length === 3 && seg[0] === "u" && /^@[a-z\d_.-]+$/i.test(seg[1]) && /^[a-z\d_-]+$/i.test(seg[2])) return out("snackvideo","profile",`https://sck.io/${seg.join("/")}`);
  if (host === "snackvideo.com" && seg.length === 1 && /^@[a-z\d_.-]+$/i.test(seg[0])) return out("snackvideo","profile",`https://www.snackvideo.com/${seg[0]}`);
  if (host === "kick.com" && seg.length === 1 && profile(seg[0])) return out("kick","profile",`https://kick.com/${seg[0].toLowerCase()}`);
  if (host === "vimeo.com") {
    if (seg.length === 1 && /^\d+$/.test(seg[0])) return out("vimeo","video",`https://vimeo.com/${seg[0]}`);
    if (seg.length === 1 && profile(seg[0])) return out("vimeo","profile",`https://vimeo.com/${seg[0]}`);
    if (seg.length === 2 && seg[0] === "channels" && profile(seg[1])) return out("vimeo","channel",`https://vimeo.com/channels/${seg[1]}`);
  }
  if (/^[a-z\d][a-z\d-]*\.tumblr\.com$/i.test(host) && !["www.tumblr.com","assets.tumblr.com","media.tumblr.com","static.tumblr.com"].includes(host) && seg.length === 0) return out("tumblr","profile",`https://${host}`);
  if (host === "tumblr.com" && seg.length === 1 && profile(seg[0])) return out("tumblr","profile",`https://${seg[0].toLowerCase()}.tumblr.com`);
  if (host === "reddit.com") {
    if (seg.length === 2 && ["user","u"].includes(seg[0]) && profile(seg[1])) return out("reddit","profile",`https://www.reddit.com/user/${seg[1]}/`);
    if (seg.length === 2 && seg[0] === "r" && profile(seg[1])) return out("reddit","channel",`https://www.reddit.com/r/${seg[1]}/`);
    if (seg.length >= 4 && seg.length <= 5 && seg[0] === "r" && profile(seg[1]) && seg[2] === "comments" && /^[a-z\d]+$/i.test(seg[3])) return out("reddit","post",`https://www.reddit.com/r/${seg[1]}/comments/${seg[3]}/`);
  }
  if (host === "dribbble.com") {
    if (seg.length === 1 && profile(seg[0])) return out("dribbble","profile",`https://dribbble.com/${seg[0]}`);
    if (seg.length === 2 && seg[0] === "shots" && /^\d+(?:-[a-z\d_-]+)?$/i.test(seg[1])) return out("dribbble","post",`https://dribbble.com/shots/${seg[1]}`);
  }
  if (host === "mixcloud.com" && profile(seg[0]) && seg.length <= 2 && (!seg[1] || /^[a-z\d_-]+$/i.test(seg[1]))) return out("mixcloud",seg.length === 1 ? "profile" : "track",`https://www.mixcloud.com/${seg.join("/")}/`);
  if (host === "audiomack.com" && profile(seg[0])) {
    if (seg.length === 1) return out("audiomack","profile",`https://audiomack.com/${seg[0]}`);
    if (seg.length === 3 && ["song","album"].includes(seg[1]) && /^[a-z\d_-]+$/i.test(seg[2])) return out("audiomack",seg[1] === "song" ? "track" : "album",`https://audiomack.com/${seg.join("/")}`);
  }
  if (host === "medium.com") {
    if (seg.length === 1 && /^@[a-z\d_.-]+$/i.test(seg[0])) return out("medium","profile",`https://medium.com/${seg[0]}`);
    if (seg.length === 2 && (/^@[a-z\d_.-]+$/i.test(seg[0]) || seg[0] === "p") && /^[a-z\d-]+$/i.test(seg[1])) return out("medium","post",`https://medium.com/${seg.join("/")}`);
  }
  if (host === "rumble.com" && seg.length === 1 && /^v[a-z\d]+-[a-z\d_-]+\.html$/i.test(seg[0])) return out("rumble","video",`https://rumble.com/${seg[0]}`);
  if (host === "coinmarketcap.com" && seg.length === 3 && seg[0] === "community") {
    if (seg[1] === "profile" && profile(seg[2])) return out("coinmarketcap","profile",`https://coinmarketcap.com/community/profile/${seg[2]}/`);
    if (seg[1] === "post" && /^\d+$/.test(seg[2])) return out("coinmarketcap","post",`https://coinmarketcap.com/community/post/${seg[2]}/`);
  }
  if (host === "rutube.ru" && seg.length === 2 && seg[0] === "video" && /^[a-f\d]{32}$/i.test(seg[1])) return out("rutube","video",`https://rutube.ru/video/${seg[1]}/`);
  if (host === "tidal.com") {
    const s = seg[0] === "browse" ? seg.slice(1) : seg;
    if (s.length === 2 && s[0] === "playlist" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s[1])) return out("tidal","playlist",`https://tidal.com/browse/playlist/${s[1]}`);
  }
  if (host === "coub.com") {
    if (seg.length === 2 && seg[0] === "view" && /^[a-z\d]+$/i.test(seg[1])) return out("coub","video",`https://coub.com/view/${seg[1]}`);
    if (seg.length === 1 && profile(seg[0])) return out("coub","profile",`https://coub.com/${seg[0]}`);
  }
  if (host === "reverbnation.com" && profile(seg[0])) {
    if (seg.length === 1) return out("reverbnation","profile",`https://www.reverbnation.com/${seg[0]}`);
    if (seg.length === 3 && seg[1] === "song" && /^\d+(?:-[a-z\d_-]+)?$/i.test(seg[2])) return out("reverbnation","track",`https://www.reverbnation.com/${seg.join("/")}`);
  }
  return null;
}
