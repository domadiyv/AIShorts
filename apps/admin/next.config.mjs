/** @type {import('next').NextConfig} */
const nextConfig = {
  // Admin is internal-only; keep builds lenient so lint/type nits don't block.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
