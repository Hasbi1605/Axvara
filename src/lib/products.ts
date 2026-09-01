export type Category = {
  id: string;
  name: string;
  slug: string;
  icon: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  comparePrice?: number;
  categorySlug: string;
  image: string;
  images?: string[];
  soldCount?: number;
  stock?: number;
  isActive?: boolean;
  sortOrder?: number;
  badge?: string;
  popular?: boolean;
};

export const categories: Category[] = [
  { id: "1", name: "Semua", slug: "semua", icon: "✦" },
  { id: "2", name: "AI Gateway", slug: "ai-gateway", icon: "⚡" },
  { id: "3", name: "Akun Premium", slug: "akun-premium", icon: "◆" },
  { id: "4", name: "Tools Pro", slug: "tools-pro", icon: "◈" },
  { id: "5", name: "Bundle Hemat", slug: "bundle-hemat", icon: "⬢" },
];

export const products: Product[] = [
  { id: "p1", slug: "chatgpt-plus-1-bulan", name: "ChatGPT Plus 1 Bulan", description: "Akses GPT-4o penuh, private account, garansi full.", price: 89000, comparePrice: 300000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=450&fit=crop", images: ["https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=450&fit=crop","https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=450&fit=crop","https://images.unsplash.com/photo-1639322537224-f012857c7c2e?w=600&h=450&fit=crop"], badge: "Terlaris", popular: true, soldCount: 342, stock: 48 },
  { id: "p2", slug: "claude-pro-1-bulan", name: "Claude Pro 1 Bulan", description: "Anthropic Claude 3.5 Sonnet unlimited, untuk coding & writing.", price: 95000, comparePrice: 320000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=600&h=450&fit=crop", badge: "Baru", soldCount: 128, stock: 22 },
  { id: "p3", slug: "ai-gateway-1jt-token", name: "AI Gateway 1 Juta Token", description: "Gateway hemat GPT-4o, Claude, Gemini — 1 key untuk semua model.", price: 75000, categorySlug: "ai-gateway", image: "https://images.unsplash.com/photo-1639322537224-f012857c7c2e?w=600&h=450&fit=crop", popular: true, soldCount: 512, stock: 999 },
  { id: "p4", slug: "midjourney-1-bulan", name: "Midjourney Basic 1 Bulan", description: "Generate 200+ gambar AI, fast mode, private.", price: 110000, comparePrice: 180000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&h=450&fit=crop", soldCount: 87, stock: 15 },
  { id: "p5", slug: "canva-pro-1-tahun", name: "Canva Pro 1 Tahun", description: "Invite team, semua template & Brand Kit premium.", price: 45000, comparePrice: 600000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=450&fit=crop", badge: "Hemat 92%", soldCount: 412, stock: 60 },
  { id: "p6", slug: "capcut-pro-1-bulan", name: "CapCut Pro 1 Bulan", description: "No watermark, AI tools, cloud 100GB.", price: 35000, comparePrice: 120000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1611224923853-80b023f02d71?w=600&h=450&fit=crop&crop=center", soldCount: 234, stock: 33 },
  { id: "p7", slug: "perplexity-pro-1-tahun", name: "Perplexity Pro 1 Tahun", description: "AI search pro, GPT-4o + Claude + Gemini.", price: 125000, comparePrice: 800000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=600&h=450&fit=crop", soldCount: 76, stock: 18 },
  { id: "p8", slug: "bundle-creator-3in1", name: "Bundle Creator 3-in-1", description: "ChatGPT Plus + Canva Pro + CapCut Pro — hemat 60%.", price: 135000, comparePrice: 450000, categorySlug: "bundle-hemat", image: "https://images.unsplash.com/photo-1553877522-43269d4ea984?w=600&h=450&fit=crop", badge: "Bundle", popular: true, soldCount: 189, stock: 27 },
  { id: "p9", slug: "ai-gateway-5jt-token", name: "AI Gateway 5 Juta Token", description: "Untuk developer & agency — 5jt token, key anti-limit.", price: 299000, comparePrice: 500000, categorySlug: "ai-gateway", image: "https://images.unsplash.com/photo-1639322537504-fcfecb546b11?w=600&h=450&fit=crop", soldCount: 64, stock: 40 },
  { id: "p10", slug: "adobe-cc-1-bulan", name: "Adobe CC All Apps 1 Bulan", description: "Photoshop, Illustrator, Premiere — full.", price: 150000, comparePrice: 800000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1626785774573-6dd65b279390?w=600&h=450&fit=crop", soldCount: 45, stock: 12 },
  { id: "p11", slug: "notion-plus-1-tahun", name: "Notion Plus 1 Tahun", description: "AI blocks, unlimited upload, team 10 orang.", price: 65000, comparePrice: 400000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1454165205744-3b78555e5572?w=600&h=450&fit=crop", soldCount: 92, stock: 25 },
  { id: "p12", slug: "bundle-ai-master", name: "Bundle AI Master", description: "GPT Plus + Claude Pro + Midjourney + Perplexity — ultimate.", price: 299000, comparePrice: 1200000, categorySlug: "bundle-hemat", image: "https://images.unsplash.com/photo-1526379095098-d400fd0bf935?w=600&h=450&fit=crop", badge: "Ultimate", soldCount: 58, stock: 9 },
  // --- Pagination batch 2 (13-24) ---
  { id: "p13", slug: "youtube-premium-1-bulan", name: "YouTube Premium 1 Bulan", description: "No ads, background play, YouTube Music included.", price: 25000, comparePrice: 70000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=600&h=450&fit=crop", badge: "Hemat", soldCount: 267, stock: 50 },
  { id: "p14", slug: "netflix-premium-1-bulan", name: "Netflix Premium 1 Bulan", description: "4K UHD, 4 device, private profile.", price: 35000, comparePrice: 186000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?w=600&h=450&fit=crop", soldCount: 198, stock: 30 },
  { id: "p15", slug: "spotify-premium-1-bulan", name: "Spotify Premium 1 Bulan", description: "No ads, offline, high quality.", price: 20000, comparePrice: 55000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=600&h=450&fit=crop", soldCount: 312, stock: 55 },
  { id: "p16", slug: "gemini-advanced-1-bulan", name: "Gemini Advanced 1 Bulan", description: "Google Gemini 1.5 Pro + 2TB Drive.", price: 89000, comparePrice: 300000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1573804633927-bfcbcd909acd?w=600&h=450&fit=crop", soldCount: 71, stock: 16 },
  { id: "p17", slug: "vpn-premium-1-tahun", name: "VPN Premium 1 Tahun", description: "Nord/Express style, 60+ negara, no log.", price: 99000, comparePrice: 1200000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?w=600&h=450&fit=crop", soldCount: 39, stock: 20 },
  { id: "p18", slug: "microsoft-365-1-tahun", name: "Microsoft 365 Family 1 Tahun", description: "Word, Excel, PowerPoint + 1TB OneDrive (6 user).", price: 75000, comparePrice: 1300000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1586953208448-b95a79798f07?w=600&h=450&fit=crop", soldCount: 84, stock: 28 },
  { id: "p19", slug: "figma-professional-1-bulan", name: "Figma Professional 1 Bulan", description: "Team library, unlimited projects, dev mode.", price: 55000, comparePrice: 220000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1618005198919-d3d4b5a92ead?w=600&h=450&fit=crop", soldCount: 53, stock: 14 },
  { id: "p20", slug: "ai-gateway-10jt-token", name: "AI Gateway 10 Juta Token", description: "Enterprise — 10jt token, priority & log dashboard.", price: 549000, comparePrice: 900000, categorySlug: "ai-gateway", image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=600&h=450&fit=crop", badge: "Enterprise", soldCount: 22, stock: 100 },
  { id: "p21", slug: "bundle-productivity", name: "Bundle Productivity", description: "Notion + Microsoft 365 + VPN — kerja tanpa batas.", price: 149000, comparePrice: 2800000, categorySlug: "bundle-hemat", image: "https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=600&h=450&fit=crop", soldCount: 41, stock: 11 },
  { id: "p22", slug: "bundle-streaming", name: "Bundle Streaming Hemat", description: "YouTube Premium + Netflix + Spotify — nonton & denger puas.", price: 65000, comparePrice: 311000, categorySlug: "bundle-hemat", image: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600&h=450&fit=crop", soldCount: 156, stock: 35 },
  { id: "p23", slug: "cursor-pro-1-bulan", name: "Cursor Pro 1 Bulan", description: "AI code editor — Tab, Chat, Composer premium.", price: 85000, comparePrice: 320000, categorySlug: "akun-premium", image: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&h=450&fit=crop", soldCount: 67, stock: 19 },
  { id: "p24", slug: "grammarly-premium-1-tahun", name: "Grammarly Premium 1 Tahun", description: "AI writing, plagiarism check, tone rewrite.", price: 95000, comparePrice: 1440000, categorySlug: "tools-pro", image: "https://images.unsplash.com/photo-1455390582262-044cdead277a?w=600&h=450&fit=crop", soldCount: 48, stock: 21 },
];

export const paymentMethods = [
  { id: "qris", label: "QRIS", hint: "Scan satu QR untuk semua e-wallet & bank", badge: "Paling Cepat" },
  { id: "ewallet", label: "DANA / Gopay / Shopeepay", account: "082135277434", hint: "Transfer ke e-wallet" },
  { id: "seabank", label: "SeaBank", account: "901812349386", hint: "Transfer bank" },
] as const;
