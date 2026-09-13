import type { Config } from "tailwindcss";

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
  plugins: [],
};
export default config;
