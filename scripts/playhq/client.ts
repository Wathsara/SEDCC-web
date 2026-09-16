/**
 * PlayHQ public API client.
 *
 * Public endpoints only: x-api-key + x-phq-tenant, no bearer token.
 * See .claude/skills/playhq-data/SKILL.md for endpoint notes and cricket traps.
 */

import type {
  GradeGame,
  Grade,
  Ladder,
  PagedResponse,
  Season,
  SeasonTeam,
  GameSummary,
  GradeFixture,
} from './types.js';

const BASE_URL = process.env.PLAYHQ_BASE_URL ?? 'https://api.playhq.com';
const TENANT = process.env.PLAYHQ_TENANT ?? 'ca';

/** ~4 req/sec. Do not raise — PlayHQ publishes no public limit and we're guests. */
const MIN_REQUEST_INTERVAL_MS = 250;
const MAX_RETRIES = 4;

let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiKey(): string {
  const key = process.env.PLAYHQ_API_KEY;
  if (!key) {
    throw new Error(
      'PLAYHQ_API_KEY is not set.\n' +
        '  Local:  copy .env.example to .env and add the key\n' +
        '  CI:     add it as a repository secret (Settings → Secrets → Actions)\n' +
        'Credentials are requested via your association (ECA / VSCA), who ask PlayHQ.',
    );
  }
  return key;
}

async function throttle() {
  const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * One GET, with backoff on 429/5xx. Throws on 4xx (other than 429) — those are
 * our bug, not a transient failure, and retrying hides them.
 */
export async function request<T>(path: string): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'x-api-key': apiKey(),
          'x-phq-tenant': TENANT,
          accept: 'application/json',
        },
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(2 ** attempt * 1000);
      continue;
    }

    if (res.ok) return (await res.json()) as T;

    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`PlayHQ ${res.status} after ${MAX_RETRIES} retries: ${url}`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000;
      console.warn(`  ${res.status} on ${path} — retrying in ${delay}ms`);
      await sleep(delay);
      continue;
    }

    const body = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `PlayHQ ${res.status} on ${path}. Either the API key is wrong, the tenant ` +
          `is not "${TENANT}", or this is a partner-only private endpoint. ${body.slice(0, 200)}`,
      );
    }
    if (res.status === 404) {
      throw new Error(
        `PlayHQ 404 on ${path}. Three things give a 404 here, in order of ` +
        `likelihood: the key is scoped to a different organisation and simply ` +
        `cannot see this one (an ECA key cannot read VSCA grades, or vice ` +
        `versa); the season is finished and no longer public; or the ID is ` +
        `wrong. Run 'npm run playhq:discover' to see what this key CAN see. ` +
        `Check too that the ID exists and is set to VISIBLE in the ` +
          `PlayHQ admin portal — hidden entities are absent from public endpoints.`,
      );
    }
    throw new Error(`PlayHQ ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }

  throw new Error(`Unreachable: ${url}`);
}

/**
 * v1 list endpoints paginate with a cursor. Follow it to the end.
 * Never assume the first page is the whole list.
 */
export async function getAllPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;

  do {
    const sep = path.includes('?') ? '&' : '?';
    const url = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : path;
    const page = await request<PagedResponse<T>>(url);
    items.push(...(page.data ?? []));
    cursor = page.metadata?.hasMore ? page.metadata.nextCursor : undefined;
  } while (cursor);

  return items;
}

/**
 * Response shapes are inconsistent across versions: v1 lists and v2 game summary
 * wrap in `data`, v2 fixture and ladder do not.
 */
export function unwrap<T>(payload: T | { data: T }): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Endpoints. Cricket-safe set only — see the skill for what NOT to call.
// ---------------------------------------------------------------------------

export const seasonsForOrganisation = (orgId: string) =>
  getAllPages<Season>(`/v1/organisations/${orgId}/seasons`);

export const gradesForSeason = (seasonId: string) =>
  getAllPages<Grade>(`/v1/seasons/${seasonId}/grades`);

export const teamsForSeason = (seasonId: string) =>
  getAllPages<SeasonTeam>(`/v1/seasons/${seasonId}/teams`);

/**
 * Games in a grade. This is the fixture endpoint: /grades/{id}/fixture does
 * not exist on v1 or v2 — both answer "404 page not found", a router 404 —
 * while /v1/grades/{id}/games returns the full list. Verified with
 * scripts/playhq/probe.ts against a real grade.
 */
export const gamesForGrade = (gradeId: string) =>
  getAllPages<GradeGame>(`/v1/grades/${gradeId}/games`);

/** Kept for the old shape; see gamesForGrade, which is what the sync uses. */
export const fixtureForGrade = async (gradeId: string) =>
  unwrap(await request<GradeFixture | { data: GradeFixture }>(`/v2/grades/${gradeId}/fixture`));

/** v2 — headers come back with the response; do not hardcode ladder columns. */
export const ladderForGrade = async (gradeId: string) =>
  unwrap(await request<Ladder | { data: Ladder }>(`/v2/grades/${gradeId}/ladder`));

/** v2 — v1 game summary is for territory sports (AFL, basketball), not cricket. */
export const summaryForGame = async (gameId: string) =>
  unwrap(await request<{ data: GameSummary }>(`/v2/games/${gameId}/summary`));
