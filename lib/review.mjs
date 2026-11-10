const kinds = new Set(['release', 'asset', 'ci', 'manual']);
const SHA = /^[0-9a-f]{40}$/i;
const repoPattern = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i;

export class ReviewError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function criteriaLines(criteria) {
  if (typeof criteria !== 'string' || criteria.length > 1800) {
    throw new ReviewError('Enter up to 1,800 characters of acceptance criteria.');
  }
  const lines = criteria.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length || lines.length > 8 || lines.some(line => line.length > 260)) {
    throw new ReviewError('Enter one to eight requirements, one per line, up to 260 characters each.');
  }
  return lines;
}

export function validatePlan(lines, rows) {
  if (!Array.isArray(rows) || rows.length !== lines.length) {
    throw new ReviewError('The checklist must cover every requirement in order.');
  }
  return rows.map((row, index) => {
    if (row?.line !== lines[index] || !kinds.has(row.kind) || typeof row.expected !== 'string') {
      throw new ReviewError('The checklist did not preserve an agreed requirement.');
    }
    const expectsName = row.kind === 'asset' || row.kind === 'ci';
    if (expectsName && (!row.expected.trim() || !row.line.includes(row.expected))) {
      throw new ReviewError('Asset and CI names must appear exactly in their requirement.');
    }
    if (!expectsName && row.expected !== '') {
      throw new ReviewError('Release and manual checks have no expected name.');
    }
    return { line: row.line, kind: row.kind, expected: row.expected };
  });
}

export function parseRelease(repository, input) {
  if (typeof repository !== 'string' || !repoPattern.test(repository)) {
    throw new ReviewError('Enter the agreed repository as owner/repo.');
  }
  if (typeof input !== 'string' || input.length > 500) {
    throw new ReviewError('Enter a public GitHub release URL.');
  }
  let url, tag;
  try {
    url = new URL(input);
    const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/releases\/tag\/(.+)$/);
    if (url.origin !== 'https://github.com' || url.username || url.password || !match) {
      throw new Error();
    }
    tag = decodeURIComponent(match[2]);
    if (!/^[a-z0-9_.\/-]{1,140}$/i.test(tag) || tag.includes('..') || !repoPattern.test(match[1])) {
      throw new Error();
    }
    if (match[1].toLowerCase() !== repository.toLowerCase()) {
      return { mismatch: true };
    }
  } catch {
    throw new ReviewError('Use a GitHub release link such as https://github.com/owner/repo/releases/tag/v1.2.3.');
  }
  const repo = repository.toLowerCase();
  return { repo, tag, url: 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(tag) };
}

export function githubReader(request = fetch, signal = AbortSignal.timeout(9000)) {
  return async (pathname) => {
    let response;
    try {
      response = await request('https://api.github.com' + pathname, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'ScopePay-Review',
        },
        redirect: 'error',
        signal,
      });
    } catch {
      if (signal.aborted) throw new ReviewError('GitHub took too long to return evidence. Try again shortly.', 504);
      throw new ReviewError('GitHub could not be reached. Try again shortly.', 502);
    }
    if (response.status === 404) return null;
    if (response.status === 403 || response.status === 429) {
      throw new ReviewError('GitHub blocked or rate limited the evidence request. Try again shortly.', 429);
    }
    if (!response.ok) throw new ReviewError('GitHub returned an error while retrieving evidence.', 502);
    try {
      return await response.json();
    } catch {
      if (signal.aborted) throw new ReviewError('GitHub took too long to return evidence. Try again shortly.', 504);
      throw new ReviewError('GitHub returned unreadable evidence. Try again shortly.', 502);
    }
  };
}

async function tagCommit(get, base, tag) {
  let object = (await get(base + '/git/ref/tags/' + encodeURIComponent(tag)))?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 4; depth++) {
    if (!SHA.test(object.sha)) return null;
    object = (await get(base + '/git/tags/' + object.sha))?.object;
  }
  return object?.type === 'commit' && SHA.test(object.sha) ? object.sha : null;
}

const rowResult = (row, status, detail, source = null) => ({ ...row, status, detail, source });

export async function reviewRelease({ repository, releaseUrl, rows, get, readBinding = null }) {
  const release = parseRelease(repository, releaseUrl);
  if (release.mismatch) {
    return {
      verdict: 'hold', commit: null,
      checks: rows.map(row => rowResult(row, 'hold', 'The submission points to a different repository than the agreement.')),
      escrow: null,
    };
  }
  const [report, matchBinding] = await Promise.all([
    inspectGitHubRelease(release, rows, get),
    readBinding?.() ?? null,
  ]);
  const escrow = report.commit && matchBinding ? matchBinding(report.commit) : null;
  const ready = report.checks.every(check => check.status === 'verified') && (!escrow || escrow.status === 'verified');
  return { ...report, verdict: ready ? 'ready' : 'hold', escrow };
}

async function inspectGitHubRelease({ repo, tag, url }, rows, get) {
  const base = '/repos/' + repo;
  const [artifact, commit] = await Promise.all([
    get(base + '/releases/tags/' + encodeURIComponent(tag)),
    tagCommit(get, base, tag),
  ]);
  const published = artifact?.published_at && artifact.draft === false && artifact.tag_name === tag;
  if (!published || !commit) {
    const detail = !published ? 'A published release with this tag was not found.' : 'The release tag could not be resolved to a commit.';
    return { commit: null, checks: rows.map(row => rowResult(row, 'hold', detail, url)) };
  }
  const commitUrl = 'https://github.com/' + repo + '/commit/' + commit;
  const checkNames = [...new Set(rows.filter(row => row.kind === 'ci').map(row => row.expected))];
  // Fetch by exact name and immutable commit, never by branch or tag.
  const ciResults = await Promise.all(checkNames.map(async name => {
    const output = await get(base + '/commits/' + commit + '/check-runs?filter=latest&per_page=100&check_name=' + encodeURIComponent(name));
    const matches = (output?.check_runs ?? []).filter(run => run.name === name && run.head_sha === commit && run.app?.slug === 'github-actions');
    return [name, { matches, complete: !output || output.total_count <= 100 }];
  }));
  const runs = new Map(ciResults);
  const checks = rows.map(row => {
    switch (row.kind) {
      case 'release':
        return rowResult(row, 'verified', 'Published release resolves to commit ' + commit.slice(0, 12) + '.', url);
      case 'asset': {
        const asset = artifact.assets?.find(item => item.name === row.expected && item.state === 'uploaded');
        return asset
          ? rowResult(row, 'verified', asset.name + ' is attached to this release.', url)
          : rowResult(row, 'hold', 'This release has no uploaded asset named ' + row.expected + '.', url);
      }
      case 'ci': {
        const { matches, complete } = runs.get(row.expected);
        if (!complete || matches.length > 1) {
          return rowResult(row, 'manual', 'More than one possible check. Confirm the required workflow manually.', commitUrl + '/checks');
        }
        const run = matches[0];
        if (!run) return rowResult(row, 'hold', 'No matching GitHub Actions check on this commit.', commitUrl + '/checks');
        const safeSource = typeof run.html_url === 'string' && run.html_url.startsWith('https://github.com/')
          ? run.html_url : commitUrl + '/checks';
        return run.status === 'completed' && run.conclusion === 'success'
          ? rowResult(row, 'verified', 'GitHub Actions reports success for this commit.', safeSource)
          : rowResult(row, 'hold', 'GitHub Actions reports ' + (run.conclusion ?? run.status) + ' for this commit.', safeSource);
      }
      default:
        return rowResult(row, 'manual', 'A person needs to confirm this requirement.');
    }
  });
  return { commit, commitUrl, checks };
}
