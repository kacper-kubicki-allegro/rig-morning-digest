import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const entry = {
  at: '2026-10-29T01:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook',
};

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeLines(entries: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), entries.map(value => JSON.stringify(value)).join('\n'));
  }

  it('reads the real fixture with five sorted jobs and one bad line', () => {
    const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
    expect(readNight(fixtures, night)).toEqual({
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('distinguishes a missing file from an empty night', () => {
    expect(readNight(runsDir, night)).toBeNull();
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('uses instants rather than file or lexical order and preserves original offsets', () => {
    writeLines([
      { ...entry, at: '2026-10-29T01:30:00-02:00', status: 'fail', owner: null, error: 'latest failure' },
      { ...entry, at: '2026-10-29T03:00:00+02:00', status: 'retry', error: 'earliest retry' },
      { ...entry, at: '2026-10-29T02:00:00Z', status: 'retry', error: 'middle retry' },
      { ...entry, job: 'alpha', owner: null },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      badLines: 0, counts: { ok: 1, retry: 2, fail: 1 },
      rows: [
        { job: 'alpha', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: entry.at, lastAt: entry.at },
        { job: 'lane/sync', owner: null, runs: 3, retries: 2, lastStatus: 'fail', lastError: 'latest failure',
          firstAt: '2026-10-29T03:00:00+02:00', lastAt: '2026-10-29T01:30:00-02:00' },
      ],
    });
  });

  it('uses the later line for equal instants and clears an earlier error', () => {
    writeLines([
      { ...entry, status: 'fail', error: 'failed' },
      { ...entry, at: '2026-10-29T00:00:00Z', owner: null },
    ]);
    expect(readNight(runsDir, night)?.rows).toEqual([
      { job: entry.job, owner: null, runs: 2, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: entry.at, lastAt: '2026-10-29T00:00:00Z' },
    ]);
  });

  it('counts malformed JSON and invalid records without polluting aggregation', () => {
    const invalid = [
      null, [], 42, 'text', {},
      { ...entry, at: 'not a timestamp' },
      { ...entry, at: '2026-10-29T01:00:00' },
      { ...entry, at: '2026-99-29T01:00:00Z' },
      { ...entry, job: 42 }, { ...entry, job: '' },
      { ...entry, status: 'unknown' }, { ...entry, owner: undefined },
      { ...entry, owner: 42 }, { ...entry, error: null }, { ...entry, error: 42 },
    ];
    const lines = [JSON.stringify(entry), '{broken', ...invalid.map(value => JSON.stringify(value)), '', '   ',
      JSON.stringify({ ...entry, status: 'retry', extra: true })];
    writeFileSync(join(runsDir, `${night}.jsonl`), `${lines.join('\r\n')}\r\n`);
    expect(readNight(runsDir, night)).toEqual({
      badLines: invalid.length + 3, counts: { ok: 1, retry: 1, fail: 0 },
      rows: [{ job: entry.job, owner: 'rook', runs: 2, retries: 1, lastStatus: 'retry', lastError: null,
        firstAt: entry.at, lastAt: entry.at }],
    });
  });

  it('returns zero counts and no rows when every line is bad', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), 'broken\nnull\n');
    expect(readNight(runsDir, night)).toEqual({ rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it.each(['../2026-10-28', '/2026-10-28', '..\\2026-10-28', '2026-10-28/../../secret',
    '2026-10-28\0', '2026-10-28.jsonl', '2026-10-28\n'])('rejects unsafe night %j before accessing files', unsafe => {
    // ENOTDIR would throw if an invalid name reached the filesystem.
    const notDirectory = join(runsDir, 'file');
    writeFileSync(notDirectory, '');
    expect(readNight(notDirectory, unsafe)).toBeNull();
  });

  it('does not hide unrelated filesystem errors', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
    const notDirectory = join(runsDir, 'file');
    writeFileSync(notDirectory, '');
    expect(() => readNight(notDirectory, night)).toThrow();
  });
});
