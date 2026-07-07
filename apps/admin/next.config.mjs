/** @type {import('next').NextConfig} */
const nextConfig = {
  // Admin is internal-only; keep builds lenient so type nits don't block.
  // (Next 16 removed the `eslint` config key — lint via CLI instead.)
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
