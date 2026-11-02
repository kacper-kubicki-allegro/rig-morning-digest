export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: 'ok' | 'retry' | 'fail';
  lastError: string | null;
  // Original log timestamps, including their offsets; never normalized to UTC.
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  // One row per job, sorted by job for both HTML and JSON consumers.
  rows: DigestRow[];
  badLines: number;
  // Counts of valid log entries by status, not counts of jobs' last statuses.
  counts: { ok: number; retry: number; fail: number };
};

// Contract only: issue #2 implements the runtime export in src/digest/reader.ts.
// Read runsDir/<night>.jsonl synchronously; null means missing, not empty.
// An empty file yields no rows, no bad lines, and zero status counts.
export declare function readNight(runsDir: string, night: string): DigestNight | null;
