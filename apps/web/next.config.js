/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@pfm/shared'],
  output: 'standalone',
};

module.exports = nextConfig;
