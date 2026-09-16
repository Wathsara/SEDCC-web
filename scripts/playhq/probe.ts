/**
 * Try a set of candidate endpoints and report what each one answers.
 *
 *   PLAYHQ_API_KEY=... tsx scripts/playhq/probe.ts --grade <uuid> [--season <uuid>]
 *
 * Exists because a 404 from PlayHQ is ambiguous — wrong path, wrong ID, or an
 * entity the key cannot see all look identical. The client's endpoint choices
 * (v1 for lists, v2 for cricket fixtures) were written from documentation, not
 * measured. This measures them.
 *
 * Prints status codes only. It never throws on a bad response, which is the
 * whole point: the failures are the data.
 */

import { CONFIG_DIR, log, readJson } from './utils.js';
import { resolve } from 'node:path';

const BASE = process.env.PLAYHQ_BASE_URL ?? 'https://api.playhq.com';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function probe(path: string, tenant: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: {
        'x-api-key': process.env.PLAYHQ_API_KEY ?? '',
        'x-phq-tenant': tenant,
        accept: 'application/json',
      },
    });
    if (!res.ok) {
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 120);
      return `${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`;
    }
    const json = (await res.json()) as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;
    const shape = Array.isArray(data)
      ? `array[${data.length}]`
      : `{${Object.keys(data).slice(0, 6).join(', ')}}`;
    return `200 OK — ${shape}`;
  } catch (err) {
    return `network error: ${(err as Error).message}`;
  }
}

/** Print the shape of the first item at a path, so a mapping can be written
 *  against the real response instead of against an assumption. */
async function dump(path: string, tenant: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'x-api-key': process.env.PLAYHQ_API_KEY ?? '',
      'x-phq-tenant': tenant,
      accept: 'application/json',
    },
  });
  if (!res.ok) {
    log.warn(`${res.status} on ${path}`);
    return;
  }
  const json = (await res.json()) as Record<string, unknown>;
  const payload = (json.data ?? json) as unknown;
  const first = Array.isArray(payload) ? payload[0] : payload;

  log.step(`Sample from ${path}`);
  if (json.metadata) log.info(`metadata: ${JSON.stringify(json.metadata)}`);
  if (Array.isArray(payload)) log.info(`${payload.length} item(s); showing the first`);
  console.log(JSON.stringify(first, null, 1).slice(0, 2600));
}

async function main() {
  if (!process.env.PLAYHQ_API_KEY) {
    log.warn('PLAYHQ_API_KEY is not set.');
    process.exit(1);
  }

  const club = await readJson<{ playhq: { tenant: string; organisationIds: Array<{ id: string }> } }>(
    resolve(CONFIG_DIR, 'club.json'),
  );
  const tenant = arg('--tenant') ?? club.playhq.tenant;
  const grade = arg('--grade');
  const season = arg('--season');
  const org = arg('--org') ?? club.playhq.organisationIds[0]?.id;

  log.step(`Probing ${BASE}  (x-phq-tenant: ${tenant})`);

  const candidates: Array<[string, string]> = [];
  if (org) candidates.push(['control: org seasons (known good)', `/v1/organisations/${org}/seasons`]);
  if (season) {
    candidates.push(['season grades', `/v1/seasons/${season}/grades`]);
    candidates.push(['season teams', `/v1/seasons/${season}/teams`]);
  }
  if (grade) {
    candidates.push(['grade fixture v1', `/v1/grades/${grade}/fixture`]);
    candidates.push(['grade fixture v2', `/v2/grades/${grade}/fixture`]);
    candidates.push(['grade ladder  v1', `/v1/grades/${grade}/ladder`]);
    candidates.push(['grade ladder  v2', `/v2/grades/${grade}/ladder`]);
    candidates.push(['grade games   v1', `/v1/grades/${grade}/games`]);
  }

  if (!candidates.length) {
    log.warn('Nothing to probe — pass --grade and/or --season.');
    process.exit(1);
  }

  // Hunt for club/team artwork across every endpoint at once, and report what
  // was found rather than leaving a human to read five JSON documents. The
  // question "does PlayHQ give us team logos" deserves a yes or no, not a
  // dump.
  if (process.argv.includes('--images')) {
    const paths: Array<[string, string]> = [];
    if (org) paths.push(['organisation seasons', `/v1/organisations/${org}/seasons`]);
    if (season) {
      paths.push(['season teams', `/v1/seasons/${season}/teams`]);
      paths.push(['season grades', `/v1/seasons/${season}/grades`]);
    }
    if (grade) {
      paths.push(['grade games', `/v1/grades/${grade}/games`]);
      paths.push(['grade ladder', `/v2/grades/${grade}/ladder`]);
    }

    const IMAGEY = /(logo|image|icon|avatar|photo|media|crest|badge|thumbnail|picture|banner)/i;
    const URLISH = /^https?:\/\//i;
    let found = 0;

    for (const [label, path] of paths) {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          'x-api-key': process.env.PLAYHQ_API_KEY ?? '',
          'x-phq-tenant': tenant,
          accept: 'application/json',
        },
      });
      if (!res.ok) {
        log.info(`  · ${label.padEnd(22)} ${res.status} ${path}`);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      const payload = json.data ?? json;

      const hits: string[] = [];
      const seenKeys = new Set<string>();
      const walk = (node: unknown, trail: string) => {
        if (Array.isArray(node)) {
          node.slice(0, 40).forEach((x) => walk(x, `${trail}[]`));
          return;
        }
        if (!node || typeof node !== 'object') return;
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          const here = trail ? `${trail}.${k}` : k;
          seenKeys.add(k);
          if (IMAGEY.test(k) || (typeof v === 'string' && URLISH.test(v) && IMAGEY.test(v))) {
            hits.push(`${here} = ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 200));
          }
          walk(v, here);
        }
      };
      walk(payload, '');

      const n = Array.isArray(payload) ? payload.length : 1;
      if (hits.length) {
        found += hits.length;
        log.ok(`  ${label} — ${hits.length} image field(s) in ${n} item(s):`);
        for (const h of [...new Set(hits)].slice(0, 12)) log.info(`      ${h}`);
      } else {
        log.info(`  · ${label.padEnd(22)} no image fields (${n} item(s), ${seenKeys.size} distinct keys)`);
        log.info(`      keys: ${[...seenKeys].sort().join(', ')}`.slice(0, 400));
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    log.step(
      found
        ? `Found ${found} image field(s) — team artwork IS available.`
        : 'No image fields on any endpoint — PlayHQ does not expose team logos here.',
    );
    return;
  }

  const dumpPath = arg('--dump');
  if (dumpPath) {
    await dump(dumpPath, tenant);
    return;
  }

  for (const [label, path] of candidates) {
    const result = await probe(path, tenant);
    const mark = result.startsWith('200') ? '✓' : '·';
    log.info(`  ${mark} ${label.padEnd(34)} ${path}`);
    log.info(`      ${result}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

main().catch((err) => {
  log.warn(String(err));
  process.exit(1);
});
