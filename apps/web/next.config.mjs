/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@nf/shared'],
  eslint: {
    // Lint is run explicitly via `pnpm lint`; don't block the production build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
