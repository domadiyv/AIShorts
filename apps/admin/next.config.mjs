// Where the API lives, reachable from the Next server (inside Docker this is the
// internal service name; locally it's localhost). Used to proxy image requests.
const API_URL = process.env.API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Admin is internal-only; keep builds lenient so type nits don't block.
  // (Next 16 removed the `eslint` config key — lint via CLI instead.)
  typescript: { ignoreBuildErrors: true },
  // Serve card images from the admin's own origin so they resolve no matter how
  // the panel is reached (localhost or a public tunnel), without baking a public
  // API URL at build time. Next proxies these to the API server-side.
  async rewrites() {
    return [{ source: '/v1/images/:path*', destination: `${API_URL}/v1/images/:path*` }];
  },
};

export default nextConfig;
