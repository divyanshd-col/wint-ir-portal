import type { NextConfig } from "next";

const securityHeaders = [
  // Prevent browsers from guessing MIME types — stops scripts disguised as images
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  // Deny embedding this site in iframes — prevents clickjacking
  { key: 'X-Frame-Options',           value: 'DENY' },
  // Force HTTPS for 1 year, include subdomains
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Restrict what browsers can learn about where traffic comes from
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  // Disable access to camera, mic, geolocation from this page
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  // Block DNS prefetch to avoid leaking visited sub-resources
  { key: 'X-DNS-Prefetch-Control',    value: 'off' },
  // Content Security Policy — restrict what scripts/styles/connections are allowed
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires unsafe-inline for hydration chunks; unsafe-eval is not needed in production
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      // Allow images from self and data URIs (used by SVGs, chart libs)
      "img-src 'self' data: blob:",
      // API calls only go to same origin + Upstash + Google APIs + Neon
      "connect-src 'self' https://*.upstash.io https://generativelanguage.googleapis.com https://api.anthropic.com",
      "font-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // Never ship source maps to the browser — keeps your code private in DevTools
  productionBrowserSourceMaps: false,

  headers: async () => [
    {
      source: '/(.*)',
      headers: securityHeaders,
    },
  ],

  // Serve the OAuth discovery documents at their spec-mandated .well-known paths.
  // Rewrites run before filesystem routing, so this is independent of whether
  // Next serves dot-prefixed app/ segments. claude.ai fetches these to discover
  // the authorization server (RFC 8414) and the protected resource (RFC 9728).
  rewrites: async () => [
    {
      source: '/.well-known/oauth-authorization-server',
      destination: '/api/oauth/discovery/authorization-server',
    },
    {
      source: '/.well-known/oauth-protected-resource',
      destination: '/api/oauth/discovery/protected-resource',
    },
    {
      // Some clients append the resource path to the protected-resource metadata URL.
      source: '/.well-known/oauth-protected-resource/:path*',
      destination: '/api/oauth/discovery/protected-resource',
    },
  ],
};

export default nextConfig;
