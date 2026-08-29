import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Content collections. A malformed article fails the build loudly instead of
 * shipping a half-rendered page — that matters when the person publishing is a
 * committee volunteer, not a developer.
 *
 * See .claude/skills/content-publishing/SKILL.md for the authoring guide.
 */

const teamSlug = z.enum(['loc-1', 'loc-3', 'grade-4']);

const articles = defineCollection({
  // images/ holds article artwork, not content. Without the exclusion its
  // README is loaded as an article and fails the schema, which stops the dev
  // server rather than just skipping the file.
  loader: glob({ pattern: ['**/*.md', '!**/images/**'], base: './src/content/articles' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(70, 'Keep titles under 70 characters so they do not wrap awkwardly'),
      date: z.coerce.date(),
      category: z.enum([
        'match-report',
        'club-news',
        'player-profile',
        'announcement',
        'season-review',
        'social',
      ]),
      summary: z.string().max(200),
      author: z.string().default('Dreamers CC'),
      /** Ties an article to a team page. Omit for club-wide news. */
      team: teamSlug.optional(),
      tags: z.array(z.string()).default([]),
      /**
       * Relative path so Astro optimises the image at build time. Article
       * images never go in public/ — that ships a 4MB phone photo untouched.
       */
      hero: z
        .object({
          src: image(),
          alt: z.string().min(1, 'Alt text is required — describe what is happening'),
          credit: z.string().optional(),
        })
        .optional(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    order: z.number().default(99),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, pages };
