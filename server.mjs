import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { criteriaLines, githubReader, ReviewError, reviewRelease, validatePlan } from './lib/review.mjs';
import { planWithServ } from './lib/serv.mjs';
import { prepareEscrow } from './lib/escrow.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);
const config = {
  key: process.env.SERV_REASONING_API_KEY,
  model: process.env.SERV_MODEL || 'gpt-5.4-mini',
};
const port = Number(process.env.PORT || 4180);
const common = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function json(res, status, data) {
  res.writeHead(status, { ...common, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new ReviewError('Send this request as JSON.', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16000) throw new ReviewError('The request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ReviewError('The request body must be a JSON object.');
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!["localhost:" + port, "127.0.0.1:" + port].includes(req.headers.host)) {
      return json(res, 403, { error: 'Open ScopeCheck on localhost.' });
    }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path);
      const contents = await readFile(new URL('./public/' + file, import.meta.url));
      res.writeHead(200, { ...common, 'Content-Type': type });
      res.end(contents);
      return;
    }
    if (req.method === 'GET' && path === '/api/status') {
      return json(res, 200, { servConfigured: Boolean(config.key) });
    }
    if (req.method === 'POST' && path === '/api/plan') {
      const { criteria } = await body(req);
      const rows = await planWithServ(criteriaLines(criteria), config);
      return json(res, 200, { rows });
    }
    if (req.method === 'POST' && path === '/api/review') {
      const { criteria, rows, repository, releaseUrl, binding } = await body(req);
      const plan = validatePlan(criteriaLines(criteria), rows);
      const readBinding = prepareEscrow(binding, releaseUrl);
      const review = await reviewRelease({ repository, releaseUrl, rows: plan, get: githubReader(), readBinding });
      return json(res, 200, review);
    }
    return json(res, 404, { error: 'Page not found.' });
  } catch (error) {
    if (!(error instanceof ReviewError)) console.error('Request failed:', error?.name ?? 'Error');
    return json(res, error.status || 500, {
      error: error instanceof ReviewError ? error.message : 'Review could not be completed. Try again.',
    });
  }
});
// An unauthenticated paid inference endpoint is suitable only for this local preview.
server.listen(port, '127.0.0.1', () => console.log('ScopeCheck · http://127.0.0.1:' + port));
