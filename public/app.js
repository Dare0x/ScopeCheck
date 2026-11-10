const $ = id => document.getElementById(id);
const ui = {
  form: $('review-form'), repository: $('repository'), release: $('release'), criteria: $('criteria'),
  deal: $('deal'), milestone: $('milestone'), plan: $('plan-button'), review: $('review-button'),
  complete: $('complete-example'), missing: $('missing-example'), error: $('error'), engine: $('serv-status'),
  source: $('plan-source'), decision: $('decision'), verdict: $('verdict'), copy: $('decision-copy'),
  commit: $('commit'), checks: $('checks'), escrow: $('escrow'),
  comparison: $('release-comparison'), desk: $('review-desk'),
};
const exampleRows = [
  { line: 'Publish a GitHub release.', kind: 'release', expected: '' },
  { line: 'Attach gh_2.80.0_checksums.txt to the release.', kind: 'asset', expected: 'gh_2.80.0_checksums.txt' },
];
const examples = {
  missing: { tag: 'v2.79.0', commit: '6b19a854710ff2c81070f109f35434cd20e40115', attachment: false },
  complete: { tag: 'v2.80.0', commit: 'fdd9e7646b7b8ce1d77f738e412ffc608c2f0545', attachment: true },
};
const sampleRepo = 'cli/cli';
const sampleUrl = tag => 'https://github.com/' + sampleRepo + '/releases/tag/' + tag;
const checkTypes = { release: 'Published GitHub release', asset: 'Exact release attachment', ci: 'Exact GitHub Actions check', manual: 'Manual review' };
const statuses = { verified: 'Verified', hold: 'Hold', manual: 'Manual review' };
const controls = [ui.repository, ui.release, ui.criteria, ui.deal, ui.milestone, ui.complete, ui.missing];

let plan;
let sample;
let busy = false;
let servConfigured = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function setError(message = '') {
  ui.error.textContent = message;
  ui.error.hidden = !message;
}

function decision(state, title, detail) {
  ui.decision.dataset.state = state;
  ui.verdict.textContent = title;
  ui.copy.textContent = detail;
}

function refreshControls() {
  for (const control of controls) control.disabled = busy;
  ui.plan.disabled = busy || !servConfigured;
  ui.review.disabled = busy || !plan;
}

function sourceLink(url, label) {
  const link = node('a', label, 'check-source');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

function checkElement(check) {
  const item = node('li');
  const row = node('div', '', 'check-row');
  const status = node('span', statuses[check.status] ?? 'Planned', 'check-status');
  status.dataset.status = check.status ?? 'planned';
  row.append(node('span', check.line, 'check-title'), status);
  item.append(row, node('p', check.detail ?? checkTypes[check.kind] + (check.expected ? ' · ' + check.expected : ''), 'check-detail'));
  if (check.source) item.append(sourceLink(check.source, 'Open evidence ↗'));
  return item;
}

function renderChecklist() {
  ui.commit.hidden = true;
  ui.escrow.hidden = true;
  ui.checks.replaceChildren(...(plan ?? []).map(checkElement));
  if (!plan) {
    ui.source.textContent = 'No checklist';
    decision('pending', 'Checklist needed', 'Build a checklist from the criteria, then confirm it by checking the release.');
  } else {
    ui.source.textContent = sample ? 'Example checklist · live GitHub' : 'Checklist generated with SERV Reasoning';
    decision('pending', 'Review pending', 'Review the checklist below, then check the submitted release.');
  }
  refreshControls();
}

function chooseExample(choice) {
  sample = choice;
  plan = exampleRows;
  ui.repository.value = sampleRepo;
  ui.release.value = sampleUrl(examples[choice].tag);
  ui.criteria.value = exampleRows.map(row => row.line).join('\n');
  ui.deal.value = '';
  ui.milestone.value = '1';
  ui.complete.setAttribute('aria-pressed', String(choice === 'complete'));
  ui.missing.setAttribute('aria-pressed', String(choice === 'missing'));
  setError();
  renderChecklist();
}

function savedReceipt({ tag, commit, attachment }) {
  const source = sampleUrl(tag);
  const [releaseCheck, assetCheck] = exampleRows;
  return {
    verdict: attachment ? 'ready' : 'hold',
    commit,
    commitUrl: 'https://github.com/' + sampleRepo + '/commit/' + commit,
    checks: [
      { ...releaseCheck, status: 'verified', detail: 'Published release resolves to commit ' + commit.slice(0, 12) + '.', source },
      { ...assetCheck, status: attachment ? 'verified' : 'hold', source,
        detail: attachment ? 'The required checksum file is attached to this release.' : 'The required checksum file is missing from this release.' },
    ],
  };
}

function comparisonColumn(choice, example) {
  const report = savedReceipt(example);
  const column = node('article', '', 'comparison-column');
  column.dataset.verdict = report.verdict;
  const header = node('div', '', 'comparison-release');
  const heading = node('h3', example.tag);
  header.append(heading, sourceLink(report.commitUrl, example.commit.slice(0, 8) + ' ↗'));
  const summary = node('div', '', 'comparison-decision');
  const verified = report.checks.filter(check => check.status === 'verified').length;
  summary.append(
    node('strong', report.verdict === 'ready' ? 'Ready for review' : 'Hold for review'),
    node('span', verified + ' of ' + report.checks.length + ' verified')
  );
  const evidence = node('ul', '', 'comparison-checks');
  for (const [index, check] of report.checks.entries()) {
    const item = node('li', '', 'comparison-check');
    item.dataset.status = check.status;
    const mark = node('span', check.status === 'verified' ? '✓' : '×', 'comparison-mark');
    mark.setAttribute('aria-hidden', 'true');
    const label = index === 0 ? 'Release published' : example.attachment ? 'Checksum file attached' : 'Checksum file missing';
    item.append(mark, node('span', label));
    evidence.append(item);
  }
  const open = node('button', 'Inspect receipt →', 'receipt-link');
  open.type = 'button';
  open.setAttribute('aria-label', 'Inspect ' + example.tag + ' receipt');
  controls.push(open);
  open.addEventListener('click', () => {
    chooseExample(choice);
    finishReview(report);
    ui.source.textContent = 'Saved GitHub evidence · 10 Nov 2026';
    ui.desk.open = true;
    ui.decision.focus();
  });
  column.append(header, summary, evidence, open);
  return column;
}

async function request(path, data) {
  const result = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const response = await result.json();
  if (!result.ok) throw new Error(response.error || 'The request failed.');
  return response;
}

function setBusy(value) {
  busy = value;
  refreshControls();
}

function finishReview(report) {
  const verified = report.checks.filter(check => check.status === 'verified').length;
  const count = verified + ' of ' + report.checks.length + ' requirements verified.';
  if (report.verdict === 'ready') {
    decision('ready', 'Ready for client review', count + ' Review the evidence before releasing funds.');
  } else {
    decision('hold', 'Hold for review', count + ' Resolve the outstanding evidence before approving.');
  }
  ui.checks.replaceChildren(...report.checks.map(checkElement));
  if (report.commitUrl) {
    ui.commit.href = report.commitUrl;
    ui.commit.textContent = report.commit.slice(0, 12) + ' ↗';
    ui.commit.hidden = false;
  }
  if (report.escrow) {
    const detail = report.escrow.detail + (report.escrow.block ? ' Read at block ' + report.escrow.block + '.' : '');
    ui.escrow.replaceChildren(
      node('strong', 'ScopePay milestone · ' + statuses[report.escrow.status]),
      node('p', detail, 'check-detail'),
      sourceLink(report.escrow.source, 'Open ScopePay deal ↗')
    );
    ui.escrow.hidden = false;
  }
}

ui.complete.addEventListener('click', () => chooseExample('complete'));
ui.missing.addEventListener('click', () => chooseExample('missing'));
for (const input of [ui.repository, ui.release, ui.criteria, ui.deal, ui.milestone]) {
  input.addEventListener('input', () => {
    if (input === ui.criteria) {
      plan = null;
      sample = null;
    }
    ui.complete.setAttribute('aria-pressed', 'false');
    ui.missing.setAttribute('aria-pressed', 'false');
    setError();
    renderChecklist();
  });
}

ui.plan.addEventListener('click', async () => {
  setError();
  plan = null;
  sample = null;
  ui.complete.setAttribute('aria-pressed', 'false');
  ui.missing.setAttribute('aria-pressed', 'false');
  renderChecklist();
  setBusy(true);
  decision('pending', 'Building the checklist…', 'SERV Reasoning is mapping each line to a check.');
  try {
    ({ rows: plan } = await request('/api/plan', { criteria: ui.criteria.value }));
    renderChecklist();
    ui.decision.focus();
  } catch (error) {
    renderChecklist();
    setError(error.message);
  } finally {
    setBusy(false);
  }
});

ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!plan || busy) return;
  setError();
  renderChecklist();
  const binding = ui.deal.value === '' ? null : { dealId: ui.deal.valueAsNumber, milestone: ui.milestone.valueAsNumber };
  const input = {
    repository: ui.repository.value.trim(), releaseUrl: ui.release.value.trim(),
    criteria: ui.criteria.value, rows: plan, binding,
  };
  setBusy(true);
  decision('pending', 'Checking evidence…', 'Looking up the release, its commit and the required proof.');
  try {
    finishReview(await request('/api/review', input));
    ui.decision.focus();
  } catch (error) {
    renderChecklist();
    setError(error.message);
  } finally {
    setBusy(false);
  }
});

ui.comparison.append(...Object.entries(examples).map(([choice, example]) => comparisonColumn(choice, example)));
chooseExample('complete');
try {
  const result = await fetch('/api/status');
  if (!result.ok) throw new Error();
  ({ servConfigured } = await result.json());
  ui.engine.textContent = servConfigured ? 'SERV configured' : 'SERV key needed';
  ui.engine.dataset.ready = String(servConfigured);
} catch {
  ui.engine.textContent = 'Server unavailable';
}
refreshControls();
