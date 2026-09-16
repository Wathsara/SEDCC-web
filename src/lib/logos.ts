/*
  Loaded by glob rather than by a direct import so the site still builds before
  the first sync has run — a bare `import ... from 'logos.json'` is a hard
  build failure when the file is not there, which takes the whole deploy down
  over data that is, by design, machine-written and regenerable.
*/
const logoModules = import.meta.glob<{ default: unknown }>('../../data/playhq/logos.json', {
  eager: true,
});
const logosData = (Object.values(logoModules)[0]?.default ?? { logos: {} }) as unknown;
import { url } from './site';

export interface LogoEntry {
  name: string;
  file: string;
  teamIds: string[];
  matchKey: string;
  source: string;
}

const logosIndex = ((logosData as unknown as { logos: Record<string, LogoEntry> })?.logos) ?? {};

export function normalizeMatchKey(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\s*-\s*\d+\s*$/, ' ')
    .replace(/\b\d+\s*(st|nd|rd|th)\s*xi\b/gi, ' ')
    .replace(/\bxi\b/gi, ' ')
    .replace(/\b(cc|sc|cricket|club|senior|seniors|men|women|grade\s*\d*\w*)\b/gi, ' ')
    .replace(/[^a-z0-9]/g, '');
}

const byTeamId = new Map<string, string>();
const byMatchKey = new Map<string, string>();

for (const entry of Object.values(logosIndex)) {
  const filename = entry.file?.split('/').pop();
  if (!filename) continue;
  const webPath = url(`playhq/logos/${filename}`);
  if (entry.matchKey) {
    byMatchKey.set(entry.matchKey, webPath);
  }
  for (const tid of entry.teamIds ?? []) {
    byTeamId.set(tid, webPath);
  }
}

/**
 * Returns the public web path to a club's official PlayHQ logo crest if available.
 */
export function getClubLogo(teamName: string, teamId?: string | null): string | null {
  if (!teamName) return null;

  // Check direct team ID
  if (teamId && byTeamId.has(teamId)) {
    return byTeamId.get(teamId)!;
  }

  // Check normalized match key
  const key = normalizeMatchKey(teamName);
  if (byMatchKey.has(key)) {
    return byMatchKey.get(key)!;
  }

  // Partial match fallback
  for (const [mk, path] of byMatchKey.entries()) {
    if (mk.length >= 4 && (key.includes(mk) || mk.includes(key))) {
      return path;
    }
  }

  return null;
}
