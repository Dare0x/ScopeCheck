import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criteriaLines, parseRelease, reviewRelease, validatePlan } from '../lib/review.mjs';
import { planWithServ } from '../lib/serv.mjs';

const sha = 'a'.repeat(40);
const tagObject = 'b'.repeat(40);
const repository = 'owner/repo';
const releaseUrl = 'https://github.com/owner/repo/releases/tag/v1.2.3';
const rows = [
  { line: 'Publish the GitHub release.', kind: 'release', expected: '' },
  { line: 'Attach checksums.txt.', kind: 'asset', expected: 'checksums.txt' },
  { line: 'Require the Build check to pass.', kind: 'ci', expected: 'Build' },
];

function evidence({ filename = 'checksums.txt', head = sha, conclusion = 'success', source = 'github-actions' } = {}) {
  const requests = [];
  const get = async path => {
    requests.push(path);
    if (path.includes('/releases/tags/')) {
      return { published_at: '2026-11-10T00:00:00Z', draft: false, tag_name: 'v1.2.3', assets: [{name: filename, state: 'uploaded'}] };
    }
    if (path.includes('/git/ref/')) return { object: { type: 'tag', sha: tagObject } };
    if (path.endsWith(tagObject)) return { object: { type: 'commit', sha } };
    if (path.includes('/check-runs')) {
      return { total_count: 1, check_runs: [{ name: 'Build', head_sha: head, app: { slug: source }, status: 'completed', conclusion }] };
    }
    throw new Error('Unexpected request: ' + path);
  };
  return { get, requests };
}

test('verifies a published release, its attachment and a check on the resolved commit', async () => {
  const { get, requests } = evidence();
  const result = await reviewRelease({ repository, releaseUrl, rows, get });
  assert.equal(result.verdict, 'ready');
  assert.equal(result.commit, sha);
  assert.ok(requests.some(path => path.includes('/commits/' + sha + '/check-runs')));
  assert.deepEqual(result.checks.map(row => row.status), ['verified', 'verified', 'verified']);
});

test('a green check on another commit or from another app cannot clear the hold', async () => {
  for (const data of [{head: 'c'.repeat(40)}, {source: 'other-app'}, {conclusion: 'failure'}]) {
    const result = await reviewRelease({ repository, releaseUrl, rows, get: evidence(data).get });
    assert.equal(result.verdict, 'hold');
    assert.equal(result.checks[2].status, 'hold');
  }
});

test('missing files, manual criteria and failed escrow binding each block the recommendation', async () => {
  const variants = [
    { get: evidence({filename: 'wrong.txt'}).get },
    { get: evidence().get, rows: [...rows, { line: 'Looks good on mobile.', kind: 'manual', expected: '' }] },
    { get: evidence().get, verifyBinding: commit => {
      assert.equal(commit, sha);
      return {status: 'hold', detail: 'Does not match commitment.'};
    } },
  ];
  for (const variant of variants) {
    const result = await reviewRelease({ repository, releaseUrl, rows, ...variant });
    assert.equal(result.verdict, 'hold');
  }
});

test('rejects spoofed release links and avoids any fetch on a mismatched repository', async () => {
  assert.throws(() => parseRelease(repository, 'https://github.com.evil.test/owner/repo/releases/tag/v1.2.3'));
  assert.throws(() => parseRelease(repository, 'https://github.com/owner/repo'));
  const { get, requests } = evidence();
  const result = await reviewRelease({ repository: 'someone/else', releaseUrl, rows, get });
  assert.equal(result.verdict, 'hold');
  assert.equal(requests.length, 0);
});

test('SERV must preserve each original criterion and may only use names from that criterion', async () => {
  const lines = criteriaLines(rows.map(row => row.line).join('\n'));
  assert.throws(() => validatePlan(lines, rows.slice(0, -1)));
  assert.throws(() => validatePlan(lines, [rows[0], { ...rows[1], expected: 'other.txt' }, rows[2]]));
  const request = async (url, options) => {
    assert.equal(url, 'https://inference-api.openserv.ai/v1/chat/completions');
    assert.equal(JSON.parse(options.body).response_format.type, 'json_object');
    return new Response(JSON.stringify({ choices: [{finish_reason: 'stop', message: {content: JSON.stringify({checks: rows})}}] }));
  };
  assert.deepEqual(await planWithServ(lines, { key: 'local-test-key', model: 'gpt-5.4-mini', request }), rows);
  await assert.rejects(() => planWithServ(lines, { request }), /SERV is not configured/);
});
