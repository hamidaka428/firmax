import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg uses native Node modules — don't bundle it
  serverExternalPackages: ["pg"],

  experimental: {
    serverActions: {
      // Contract/invoice uploads up to 15 MB (with a small margin for multipart overhead)
      bodySizeLimit: "16mb",
    },
  },

  // Tailwind CSS v4 with Turbopack (the @tailwindcss/turbopack package is in package.json).
  // Without this rule, @import "tailwindcss" and @theme in globals.css are not processed and the page has no styles.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
