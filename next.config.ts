import type { NextConfig } from "next";

// Cloudflare Turnstile serves its loader script from, and renders its
// challenge iframe under, this origin. Both script-src and frame-src must
// allow it or the widget breaks.
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

// Content-Security-Policy for the MVP.
// - default/connect/img stay 'self': the BROWSER only ever calls our own
//   /api/* routes. The Anthropic / Tavily / Google / 2GIS calls are all
//   server-side, so they never need a connect-src grant.
// - script-src allows Turnstile's loader. 'unsafe-inline' is required for
//   Next's inline bootstrap + Turnstile's injected inline; no nonce infra in
//   this MVP.
// - style-src 'unsafe-inline' is acceptable here (Tailwind + injected styles).
// - frame-src allows the Turnstile challenge iframe.
// - frame-ancestors 'none' (clickjacking) — paired with X-Frame-Options below.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  `frame-src 'self' ${TURNSTILE_ORIGIN}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
