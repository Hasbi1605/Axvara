import { z } from "zod";

export const bannerSettingsSchema = z.object({
  delay_ms: z.number().int().min(0).max(10000),
  autoplay: z.boolean(),
  interval_ms: z.number().int().min(4000).max(20000),
  max_show_per_session: z.number().int().min(1).max(10),
}).strict();
export type BannerSettings = z.infer<typeof bannerSettingsSchema>;
export const DEFAULT_BANNER_SETTINGS: BannerSettings = { delay_ms: 1500, autoplay: true, interval_ms: 6000, max_show_per_session: 1 };
