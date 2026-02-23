/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable the default body parser for webhook routes
  // so we can read the raw body for signature verification
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

module.exports = nextConfig;
