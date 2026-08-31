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

  // The ECA side moved from LOC 3 to LOC 2 for 2026/27. The old URL was live
  // and indexed, so it redirects rather than 404s.
  redirects: {
    '/teams/loc-3/': '/teams/loc-2/',
  },
  trailingSlash: 'always',
  integrations: [
    sitemap({
      // The form thank-you page is noindex; keep it out of the sitemap too so
      // the two do not contradict each other.
      filter: (page) => !page.includes('/thanks/'),
    }),
  ],
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
