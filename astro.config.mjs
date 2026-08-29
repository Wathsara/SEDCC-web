// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Set by .github/workflows/deploy.yml. Getting BASE_PATH wrong is the usual
// cause of a deploy that succeeds but renders unstyled — see the
// github-pages-deploy skill.
const site = process.env.SITE_URL ?? 'http://localhost:4321';
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  site,
  base,
  // Static only. No SSR, no API routes — GitHub Pages serves files.
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
  image: {
    // Article images are optimised at build time from src/content/, never
    // served raw out of public/.
    responsiveStyles: true,
  },
  markdown: {
    shikiConfig: { theme: 'github-light', wrap: true },
  },
});
