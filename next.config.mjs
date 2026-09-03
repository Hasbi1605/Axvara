/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Fallback headers for static assets not covered by middleware (defense in depth)
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
  webpack: (config, { dev }) => {
    if (!dev) {
      // Pages 25 MiB limit: disable webpack cache file system
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
