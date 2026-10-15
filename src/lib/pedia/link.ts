// src/lib/pedia/link.ts — Parser link Pedia (PEDIA-PRD §9.6).
//
// SHARED client & server: deteksi platform + jenis target + normalisasi.
// TIDAK ada fetch ke platform sosial (tanpa scraping, tanpa preview gambar).
// Short link TikTok (vt/vm) DISIMPAN apa adanya — supplier menerima.

export type PediaPlatform =
  | "instagram" | "tiktok" | "youtube" | "facebook"
  | "threads" | "shopee" | "spotify" | "x" | "telegram"
  | "github" | "website" | "linkedin" | "pinterest" | "discord" | "twitch" | "soundcloud";

export type PediaTargetKind =
  | "profile" | "post" | "video" | "reel" | "live" | "channel" | "playlist"
  | "shop" | "track" | "repository" | "website" | "company" | "board" | "invite";

export type PediaLinkDetect = {
  platform: PediaPlatform;
  targetKind: PediaTargetKind;
  /** URL kanonis (untuk guard ganda + kirim supplier). */
  normalized: string;
  /** Username tampilan tersamar (mis. @ma***a) — untuk chip & ticker. */
  displayUser: string | null;
};

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, "");

function maskUser(user: string): string {
  const clean = user.replace(/^@/, "");
  if (clean.length <= 4) return `@${clean.slice(0, 2)}***`;
  return `@${clean.slice(0, 2)}***${clean.slice(-1)}`;
}

/** Samarkan target untuk ticker publik (tanpa data palsu). */
export function maskTargetForTicker(target: string): string {
  const m = target.match(/(?:@)([\w.]+)/);
  if (m) return maskUser(m[1]);
  return target.slice(0, 12) + "***";
}

/** Normalisasi input mentah: trim, tambah https bila bare, buang query umum. */
function prep(raw: string): { host: string; path: string; raw: string } | null {
  let text = String(raw || "").trim();
  if (!text) return null;
  if (/^@[\w.]{1,30}$/.test(text)) {
    return { host: "instagram.com", path: `/${text.slice(1)}`, raw: text };
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  return { host, path: url.pathname || "/", raw: text };
}

/** Deteksi link. null = tidak dikenali (UI netral, bukan merah). */
export function detectPediaLink(raw: string, expectedPlatform?: string): PediaLinkDetect | null {
  const p = prep(raw);
  if (!p) return null;
  const { host, path } = p;
  const seg = path.split("/").filter(Boolean);

  // Website traffic dipilih secara eksplisit. Query URL adalah bagian target
  // (mis. campaign); tidak disapu seperti query tracking link media sosial.
  if (expectedPlatform === "website") {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /\.(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    const url = new URL(p.raw);
    if (url.port && !["80", "443"].includes(url.port)) return null;
    url.hash = "";
    return { platform: "website", targetKind: "website", normalized: url.href, displayUser: null };
  }

  const result = (platform: PediaPlatform, targetKind: PediaTargetKind, normalized: string): PediaLinkDetect => ({ platform, targetKind, normalized, displayUser: null });
  if (host === "github.com") {
    if (!seg.length || seg.length > 2 || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(seg[0])
      || ["login", "signup", "settings", "features", "explore", "marketplace", "topics", "orgs", "users", "search"].includes(seg[0].toLowerCase())) return null;
    if (seg[1] && !/^[\w.-]+$/.test(seg[1])) return null;
    return result("github", seg[1] ? "repository" : "profile", `https://github.com/${seg.join("/")}`);
  }
  if (host === "t.me" || host === "telegram.me") {
    if (!seg[0] || !/^[a-z\d_]{4,}$/i.test(seg[0]) || ["share", "joinchat", "addstickers", "proxy", "login", "c"].includes(seg[0])) return null;
    if (seg.length > 2 || (seg[1] && !/^\d+$/.test(seg[1]))) return null;
    return result("telegram", seg[1] ? "post" : "channel", `https://t.me/${seg.join("/")}`);
  }
  if (host === "discord.gg" || host === "discord.com") {
    const code = host === "discord.gg" ? (seg.length === 1 ? seg[0] : null) : seg[0] === "invite" && seg.length === 2 ? seg[1] : null;
    return code && /^[a-z\d-]{2,100}$/i.test(code) ? result("discord", "invite", `https://discord.gg/${code}`) : null;
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    if (["in", "company"].includes(seg[0]) && seg[1] && seg.length === 2) return result("linkedin", seg[0] === "company" ? "company" : "profile", `https://www.linkedin.com/${seg.join("/")}/`);
    if ((seg[0] === "posts" && seg[1]) || (seg[0] === "feed" && seg[1] === "update" && seg[2])) return result("linkedin", "post", `https://www.linkedin.com/${seg.join("/")}/`);
    return null;
  }
  if (host === "pinterest.com" || host === "pinterest.co.uk") {
    if (seg[0] === "pin" && /^\d+$/.test(seg[1] ?? "") && seg.length === 2) return result("pinterest", "post", `https://www.pinterest.com/pin/${seg[1]}/`);
    if (seg[0] && !["pin", "search", "ideas", "settings", "login"].includes(seg[0]) && seg.length <= 2) return result("pinterest", seg[1] ? "board" : "profile", `https://www.pinterest.com/${seg.join("/")}/`);
    return null;
  }
  if (host === "twitch.tv" && seg.length === 1 && /^[a-z\d_]{3,25}$/i.test(seg[0]) && !["directory", "downloads", "settings", "videos", "login"].includes(seg[0])) return result("twitch", "profile", `https://www.twitch.tv/${seg[0].toLowerCase()}`);
  if (host === "soundcloud.com" && seg[0] && seg.length <= 2 && !["discover", "search", "stream", "you", "settings", "upload"].includes(seg[0])) return result("soundcloud", seg[1] ? "track" : "profile", `https://soundcloud.com/${seg.join("/")}`);

  // ── Instagram ──
  if (host === "instagram.com" || host === "instagr.am") {
    if (seg[0] === "p" && seg[1]) {
      return { platform: "instagram", targetKind: "post", normalized: `https://www.instagram.com/p/${seg[1]}/`, displayUser: null };
    }
    if ((seg[0] === "reel" || seg[0] === "reels" || seg[0] === "tv") && seg[1]) {
      return { platform: "instagram", targetKind: "reel", normalized: `https://www.instagram.com/reel/${seg[1]}/`, displayUser: null };
    }
    if (seg[0] && !["explore", "stories", "direct", "accounts", "reels"].includes(seg[0])) {
      const user = seg[0].toLowerCase();
      return { platform: "instagram", targetKind: "profile", normalized: `https://www.instagram.com/${user}/`, displayUser: maskUser(user) };
    }
    return null;
  }

  // ── TikTok short link disimpan apa adanya (SEBELUM cabang umum,
  // karena vt./vm. juga berakhiran .tiktok.com) ──
  if (host === "vt.tiktok.com" || host === "vm.tiktok.com") {
    return { platform: "tiktok", targetKind: "video", normalized: stripTrailingSlash(p.raw.split("?")[0]!), displayUser: null };
  }
  // ── TikTok ──
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const at = seg.findIndex((s) => s.startsWith("@"));
    if (at >= 0) {
      const user = seg[at].slice(1).toLowerCase();
      const vidIdx = seg.indexOf("video", at);
      if (vidIdx >= 0 && seg[vidIdx + 1]) {
        return { platform: "tiktok", targetKind: "video", normalized: `https://www.tiktok.com/@${user}/video/${seg[vidIdx + 1]}`, displayUser: maskUser(user) };
      }
      return { platform: "tiktok", targetKind: "profile", normalized: `https://www.tiktok.com/@${user}`, displayUser: maskUser(user) };
    }
    return null;
  }

  // ── YouTube ──
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) {
    if (host === "youtu.be" && seg[0]) {
      return { platform: "youtube", targetKind: "video", normalized: `https://www.youtube.com/watch?v=${seg[0]}`, displayUser: null };
    }
    if (seg[0] === "watch") {
      const id = p.raw.match(/[?&]v=([\w-]{6,})/)?.[1];
      if (id) return { platform: "youtube", targetKind: "video", normalized: `https://www.youtube.com/watch?v=${id}`, displayUser: null };
      return null;
    }
    if (seg[0] === "shorts" && seg[1]) {
      return { platform: "youtube", targetKind: "video", normalized: `https://www.youtube.com/watch?v=${seg[1]}`, displayUser: null };
    }
    if ((seg[0] === "channel" || seg[0] === "c" || seg[0] === "user") && seg[1]) {
      return { platform: "youtube", targetKind: "channel", normalized: `https://www.youtube.com/${seg[0]}/${seg[1]}`, displayUser: maskUser(seg[1]) };
    }
    if (seg[0]?.startsWith("@")) {
      return { platform: "youtube", targetKind: "channel", normalized: `https://www.youtube.com/${seg[0].toLowerCase()}`, displayUser: maskUser(seg[0]) };
    }
    if (seg[0] === "playlist") {
      const list = p.raw.match(/[?&]list=([\w-]+)/)?.[1];
      if (list) return { platform: "youtube", targetKind: "playlist", normalized: `https://www.youtube.com/playlist?list=${list}`, displayUser: null };
      return null;
    }
    return null;
  }

  // ── Facebook ──
  if (host === "facebook.com" || host === "fb.com" || host === "fb.watch") {
    if (host === "fb.watch" && seg[0]) {
      return { platform: "facebook", targetKind: "video", normalized: stripTrailingSlash(p.raw.split("?")[0]!), displayUser: null };
    }
    if ((seg[0] === "reel" || seg[0] === "reels" || seg[0] === "videos" || seg[0] === "watch") && seg[1]) {
      return { platform: "facebook", targetKind: "video", normalized: `https://www.facebook.com/${seg[0]}/${seg[1]}`, displayUser: null };
    }
    if (seg.length >= 3 && ["videos", "posts"].includes(seg[1]) && seg[2]) {
      return result("facebook", seg[1] === "videos" ? "video" : "post", `https://www.facebook.com/${seg[0]}/${seg[1]}/${seg[2]}/`);
    }
    if (seg[0] === "permalink.php") {
      const url = new URL(p.raw);
      if (url.searchParams.get("story_fbid") && url.searchParams.get("id")) return result("facebook", "post", `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(url.searchParams.get("story_fbid")!)}&id=${encodeURIComponent(url.searchParams.get("id")!)}`);
      return null;
    }
    if (seg[0] === "profile.php") {
      const id = p.raw.match(/[?&]id=(\d+)/)?.[1];
      if (id) return { platform: "facebook", targetKind: "profile", normalized: `https://www.facebook.com/profile.php?id=${id}`, displayUser: null };
      return null;
    }
    if (seg[0]) {
      return { platform: "facebook", targetKind: "profile", normalized: `https://www.facebook.com/${seg[0]}/`, displayUser: maskUser(seg[0]) };
    }
    return null;
  }

  // ── Threads ──
  if (host === "threads.net" || host === "threads.com") {
    if (seg[0]?.startsWith("@")) {
      const user = seg[0].toLowerCase();
      if (seg[1] === "post" && seg[2]) {
        return { platform: "threads", targetKind: "post", normalized: `https://www.threads.net/${user}/post/${seg[2]}`, displayUser: maskUser(user) };
      }
      return { platform: "threads", targetKind: "profile", normalized: `https://www.threads.net/${user}`, displayUser: maskUser(user) };
    }
    return null;
  }

  // ── Shopee ──
  if (host === "shopee.co.id" || host === "shopee.com") {
    if (seg[0]) {
      const shop = seg[0].toLowerCase();
      return { platform: "shopee", targetKind: "shop", normalized: `https://shopee.co.id/${shop}`, displayUser: maskUser(shop) };
    }
    return null;
  }

  // ── Spotify ──
  if (host === "open.spotify.com") {
    const kind = seg[0];
    if (kind === "track" && seg[1] && seg.length === 2) {
      return { platform: "spotify", targetKind: "track", normalized: `https://open.spotify.com/${kind}/${seg[1].split("?")[0]}`, displayUser: null };
    }
    return null;
  }

  // ── X / Twitter ──
  if (host === "x.com" || host === "twitter.com" || host.endsWith(".x.com")) {
    if (seg[1] === "status" && seg[2]) {
      return { platform: "x", targetKind: "post", normalized: `https://x.com/${seg[0]}/status/${seg[2]}`, displayUser: maskUser(seg[0]) };
    }
    if (seg[0]) {
      return { platform: "x", targetKind: "profile", normalized: `https://x.com/${seg[0]}/`, displayUser: maskUser(seg[0]) };
    }
    return null;
  }

  return null;
}

/** Label platform bahasa pembeli. */
export const PEDIA_PLATFORM_LABEL: Record<PediaPlatform, string> = {
  instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook",
  threads: "Threads", shopee: "Shopee", spotify: "Spotify", x: "X", telegram: "Telegram",
  github: "GitHub", website: "Website", linkedin: "LinkedIn", pinterest: "Pinterest", discord: "Discord", twitch: "Twitch", soundcloud: "SoundCloud",
};

/** Label jenis target bahasa pembeli. */
export const PEDIA_TARGET_KIND_LABEL: Record<PediaTargetKind, string> = {
  profile: "Profil", post: "Postingan", video: "Video", reel: "Reel",
  live: "Live", channel: "Channel", playlist: "Playlist", shop: "Toko", track: "Lagu",
  repository: "Repository", website: "Website", company: "Perusahaan", board: "Board", invite: "Undangan server",
};

export function pediaTargetMatches(need: string, detected: PediaTargetKind) {
  return need === detected || (need === "profile" && detected === "channel")
    || (need === "post" && ["video", "reel"].includes(detected))
    || (need === "video" && ["post", "reel"].includes(detected));
}
