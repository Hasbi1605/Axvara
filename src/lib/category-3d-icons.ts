/** Ikon 3D kategori custom AXVARA, dibuat dengan image generation,
 * dipangkas 192px webp; disajikan same-origin. */
export const CATEGORY_3D_ICONS: Record<string, { src: string; glow: string }> = {
  "ai-chatbot": { src: "/brand/catalog/category-3d/ai-chatbot.webp", glow: "#00E5FF" },
  "streaming-hiburan": { src: "/brand/catalog/category-3d/streaming-hiburan.webp", glow: "#FF598B" },
  "produktivitas-office": { src: "/brand/catalog/category-3d/produktivitas-office.webp", glow: "#FFB800" },
  "desain-video": { src: "/brand/catalog/category-3d/desain-video.webp", glow: "#C77DFF" },
  "developer-tools": { src: "/brand/catalog/category-3d/developer-tools.webp", glow: "#32E6AD" },
  "bundle-hemat": { src: "/brand/catalog/category-3d/bundle-hemat.webp", glow: "#FFB800" },
};

export function category3dIcon(slug: string) {
  return Object.hasOwn(CATEGORY_3D_ICONS, slug) ? CATEGORY_3D_ICONS[slug] : undefined;
}
