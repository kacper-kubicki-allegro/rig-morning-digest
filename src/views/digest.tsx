import type { DigestNight } from '../digest/types.js';

export function Digest({ night, digest }: { night: string; digest: DigestNight }) {
  return (
    <>
      <h1>digest · {night}</h1>
      <p>
        ok: {digest.counts.ok} · retry: {digest.counts.retry} · fail: {digest.counts.fail}
        {' · '}<span class={digest.badLines > 0 ? 'warn' : 'mute'}>bad lines: {digest.badLines}</span>
      </p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">first time</th>
              <th scope="col">last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td>{row.retries >= 3 ? <strong class="warn">{row.retries}</strong> : row.retries}</td>
                <td>{row.lastStatus === 'fail' ? <strong class="warn">{row.lastStatus}</strong> : row.lastStatus}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt ?? '—'}</td>
                <td>{row.lastAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
