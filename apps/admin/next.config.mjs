// Images on the review page come from the (private) object store via short-lived presigned URLs,
// so the CSP must allow that host. Everything else is locked to this origin.
const storageOrigin = process.env.ADMIN_STORAGE_ORIGIN ?? 'http://localhost:9000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' }, // identity documents: never cache pages
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `img-src 'self' data: ${storageOrigin}`,
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline'" +
                (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
