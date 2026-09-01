/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "cdn.axvara.id" },
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
