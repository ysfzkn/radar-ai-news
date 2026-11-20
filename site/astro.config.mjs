import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  output: "static",
  site: process.env.SITE_URL || "https://radar.ozkanyusuf.com",
  trailingSlash: "always",
  build: { inlineStylesheets: "never" },
  // Never inline a bundled script into the page: the CSP allows scripts from this origin only.
  vite: { build: { assetsInlineLimit: 0 } },
  integrations: [sitemap()],
});
