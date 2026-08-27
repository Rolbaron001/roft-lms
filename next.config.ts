import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits a self-contained server under .next/standalone, which the production
   * Dockerfile copies. Without it the image would need the whole node_modules
   * tree, roughly ten times the size for no benefit.
   */
  output: "standalone",

  /**
   * pdf.js is loaded at run time rather than bundled. Bundling it rewrites the
   * dynamic imports it uses to reach its own worker and font data, and the
   * reader then fails to construct — which surfaces as every PDF being
   * unreadable rather than as a build error.
   */
  serverExternalPackages: ["pdfjs-dist"],

  /**
   * The application sits behind a reverse proxy that terminates TLS. These
   * headers are set there as well; setting them here too means they survive a
   * proxy being reconfigured or replaced.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
