/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Analysis payloads carry a base64 photo; allow room for it.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
