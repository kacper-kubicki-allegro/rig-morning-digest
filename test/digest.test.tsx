import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestNight } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+01:00';
const lastAt = '2026-10-28T01:03:00+01:00';
const entries = [
  { at: firstAt, job: 'delta', status: 'retry', owner: 'rook', error: 'busy' },
  { at: firstAt, job: 'charlie', status: 'ok', owner: null },
  { at: firstAt, job: 'bravo', status: 'retry', owner: 'ada', error: 'busy' },
  { at: firstAt, job: 'alpha', status: 'fail', owner: 'lin', error: 'disk full' },
  { at: '2026-10-28T01:01:00+01:00', job: 'delta', status: 'retry', owner: 'rook', error: 'busy' },
  { at: '2026-10-28T01:01:00+01:00', job: 'bravo', status: 'retry', owner: 'ada', error: 'busy' },
  { at: '2026-10-28T01:02:00+01:00', job: 'delta', status: 'retry', owner: 'rook', error: 'busy' },
  { at: lastAt, job: 'bravo', status: 'ok', owner: 'ada' },
  { at: lastAt, job: 'delta', status: 'ok', owner: 'rook' },
];
const log = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
const expected: DigestNight = {
  rows: [
    { job: 'alpha', owner: 'lin', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full', firstAt, lastAt: firstAt },
    { job: 'bravo', owner: 'ada', runs: 3, retries: 2, lastStatus: 'ok', lastError: null, firstAt, lastAt },
    { job: 'charlie', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt },
    { job: 'delta', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null, firstAt, lastAt },
  ],
  badLines: 0,
  counts: { ok: 3, retry: 5, fail: 1 },
};

// Read table rows without a browser dependency; ignore the header row.
function jobRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
    .map(([row]) => ({
      html: row,
      job: row.match(/<td\b[^>]*>([\s\S]*?)<\/td>/)?.[1].replace(/<[^>]*>/g, '').trim(),
    }))
    .filter((row) => row.job !== undefined);
}

describe('digest routes', () => {
  let config: RigConfig;

  beforeEach(() => {
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir: mkdtempSync(join(tmpdir(), 'rig-digest-')),
    };
    writeFileSync(join(config.runsDir, `${night}.jsonl`), log);
  });

  afterEach(() => {
    rmSync(config.runsDir, { recursive: true, force: true });
  });

  it('renders a valid night as HTML in the usual layout', async () => {
    const res = await createApp(config).request(`/digest/${night}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<header>');
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(jobRows(html).map((row) => row.job)).toEqual(expected.rows.map((row) => row.job));
  });

  it('returns the full DigestNight contract as JSON', async () => {
    const res = await createApp(config).request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(expected);
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing night at %s', async (route) => {
    const res = await createApp(config).request(`${route}/2026-10-27`);
    expect(res.status).toBe(404);
  });

  it('renders an empty night as nothing ran and returns empty JSON rows', async () => {
    writeFileSync(join(config.runsDir, `${night}.jsonl`), '');
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('nothing ran');
    expect(jobRows(html)).toEqual([]);
    expect(await json.json()).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts a bad line between valid entries while both routes still return the jobs', async () => {
    const lines = log.trimEnd().split('\n');
    lines.splice(2, 0, '{not json');
    writeFileSync(join(config.runsDir, `${night}.jsonl`), lines.join('\n') + '\n');
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    expect(jobRows(await page.text()).map((row) => row.job)).toEqual(expected.rows.map((row) => row.job));
    expect(await json.json()).toEqual({ ...expected, badLines: 1 });
  });

  it('keeps HTML/JSON order, missing owners, warning thresholds and timestamp offsets', async () => {
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const rows = jobRows(await page.text());
    const digest: DigestNight = await json.json();
    expect(rows.map((row) => row.job)).toEqual(digest.rows.map((row) => row.job));
    expect(rows.map((row) => row.job)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);

    const warning = /class=["'][^"']*\bwarn\b[^"']*["']/;
    for (const row of rows) {
      if (row.job === 'alpha' || row.job === 'delta') {
        expect(row.html).toMatch(warning);
      } else {
        expect(row.html).not.toMatch(warning);
      }
      expect(row.html).toContain(firstAt);
    }
    expect(rows.find((row) => row.job === 'alpha')?.html).toContain('disk full');
    expect(rows.find((row) => row.job === 'charlie')?.html).toMatch(/<td\b[^>]*>(?:\s|<[^>]*>)*—(?:\s|<[^>]*>)*<\/td>/);
    expect(rows.find((row) => row.job === 'bravo')?.html).toContain(lastAt);
    expect(rows.find((row) => row.job === 'delta')?.html).toContain(lastAt);
    expect(digest.rows.find((row) => row.job === 'charlie')?.owner).toBeNull();
    expect(digest.rows.map((row) => [row.firstAt, row.lastAt])).toEqual(
      expected.rows.map((row) => [row.firstAt, row.lastAt]),
    );
  });
});
