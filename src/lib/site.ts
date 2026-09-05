import club from '@config/club.json';
import season from '@config/season-2026-27.json';
import players from '@config/players.json';
import allTimeReal from '@config/all-time.json';

export const allTime = allTimeReal;

export { club, season, players };

export type TeamSlug = 'loc-1' | 'loc-2' | 'grade-4';

export type Team = (typeof season.teams)[number];

/** Teams the club is actually fielding this season, in config order. */
export const teams = season.teams.filter((t) => t.active);

export function teamBySlug(slug: string): Team | undefined {
  return season.teams.find((t) => t.slug === slug);
}

/**
 * Prefix an internal path with the configured base.
 *
 * GitHub Pages serves project repos from /<repo>/, so every internal href has
 * to carry the base or the deploy renders unstyled and every link 404s. Always
 * route internal links through this rather than writing "/news/" by hand.
 */
export function url(path = '/'): string {
  const base = import.meta.env.BASE_URL || '/';
  const joined = `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  // trailingSlash: 'always' — keep directory URLs ending in a slash, but leave
  // files (sitemap.xml, feed.xml) and anchors alone.
  if (joined.includes('#') || /\.[a-z0-9]+$/i.test(joined)) return joined;
  return joined.endsWith('/') ? joined : `${joined}/`;
}

export interface RosterPlayer {
  id: string;
  name: string;
  aliases: string[];
  teams: string[];
  role: string | null;
  battingStyle: string | null;
  bowlingStyle: string | null;
  joined: number | null;
  active: boolean;
  /** play.cricket.com.au public profile. Not the API's appearance id. */
  profileUrl?: string;
  playhqProfileId?: string;
  transferFrom?: string;
  /** Sheet marked these "(No ECA Games)". Stored, not published. */
  eligibleECA?: boolean;
}

/** Roster entries the club currently lists. The example row ships inactive. */
export const roster = players.players.filter((p) => p.active) as unknown as RosterPlayer[];

export function squadFor(slug: string): RosterPlayer[] {
  return roster
    .filter((p) => p.teams.includes(slug))
    .sort((a, b) => a.name.localeCompare(b.name, 'en-AU'));
}

/**
 * config/ ships with TODO placeholders the club has not filled in yet. Those
 * strings must never reach the page, so every optional bit of copy is read
 * through this and the caller falls back to something true.
 */
export function filled(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return v && !v.startsWith('TODO') ? v : undefined;
}

/** What the club says about itself, or a truthful stand-in until it says it. */
export const tagline =
  filled(club.tagline) ?? 'Senior cricket in Melbourne’s east. Three sides, two associations.';

export const suburb = filled(club.location.suburb) ?? 'Melbourne';

/* ---------------------------------------------------------------------------
   Honours boards — the two Lord's-style boards.
   ------------------------------------------------------------------------ */

export interface Honour {
  name: string;
  season: string;
  /** Batting boards carry a score, bowling boards figures. */
  score?: string;
  figures?: string;
  /** Null where the club's extract did not include it. */
  balls?: number | null;
  overs?: number | null;
  runs?: number | null;
  maidens?: number | null;
  economy?: number | null;
  fours?: number | null;
  sixes?: number | null;
  strikeRate?: number | null;
  opponent?: string;
  grade?: string;
  round?: string | null;
  dismissal?: string | null;
}



/** "2025/26" → 2025, so the newest sits at the top of the board. */
function seasonStart(season: string): number {
  const m = /^(\d{4})/.exec(season ?? '');
  return m ? Number(m[1]) : -1;
}

function board(rows: Honour[] | undefined): Honour[] {
  return [...(rows ?? [])]
    .filter((r) => filled(r.name))
    // Newest season first. Sort is stable, so the order inside a season is the
    // order the committee wrote in config/all-time.json.
    .sort((a, b) => seasonStart(b.season) - seasonStart(a.season));
}

const honoursSrc = (allTime as { honours?: { centuries?: Honour[]; fiveWicketHauls?: Honour[] } })
  .honours;

export const centuries = board(honoursSrc?.centuries);
export const fiveWicketHauls = board(honoursSrc?.fiveWicketHauls);

/* ---------------------------------------------------------------------------
   Season leaders — hand-recorded from the club's own PlayHQ aggregates, for
   seasons that predate the sync.
   ------------------------------------------------------------------------ */

export interface SeasonLeaders {
  label: string;
  grade: string;
  competitionShort: string;
  mostRuns?: { name: string; runs: number; average: number };
  mostWickets?: { name: string; wickets: number; average: number };
}

export const seasonLeaders: SeasonLeaders[] = (allTime.seasons ?? [])
  .filter((s) => (s as { leaders?: unknown }).leaders)
  .map((s) => ({
    label: s.label,
    grade: s.grade,
    competitionShort: s.competitionShort,
    ...((s as { leaders: object }).leaders as object),
  }))
  .reverse();

/* ---------------------------------------------------------------------------
   Club records — the four the landing page leads with.
   ------------------------------------------------------------------------ */

export interface ClubRecord {
  label: string;
  value: string | null;
  balls?: number | null;
  holder?: string | null;
  detail?: string | null;
  season?: string | null;
}

const allRecords: ClubRecord[] = [
  ...allTime.records.batting,
  ...allTime.records.bowling,
  ...allTime.records.team,
] as ClubRecord[];

export function record(label: string): ClubRecord | undefined {
  const r = allRecords.find((x) => x.label === label);
  return r && filled(r.value) ? r : undefined;
}

/**
 * The four all-time marks the club wants up front, with shorter labels than
 * the honour board uses. Any that has not been filled in is dropped rather
 * than rendered blank.
 */
export const headlineRecords = (
  [
    ['Highest individual score', 'Best score', 'bat'],
    ['Most runs in a season', 'Most runs in a season', 'bat'],
    ['Best bowling figures', 'Best figures', 'ball'],
    ['Most wickets in a season', 'Most wickets in a season', 'ball'],
  ] as const
)
  .map(([key, short, icon]) => {
    const r = record(key);
    return r ? { ...r, short, icon: icon as 'bat' | 'ball' } : null;
  })
  .filter((r): r is NonNullable<typeof r> => r !== null);

/* ---------------------------------------------------------------------------
   Sponsors.
   ------------------------------------------------------------------------ */

export interface Sponsor {
  name: string;
  strapline?: string | null;
  /** Given the top of the sponsors page and a larger slot on the home page. */
  featured?: boolean;
  headline?: string | null;
  /** Extra paragraphs, shown only in the featured layout. */
  body?: string[];
  logo?: string | null;
  blurb?: string | null;
  address?: string | null;
  phone?: string | null;
  phoneLabel?: string | null;
  email?: string | null;
  url?: string | null;
  /** Resolved from src/assets/sponsors/ so Astro optimises the image. */
  image?: ImageMetadata;
}

const sponsorLogos = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/sponsors/*.{png,jpg,jpeg,webp,avif,svg}',
  { eager: true },
);

const logoByFile = new Map(
  Object.entries(sponsorLogos).map(([path, mod]) => [path.split('/').pop()!, mod.default]),
);

const sponsorList =
  ((club as { sponsors?: { list?: Sponsor[] } }).sponsors?.list ?? []) as Sponsor[];

/** Every sponsor the club lists, in config order. */
export const sponsors: Sponsor[] = sponsorList
  .filter((s) => filled(s.name))
  .map((s) => ({ ...s, image: s.logo ? logoByFile.get(s.logo) : undefined }));

/** At most one sponsor is featured; the rest fill the grid. */
export const featuredSponsor = sponsors.find((s) => s.featured);
export const otherSponsors = sponsors.filter((s) => !s.featured);

/* ---------------------------------------------------------------------------
   Social accounts.
   ------------------------------------------------------------------------ */

export interface SocialLink {
  key: 'facebook' | 'instagram' | 'playhq';
  label: string;
  href: string;
}

const socialCfg = club.social as Record<string, string | null>;

/** Only accounts the club actually has; nulls are dropped, not rendered. */
const SOCIAL_ORDER: Array<{ key: SocialLink['key']; label: string }> = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'playhq', label: 'PlayHQ' },
];

export const socials: SocialLink[] = SOCIAL_ORDER.flatMap(({ key, label }) => {
  const href = filled(socialCfg[key]);
  return href ? [{ key, label, href }] : [];
});

/**
 * The home ground. This is where cricket is played — Endeavour Hills — and is
 * a different place from `suburb`, which is where the club is registered.
 * Anything telling a visitor where to turn up should use this.
 */
const groundCfg = club.location.homeGround as {
  name?: string; suburb?: string; state?: string; mapUrl?: string | null;
};

export const homeGround = filled(groundCfg?.name) ?? null;

export const homeGroundSuburb = filled(groundCfg?.suburb) ?? null;

export const homeGroundLabel = homeGround
  ? [homeGround, [homeGroundSuburb, filled(groundCfg?.state)].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ')
  : null;

export const homeGroundMapUrl = filled(groundCfg?.mapUrl);

export function playedAtHome(ground: string | null | undefined): boolean {
  return Boolean(homeGround && ground && ground.trim() === homeGround);
}

/**
 * Parts of the site that are built but not yet promoted. The pages still
 * render — only the navigation and the home-page block are withheld — so a
 * link already shared keeps working.
 */
// The block carries a _comment string alongside the booleans, so widen first.
const sectionFlags = ((club.site as unknown as { sections?: Record<string, unknown> })
  .sections ?? {}) as Record<string, unknown>;

export function sectionEnabled(key: string): boolean {
  return sectionFlags[key] !== false;
}

export const showNews = sectionEnabled('news');

/** The club's own words about itself, shown on the home page. */
export const intro = filled((club as { intro?: string }).intro);

/** The line under the club name on the home page. */
export const heroLine = filled((club as { heroLine?: string }).heroLine);

/* ---------------------------------------------------------------------------
   Vision, mission and values — from the Strategic Development Plan 2025–2030.
   ------------------------------------------------------------------------ */

export interface ClubValue {
  name: string;
  detail: string;
  icon: 'bat' | 'ball' | 'stumps' | 'trophy' | 'cap' | 'boundary';
}

export const vision = filled((club as { vision?: string }).vision);
export const mission = filled((club as { mission?: string }).mission);

export const clubValues = (((club as { values?: ClubValue[] }).values ?? []) as ClubValue[])
  .filter((v) => filled(v.name));
