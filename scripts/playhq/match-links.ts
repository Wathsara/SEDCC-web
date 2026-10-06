/**
 * Match centre links for the fixtures we have synced.
 *
 *   npm run playhq:links        # fill data/playhq/fixtures.json in place
 *
 * Also imported by sync.ts, which calls linksFor() per team.
 *
 * ## Why this is not simply a URL built from game.id
 *
 * play.cricket.com.au and the PlayHQ public API do not share identifiers. The
 * same fixture — Dreamers 2nd XI v Salvation Army Waverley, Round 1 — is
 *
 *   4057d012-fc29-434d-a0c4-c9633602ca8d   in /v1/grades/{id}/games
 *   3304b435-894b-4866-bec3-9d701b9af216   in play.cricket.com.au/match/{id}
 *
 * and so are the grade (2521ddb6… vs 3bc631fd…) and the team (ca12b473… vs
 * 05af9280…). Measured: /match/ with a synced game id is a live route that
 * renders an empty page, which is worse than no link at all, because it looks
 * like the site is broken rather than like the feature is missing.
 *
 * So the public id has to be looked up. grassrootsapiproxy.cricket.com.au is
 * what the match centre itself calls, it needs no key, and
 * /scores/teams/{id}/matches returns a side's whole season. Round name is the
 * join: it is unique within a team's season, byes appear in neither list, and
 * on the 2026/27 LOC 2 fixture all ten rounds matched with opponent names
 * identical on both sides.
 *
 * The one thing it needs is the public team id, which has to be seeded once per
 * side in config/season-2026-27.json as `playCricketTeamId`. Nothing in the
 * PlayHQ API carries it, and the proxy's organisation and search endpoints are
 * 403 for this key — so it is read off one match URL from the club:
 *
 *   play.cricket.com.au/match/<id>  ->  /scores/matches/<id>  ->  the Teams[]
 *   entry whose OwningOrganisation is the club.
 *
 * `npm run playhq:links -- --seed <match-url>` prints that id.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from './utils.js';

const PROXY = 'https://grassrootsapiproxy.cricket.com.au';
const MATCH_CENTRE = 'https://play.cricket.com.au/match';
const CLUB = /south eastern dreamers/i;

interface PublicMatch {
  Id: string;
  Round?: { Name?: string };
  Teams?: Array<{ Id: string; DisplayName?: string; OwningOrganisation?: { Name?: string } }>;
}

const get = async (path: string) => {
  const res = await fetch(`${PROXY}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`public scores API ${res.status} on ${path}`);
  return res.json();
};

/** The public match centre URL for a public match id. The slug is cosmetic. */
export const matchCentreUrl = (publicId: string) => `${MATCH_CENTRE}/${publicId}?tab=summary`;

/**
 * Round name -> match centre URL, for one side's season.
 *
 * Returns an empty map rather than throwing when the lookup fails: a sync that
 * drops the links is a sync that still publishes the fixtures.
 */
export async function linksFor(playCricketTeamId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { Matches } = (await get(`/scores/teams/${playCricketTeamId}/matches`)) as {
      Matches: PublicMatch[];
    };
    for (const m of Matches ?? []) {
      const round = m.Round?.Name;
      if (round && m.Id) out.set(round, matchCentreUrl(m.Id));
    }
  } catch (err) {
    console.warn(`  match links unavailable: ${(err as Error).message}`);
  }
  return out;
}

/** The club's public team id, read off one match centre URL. */
export async function seedFromMatchUrl(url: string): Promise<string | null> {
  const id = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
  if (!id) throw new Error(`no match id in ${url}`);
  const m = (await get(`/scores/matches/${id}`)) as PublicMatch;
  const ours = (m.Teams ?? []).find(
    (t) => CLUB.test(t.OwningOrganisation?.Name ?? '') || CLUB.test(t.DisplayName ?? ''),
  );
  return ours?.Id ?? null;
}

/* ------------------------------------------------------------------ CLI -- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const seed = args[args.indexOf('--seed') + 1];

  if (args.includes('--seed')) {
    const id = await seedFromMatchUrl(seed);
    console.log(
      id
        ? `playCricketTeamId: ${id}\n  put it on the matching team in config/season-2026-27.json`
        : 'that match does not involve the club — is it the right URL?',
    );
    process.exit(id ? 0 : 1);
  }

  const seasonPath = resolve(ROOT, 'config/season-2026-27.json');
  const fixturesPath = resolve(ROOT, 'data/playhq/fixtures.json');
  const season = JSON.parse(await readFile(seasonPath, 'utf8'));
  const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'));

  let linked = 0;
  for (const team of fixtures.teams ?? []) {
    const cfg = season.teams?.find((t: { slug: string }) => t.slug === team.slug);
    const publicId = cfg?.playCricketTeamId ?? null;
    if (!publicId) {
      console.log(`  ${team.slug}: no playCricketTeamId — skipped`);
      continue;
    }
    const links = await linksFor(publicId);
    let hit = 0;
    for (const game of team.games ?? []) {
      const url = links.get(game.round);
      if (url) {
        game.matchCentreUrl = url;
        hit++;
      } else {
        delete game.matchCentreUrl;
      }
    }
    linked += hit;
    console.log(`  ${team.slug}: ${hit} of ${(team.games ?? []).length} linked`);
  }

  await writeFile(fixturesPath, `${JSON.stringify(fixtures, null, 2)}\n`);
  console.log(`\n${linked} match centre link(s) written to data/playhq/fixtures.json`);
}
