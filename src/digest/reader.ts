import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow } from './types.js';

type RunEntry = {
  at: string;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error?: string;
};

function parseEntry(line: string): RunEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  if (!('at' in value) || typeof value.at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.at)
    || value.at.trim() !== value.at || !Number.isFinite(Date.parse(value.at))) return null;
  if (!('job' in value) || typeof value.job !== 'string' || value.job.trim() === '') return null;
  if (!('status' in value)
    || (value.status !== 'ok' && value.status !== 'retry' && value.status !== 'fail')) return null;
  if (!('owner' in value) || (value.owner !== null && typeof value.owner !== 'string')) return null;
  const error = 'error' in value ? value.error : undefined;
  if (error !== undefined && typeof error !== 'string') return null;

  return {
    at: value.at,
    job: value.job,
    status: value.status,
    owner: value.owner,
    error,
  };
}

export function readNight(runsDir: string, night: string): DigestNight | null {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const result: DigestNight = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; first: number; last: number }>();
  const lines = content === '' ? [] : content.split(/\r?\n/);
  // A final newline terminates a record; it does not add a blank record.
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    const entry = parseEntry(line);
    if (entry === null) {
      result.badLines++;
      continue;
    }

    result.counts[entry.status]++;
    const at = Date.parse(entry.at);
    const existing = jobs.get(entry.job);
    if (!existing) {
      jobs.set(entry.job, {
        row: {
          job: entry.job,
          owner: entry.owner,
          runs: 1,
          retries: entry.status === 'retry' ? 1 : 0,
          lastStatus: entry.status,
          lastError: entry.error ?? null,
          firstAt: entry.at,
          lastAt: entry.at,
        },
        first: at,
        last: at,
      });
      continue;
    }

    existing.row.runs++;
    if (entry.status === 'retry') existing.row.retries++;
    if (at < existing.first) {
      existing.first = at;
      existing.row.firstAt = entry.at;
    }
    // For equal instants, the later log line wins the latest-entry fields.
    if (at >= existing.last) {
      existing.last = at;
      existing.row.owner = entry.owner;
      existing.row.lastStatus = entry.status;
      existing.row.lastError = entry.error ?? null;
      existing.row.lastAt = entry.at;
    }
  }

  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
}
