import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";
import type { PluginCreator } from "tailwindcss/types/config";

// The package declaration omits the standard Tailwind plugin API/config.
const animationPlugin = animate as unknown as { handler: PluginCreator; config: Partial<Config> };

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        admin: Object.fromEntries(Object.entries({ bg: "248 250 252", card: "255 255 255", fg: "15 23 42", muted: "100 116 139", subtle: "241 245 249", border: "226 232 240", input: "203 213 225", ring: "14 116 144", primary: "15 23 42", inverse: "255 255 255", accent: "14 116 144", success: "4 120 87", warning: "146 64 14", danger: "185 28 28", info: "29 78 216" }).map(([key, fallback]) => [key, `rgb(var(--admin-${key}, ${fallback}) / <alpha-value>)`])),
        ax: {
          bg: "#080C1E",
          bg2: "#0F1430",
          bg3: "#161D4A",
          cyan: "#00E5FF",
          gold: "#FFB800",
          success: "#22C55E",
          warning: "#F59E0B",
          danger: "#EF4444",
        },
      },
      fontFamily: {
        // Urutan disengaja: webfont cross-platform dulu (Inter/Space Grotesk
        // via next/font CSS vars), lalu SF Apple di iOS/Mac, lalu Segoe UI
        // (Windows) / Roboto (Android) agar tidak pernah jatuh ke Arial tipis.
        display: [
          "var(--font-ax-display)",
          "Space Grotesk",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        sans: [
          "var(--font-ax-sans)",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "var(--font-ax-mono)",
          "JetBrains Mono",
          "SF Mono",
          "Consolas",
          "Menlo",
          "monospace",
        ],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      backdropBlur: {
        glass: "20px",
      },
      keyframes: {
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideInRight: {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        fadeInUp: "fadeInUp 0.5s cubic-bezier(0.32,0.72,0,1) forwards",
      },
    },
  },
  // Preserve storefront duration-[...] utilities: the animation plugin also
  // registers duration/delay/ease, which makes Tailwind 3 discard those classes.
  plugins: [plugin(api => animationPlugin.handler({ ...api, matchUtilities: (utilities, options) => api.matchUtilities(Object.fromEntries(Object.entries(utilities).filter(([name]) => !["duration", "delay", "ease"].includes(name))), options) }), animationPlugin.config)],
};
export default config;
