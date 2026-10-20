/** Public platform identities and examples; no supplier metadata. */
export const PEDIA_ADDITIONAL_PLATFORMS = [
  {"id": "roblox", "label": "Roblox", "color": "#FFFFFF", "group": "social", "summary": "Followers profil Roblox"},
  {"id": "whatsapp", "label": "WhatsApp", "color": "#25D366", "group": "social", "summary": "Members channel dan reactions postingan"},
  {"id": "lazada", "label": "Lazada", "color": "#F57224", "group": "marketplace", "summary": "Followers toko dan likes produk"},
  {"id": "snackvideo", "label": "SnackVideo", "color": "#FFCB05", "group": "social", "summary": "Followers profil SnackVideo"},
  {"id": "kick", "label": "Kick", "color": "#53FC18", "group": "streaming", "summary": "Followers channel Kick"},
  {"id": "vimeo", "label": "Vimeo", "color": "#1AB7EA", "group": "streaming", "summary": "Tayangan dan likes video Vimeo"},
  {"id": "tumblr", "label": "Tumblr", "color": "#FFFFFF", "group": "social", "summary": "Followers blog Tumblr"},
  {"id": "reddit", "label": "Reddit", "color": "#FF4500", "group": "social", "summary": "Followers profil, anggota komunitas dan interaksi"},
  {"id": "dribbble", "label": "Dribbble", "color": "#EA4C89", "group": "web", "summary": "Followers desainer dan likes shot"},
  {"id": "mixcloud", "label": "Mixcloud", "color": "#FFFFFF", "group": "streaming", "summary": "Plays dan interaksi audio Mixcloud"},
  {"id": "audiomack", "label": "Audiomack", "color": "#FFA200", "group": "streaming", "summary": "Plays dan interaksi lagu Audiomack"},
  {"id": "medium", "label": "Medium", "color": "#FFFFFF", "group": "web", "summary": "Followers penulis dan bookmarks artikel"},
  {"id": "rumble", "label": "Rumble", "color": "#85C742", "group": "streaming", "summary": "Tayangan video Rumble"},
  {"id": "coinmarketcap", "label": "CoinMarketCap", "color": "#FFFFFF", "group": "social", "summary": "Followers komunitas dan tayangan postingan"},
  {"id": "rutube", "label": "Rutube", "color": "#FFFFFF", "group": "streaming", "summary": "Tayangan video Rutube"},
  {"id": "tidal", "label": "Tidal", "color": "#FFFFFF", "group": "streaming", "summary": "Plays dan followers playlist Tidal"},
  {"id": "coub", "label": "Coub", "color": "#FFFFFF", "group": "streaming", "summary": "Likes, share dan subscriber Coub"},
  {"id": "reverbnation", "label": "ReverbNation", "color": "#E43526", "group": "streaming", "summary": "Fans artis dan plays lagu"},
] as const;
export const PEDIA_ADDITIONAL_EXAMPLES: Record<string, Record<string, string>> = {
  "roblox": {
    "profile": "https://www.roblox.com/users/12345678/profile"
  },
  "whatsapp": {
    "channel": "https://www.whatsapp.com/channel/0029VaExampleChannel",
    "post": "https://www.whatsapp.com/channel/0029VaExampleChannel/123"
  },
  "lazada": {
    "shop": "https://www.lazada.co.id/shop/namatoko/",
    "post": "https://www.lazada.co.id/products/pdp-i123456-s7890.html"
  },
  "snackvideo": {
    "profile": "https://sck.io/u/@username/dKmgHnRA"
  },
  "kick": {
    "profile": "https://kick.com/username"
  },
  "vimeo": {
    "video": "https://vimeo.com/123456789",
    "profile": "https://vimeo.com/user12345678",
    "channel": "https://vimeo.com/channels/namachannel"
  },
  "tumblr": {
    "profile": "https://username.tumblr.com"
  },
  "reddit": {
    "profile": "https://www.reddit.com/user/username/",
    "channel": "https://www.reddit.com/r/namakomunitas/",
    "post": "https://www.reddit.com/r/namakomunitas/comments/abc123/judul/"
  },
  "dribbble": {
    "profile": "https://dribbble.com/username",
    "post": "https://dribbble.com/shots/12345678-judul"
  },
  "mixcloud": {
    "profile": "https://www.mixcloud.com/username/",
    "track": "https://www.mixcloud.com/username/judul-mix/"
  },
  "audiomack": {
    "profile": "https://audiomack.com/username",
    "track": "https://audiomack.com/username/song/judul",
    "album": "https://audiomack.com/username/album/judul"
  },
  "medium": {
    "profile": "https://medium.com/@username",
    "post": "https://medium.com/@username/judul-artikel-abc123"
  },
  "rumble": {
    "video": "https://rumble.com/v123abc-judul-video.html"
  },
  "coinmarketcap": {
    "profile": "https://coinmarketcap.com/community/profile/username/",
    "post": "https://coinmarketcap.com/community/post/342320697/"
  },
  "rutube": {
    "video": "https://rutube.ru/video/0123456789abcdef0123456789abcdef/"
  },
  "tidal": {
    "playlist": "https://tidal.com/browse/playlist/12345678-1234-1234-1234-123456789abc"
  },
  "coub": {
    "profile": "https://coub.com/username",
    "video": "https://coub.com/view/abc123"
  },
  "reverbnation": {
    "profile": "https://www.reverbnation.com/username",
    "track": "https://www.reverbnation.com/username/song/12345678-judul"
  }
};
