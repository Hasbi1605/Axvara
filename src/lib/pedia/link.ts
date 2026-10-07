// src/lib/pedia/link.ts — Parser link Pedia (PEDIA-PRD §9.6).
//
// SHARED client & server: deteksi platform + jenis target + normalisasi.
// TIDAK ada fetch ke platform sosial (tanpa scraping, tanpa preview gambar).
// Short link TikTok (vt/vm) DISIMPAN apa adanya — supplier menerima.

export type PediaPlatform =
  | "instagram" | "tiktok" | "youtube" | "facebook"
  | "threads" | "shopee" | "spotify" | "x" | "telegram";

export type PediaTargetKind =
  | "profile" | "post" | "video" | "reel" | "live" | "channel" | "playlist"
  | "shop" | "track";

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
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  return { host, path: url.pathname || "/", raw: text };
}

/** Deteksi link. null = tidak dikenali (UI netral, bukan merah). */
export function detectPediaLink(raw: string): PediaLinkDetect | null {
  const p = prep(raw);
  if (!p) return null;
  const { host, path } = p;
  const seg = path.split("/").filter(Boolean);

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
  if (host.endsWith("shopee.co.id") || host.endsWith("shopee.com") || host === "shope.ee") {
    if (seg[0]) {
      const shop = seg[0].toLowerCase();
      return { platform: "shopee", targetKind: "shop", normalized: `https://shopee.co.id/${shop}`, displayUser: maskUser(shop) };
    }
    return null;
  }

  // ── Spotify ──
  if (host === "open.spotify.com") {
    const kind = seg[0];
    if ((kind === "track" || kind === "album" || kind === "playlist" || kind === "artist") && seg[1]) {
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
};

/** Label jenis target bahasa pembeli. */
export const PEDIA_TARGET_KIND_LABEL: Record<PediaTargetKind, string> = {
  profile: "Profil", post: "Postingan", video: "Video", reel: "Reel",
  live: "Live", channel: "Channel", playlist: "Playlist", shop: "Toko", track: "Lagu",
};
