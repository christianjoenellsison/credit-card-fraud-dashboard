import { actions, summarizeCases } from './triage.js';

const pageSize = 10;
const number = new Intl.NumberFormat('en-US');
const percentage = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
const scorePercentage = new Intl.NumberFormat('en-US', {
  style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 4,
});
const byId = (id) => document.getElementById(id);
const isFraud = (label) => (label === 1 ? 'Fraud' : 'Legitimate');

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content instanceof Node) node.append(content);
  else if (content !== undefined) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function row(...cells) {
  const node = element('tr');
  node.append(...cells.map((cell) => element('td', cell)));
  return node;
}

function definition(term, value) {
  const node = element('div');
  node.append(element('dt', term), element('dd', value));
  return node;
}

function pill(action) {
  return element('span', actions[action], `pill ${action}`);
}

function renderOverview(snapshot) {
  const total = snapshot.cases.length;
  const stats = summarizeCases(snapshot.cases);
  byId('metric-transactions').textContent = number.format(total);
  byId('metric-recall').textContent = percentage.format(stats.recall);
  byId('metric-recall-note').textContent = `${stats.truePositives} of ${stats.fraud} fraud cases flagged`;
  byId('metric-precision').textContent = percentage.format(stats.precision);
  byId('metric-fpr').textContent = percentage.format(stats.falsePositiveRate);

  for (const [action, label] of Object.entries(actions)) {
    const count = stats.counts[action];
    const container = element('div', undefined, 'action-row');
    const fill = element('div', undefined, `chart-fill ${action}`);
    fill.style.width = `${100 * count / total}%`;
    const track = element('div', fill, 'chart-track');
    track.setAttribute('aria-hidden', 'true');
    container.append(element('span', label), track, element('strong', number.format(count)));
    byId('action-chart').append(container);
  }

  const { thresholds, budgets } = snapshot;
  byId('threshold-list').replaceChildren(
    definition('Allow', `< ${scorePercentage.format(thresholds.review)}`),
    definition('Escalate for review', `${scorePercentage.format(thresholds.review)} to < ${scorePercentage.format(thresholds.block)}`),
    definition('Block (simulated)', `≥ ${scorePercentage.format(thresholds.block)}`),
    definition('Tuning false-positive budgets', `${percentage.format(budgets.review)} review · ${percentage.format(budgets.block)} block`),
  );
}

function renderEvaluation(snapshot) {
  const modelNames = {
    baseline: 'Baseline XGBoost',
    weighted: 'Cost-sensitive XGBoost',
    calibrated: 'Cost-sensitive XGBoost + sigmoid calibration',
  };
  byId('model-rows').replaceChildren(...Object.entries(modelNames).map(([key, label]) => {
    const metrics = snapshot.models[key];
    return row(label, metrics.averagePrecision.toFixed(4), metrics.brierScore.toFixed(6));
  }));
  byId('importance-note').textContent = `Top 10 features by mean absolute TreeSHAP contribution to the cost-sensitive model’s raw log-odds, across ${snapshot.importanceSampleSize} held-out cases.`;
  byId('importance-rows').replaceChildren(...snapshot.globalImportance.slice(0, 10).map((item) =>
    row(item.feature, item.baseline.toFixed(4), item.weighted.toFixed(4)),
  ));
}

function openCase(item) {
  byId('case-title').textContent = item.id;
  byId('case-summary').replaceChildren(
    definition('Calibrated risk score', scorePercentage.format(item.score)),
    definition('Triage action', pill(item.action)),
    definition('Held-out test label', isFraud(item.label)),
  );
  byId('driver-rows').replaceChildren(...item.drivers.map(([feature, value]) => row(
    feature,
    element('span', `${value > 0 ? '+' : ''}${value.toFixed(5)}`, value > 0 ? 'positive' : 'negative'),
  )));
  byId('case-dialog').showModal();
}

function attachQueue(cases) {
  const search = byId('search');
  const filter = byId('action-filter');
  const previous = byId('previous');
  const next = byId('next');
  let page = 0;
  let matches = cases;

  function renderPage() {
    const start = page * pageSize;
    const visible = matches.slice(start, start + pageSize);
    const rows = visible.map((item) => {
      const button = element('button', item.id, 'case-link');
      button.type = 'button';
      button.addEventListener('click', () => openCase(item));
      return row(button, scorePercentage.format(item.score), pill(item.action), isFraud(item.label));
    });

    if (!rows.length) {
      const emptyRow = row('No transactions match these filters.');
      emptyRow.firstElementChild.colSpan = 4;
      rows.push(emptyRow);
    }

    byId('case-rows').replaceChildren(...rows);
    byId('table-count').textContent = visible.length
      ? `${number.format(start + 1)}–${number.format(start + visible.length)} of ${number.format(matches.length)} transactions`
      : '0 transactions';
    previous.disabled = page === 0;
    next.disabled = start + pageSize >= matches.length;
  }

  function updateMatches() {
    const query = search.value.trim().toUpperCase();
    const action = filter.value;
    matches = cases.filter((item) => item.id.includes(query) && (action === 'all' || item.action === action));
    page = 0;
    renderPage();
  }

  search.addEventListener('input', updateMatches);
  filter.addEventListener('change', updateMatches);
  previous.addEventListener('click', () => { page -= 1; renderPage(); });
  next.addEventListener('click', () => { page += 1; renderPage(); });
  updateMatches();
}

function syncNavigation() {
  const hash = window.location.hash || '#overview';
  for (const link of document.querySelectorAll('.nav-link')) {
    const active = link.hash === hash;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

async function start() {
  const status = byId('load-status');
  try {
    const response = await fetch(new URL('./data/snapshot.json', import.meta.url));
    if (!response.ok) throw new Error(`Snapshot request returned ${response.status}`);
    const snapshot = await response.json();
    if (snapshot.schemaVersion !== 1 || snapshot.dataMode !== 'synthetic' || !snapshot.cases?.length) {
      throw new Error('Unexpected dashboard data');
    }
    renderOverview(snapshot);
    attachQueue(snapshot.cases);
    renderEvaluation(snapshot);
    byId('dashboard').hidden = false;
    status.hidden = true;
    window.addEventListener('hashchange', syncNavigation);
    syncNavigation();
    const section = document.getElementById(window.location.hash.slice(1));
    if (section) section.scrollIntoView();
  } catch (error) {
    console.error(error);
    status.textContent = 'The experiment could not be loaded. Refresh the page to try again.';
  }
}

start();
