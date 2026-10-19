/** Registri publik Pedia. Identitas supplier dan harga modal tidak masuk modul ini. */
export const PEDIA_PLATFORM_CONFIG = [
  { id: "instagram", label: "Instagram", color: "#D62976", group: "social", summary: "Followers, likes, dan tayangan Reels" },
  { id: "tiktok", label: "TikTok", color: "#FE2C55", group: "social", summary: "Followers, likes, tayangan, dan share" },
  { id: "youtube", label: "YouTube", color: "#FF0000", group: "social", summary: "Subscriber, likes, dan tayangan video" },
  { id: "facebook", label: "Facebook", color: "#1877F2", group: "social", summary: "Followers, likes, dan tayangan video" },
  { id: "threads", label: "Threads", color: "#FFFFFF", group: "social", summary: "Followers dan interaksi postingan" },
  { id: "x", label: "X", color: "#FFFFFF", group: "social", summary: "Followers, likes, dan tayangan" },
  { id: "telegram", label: "Telegram", color: "#26A5E4", group: "social", summary: "Members, tayangan, dan reactions" },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2", group: "social", summary: "Followers dan interaksi LinkedIn" },
  { id: "pinterest", label: "Pinterest", color: "#E60023", group: "social", summary: "Followers dan interaksi pin" },
  { id: "discord", label: "Discord", color: "#5865F2", group: "social", summary: "Members untuk server komunitas" },
  { id: "shopee", label: "Shopee", color: "#EE4D2D", group: "marketplace", summary: "Followers toko Shopee" },
  { id: "spotify", label: "Spotify", color: "#1DB954", group: "streaming", summary: "Plays lagu Spotify" },
  { id: "soundcloud", label: "SoundCloud", color: "#FF5500", group: "streaming", summary: "Plays dan likes lagu" },
  { id: "twitch", label: "Twitch", color: "#9146FF", group: "streaming", summary: "Followers channel Twitch" },
  { id: "github", label: "GitHub", color: "#FFFFFF", group: "web", summary: "Followers profil dan fork repository" },
  { id: "website", label: "Website Traffic", color: "#00E5FF", group: "web", summary: "Traffic global dan Indonesia" },
] as const;

export const PEDIA_GROUPS = [
  { id: "", label: "Semua", icon: "star" },
  { id: "social", label: "Media sosial", icon: "chat" },
  { id: "streaming", label: "Musik & streaming", icon: "star" },
  { id: "web", label: "Website & developer", icon: "globe" },
  { id: "marketplace", label: "Marketplace", icon: "shopping-bag" },
] as const;

export const PEDIA_METRIC_LABEL: Record<string, string> = {
  followers: "Followers", likes: "Likes", views: "Tayangan", subscribers: "Subscriber",
  members: "Members", plays: "Plays", shares: "Share", saves: "Saves", reactions: "Reactions",
  forks: "Fork", traffic: "Traffic website", reposts: "Repost", quotes: "Quote",
};

export function pediaPlatform(id: string) { return PEDIA_PLATFORM_CONFIG.find((p) => p.id === id); }

/** Cari dengan istilah pembeli, termasuk variasi Indonesia/Inggris. */
export function pediaSearchText(raw: string) {
  return raw.toLowerCase().replace(/twitter/g, "x").replace(/pengikut/g, "followers")
    .replace(/pelanggan/g, "subscribers").replace(/anggota/g, "members")
    .replace(/tayangan|penayangan/g, "views").replace(/kunjungan/g, "traffic")
    .replace(/\bsuka\b/g, "likes").replace(/\bindo\b/g, "indonesia").trim();
}

export function pediaMatches(query: string, text: string) {
  const haystack = pediaSearchText(text);
  return pediaSearchText(query).split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

export function pediaTargetExample(platform: string, kind: string) {
  const examples: Record<string, Record<string, string>> = {
    instagram: { profile: "https://www.instagram.com/username/", post: "https://www.instagram.com/p/ABCDE/", reel: "https://www.instagram.com/reel/ABCDE/" },
    tiktok: { profile: "https://www.tiktok.com/@username", video: "https://www.tiktok.com/@username/video/123456789" },
    youtube: { channel: "https://www.youtube.com/@channel", video: "https://www.youtube.com/watch?v=abcdefghijk", short: "https://www.youtube.com/shorts/abcdefghijk" },
    facebook: { post: "https://www.facebook.com/username/posts/123456789/", profile: "https://www.facebook.com/username/", video: "https://www.facebook.com/reel/123456789" },
    threads: { profile: "https://www.threads.net/@username", post: "https://www.threads.net/@username/post/ABCDE" },
    x: { profile: "https://x.com/username", post: "https://x.com/username/status/123456789" },
    telegram: { channel: "https://t.me/channel", post: "https://t.me/channel/123" },
    linkedin: { profile: "https://www.linkedin.com/in/username/", company: "https://www.linkedin.com/company/perusahaan/", post: "https://www.linkedin.com/feed/update/urn:li:activity:123456789/" },
    pinterest: { profile: "https://www.pinterest.com/username/", board: "https://www.pinterest.com/username/nama-board/", post: "https://www.pinterest.com/pin/123456789/" },
    discord: { invite: "https://discord.gg/kodeundangan" },
    shopee: { shop: "https://shopee.co.id/namatoko" },
    spotify: { track: "https://open.spotify.com/track/IDlagu", artist: "https://open.spotify.com/artist/3ue1J3iN9SL3UetNZk6HHd", playlist: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M" },
    soundcloud: { profile: "https://soundcloud.com/username", track: "https://soundcloud.com/username/judul-lagu" },
    twitch: { profile: "https://www.twitch.tv/username" },
    github: { profile: "https://github.com/username", repository: "https://github.com/username/repository" },
    website: { website: "https://contoh.com/halaman" },
  };
  return examples[platform]?.[kind] ?? examples[platform]?.profile ?? "https://";
}
