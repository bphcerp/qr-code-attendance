import type { NextConfig } from "next";

// Defense-in-depth response headers on every route. Deliberately no
// Content-Security-Policy here: the theme/QR bootstrap runs through inline
// <script>/dangerouslySetInnerHTML, so a strict CSP needs per-request nonces
// wired through the layout first -- added separately so it can be verified in
// isolation rather than silently breaking rendering. Permissions-Policy keeps
// camera and geolocation on self because /scan needs both.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  // Keep next's generated rules markdown out of the repo root.
  agentRules: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
