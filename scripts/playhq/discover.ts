/**
 * One-off discovery: given an organisation ID, print every season, grade and
 * Dreamers team ID so they can be pasted into config/season-2026-27.json.
 *
 *   npm run playhq:discover
 *   npm run playhq:discover -- --org <uuid>
 *
 * Organisation IDs are UUIDs and are not visible anywhere on playhq.com. Ask the
 * association (ECA / VSCA) or PlayHQ support for one. Associations are usually
 * the right level: a club's own org ID often has no seasons hanging off it.
 */

import { resolve } from 'node:path';

import { gradesForSeason, seasonsForOrganisation, teamsForSeason } from './client.js';
import { CONFIG_DIR, DATA_DIR, log, readJson, writeJson } from './utils.js';

interface ClubConfig {
  playhq: {
    organisationIds: Array<{ label: string; id: string | null }>;
    clubId: string | null;
    clubNameMatch: string;
  };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const club = await readJson<ClubConfig>(resolve(CONFIG_DIR, 'club.json'));

  const orgs = arg('--org')
    ? [{ label: 'cli', id: arg('--org')! }]
    : club.playhq.organisationIds.filter((o): o is { label: string; id: string } => Boolean(o.id));

  if (orgs.length === 0) {
    log.warn('No organisation IDs configured.');
    log.info('Add them to config/club.json under playhq.organisationIds, or pass --org <uuid>.');
    log.info('Ask ECA and VSCA for their PlayHQ organisation IDs — one for each.');
    process.exit(1);
  }

  const matcher = (club.playhq.clubNameMatch || 'dreamers').toLowerCase();
  const discovery: Record<string, unknown> = { discoveredAt: new Date().toISOString(), organisations: [] };
  const orgResults: unknown[] = [];

  for (const org of orgs) {
    log.step(`${org.label} — ${org.id}`);

    const seasons = await seasonsForOrganisation(org.id);
    log.ok(`${seasons.length} season(s)`);

    const seasonResults: unknown[] = [];

    for (const season of seasons) {
      // Skip long-finished seasons; keep active, upcoming and the most recent.
      const relevant = season.status === 'ACTIVE' || season.status === 'UPCOMING';
      log.info(`\n  ${season.name} [${season.status}] ${season.id}`);
      log.info(`    competition: ${season.competition?.name ?? '—'}`);
      if (!relevant) {
        log.info('    (completed — skipping grade lookup, pass --all to include)');
        if (!process.argv.includes('--all')) continue;
      }

      const [grades, teams] = await Promise.all([
        gradesForSeason(season.id),
        teamsForSeason(season.id),
      ]);

      const ourTeams = teams.filter((t) => t.club?.name?.toLowerCase().includes(matcher));

      log.info(`    grades: ${grades.length}`);
      for (const grade of grades) {
        const inGrade = ourTeams.filter((t) => t.grade?.id === grade.id);
        const mark = inGrade.length ? '  ← DREAMERS' : '';
        log.info(`      ${grade.name.padEnd(28)} ${grade.id}${mark}`);
        for (const t of inGrade) {
          log.info(`         team id: ${t.id}`);
        }
      }

      if (ourTeams.length === 0) {
        log.warn(`    no team matching "${matcher}" — check clubNameMatch in config/club.json`);
      } else if (!club.playhq.clubId && ourTeams[0].club?.id) {
        log.ok(`    club id: ${ourTeams[0].club.id}  ← put this in config/club.json`);
      }

      seasonResults.push({
        id: season.id,
        name: season.name,
        status: season.status,
        competition: season.competition?.name ?? null,
        grades: grades.map((g) => ({
          id: g.id,
          name: g.name,
          ourTeams: ourTeams
            .filter((t) => t.grade?.id === g.id)
            .map((t) => ({ id: t.id, club: t.club?.name })),
        })),
      });
    }

    orgResults.push({ label: org.label, id: org.id, seasons: seasonResults });
  }

  discovery.organisations = orgResults;
  const out = resolve(DATA_DIR, 'discovery.json');
  await writeJson(out, discovery);

  log.step('Done');
  log.info(`Written to ${out}`);
  log.info('Copy the grade and team IDs into config/season-2026-27.json, then run:');
  log.info('  npm run playhq:all');
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
