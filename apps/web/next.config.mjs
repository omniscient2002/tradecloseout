/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tradecloseout/shared'],
  devIndicators: false,
  async rewrites() {
    const apiOrigin = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return {
      beforeFiles: process.env.NODE_ENV === 'development' ? [
        { source: '/sw.js', destination: '/dev-service-worker' },
      ] : [],
      afterFiles: [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
      ],
      fallback: [],
    };
  },
};

export default nextConfig;
