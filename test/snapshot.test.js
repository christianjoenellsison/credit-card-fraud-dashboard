import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classify, summarizeCases } from '../site/triage.js';

const snapshot = JSON.parse(readFileSync(new URL('../site/data/snapshot.json', import.meta.url), 'utf8'));

test('triage uses inclusive thresholds and gives simulated block precedence', () => {
  const thresholds = { review: 0.1, block: 0.5 };
  assert.equal(classify(0.09, thresholds), 'allow');
  assert.equal(classify(0.1, thresholds), 'review');
  assert.equal(classify(0.49, thresholds), 'review');
  assert.equal(classify(0.5, thresholds), 'block');
  assert.equal(classify(0.1, { review: 0.1, block: 0.1 }), 'block');
});

test('the Pages snapshot contains only synthetic results covering the test split', () => {
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.dataMode, 'synthetic');
  assert.equal(snapshot.cases.length, snapshot.partitions.test);
  assert.equal(snapshot.cases.length, 6750);
  assert.equal(new Set(snapshot.cases.map((item) => item.id)).size, snapshot.cases.length);
  assert.ok(snapshot.thresholds.review <= snapshot.thresholds.block);
  assert.equal(snapshot.globalImportance.length, 30);

  const features = new Set(snapshot.globalImportance.map((item) => item.feature));
  let lastScore = 1;
  for (const item of snapshot.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['action', 'drivers', 'id', 'label', 'score']);
    assert.match(item.id, /^TX-\d{5}$/);
    assert.ok(item.score >= 0 && item.score <= lastScore, `${item.id} must be in descending score order`);
    assert.equal(item.action, classify(item.score, snapshot.thresholds));
    assert.ok(item.label === 0 || item.label === 1);
    assert.equal(item.drivers.length, 6);
    for (const [feature, value] of item.drivers) {
      assert.ok(features.has(feature) && Number.isFinite(value));
    }
    lastScore = item.score;
  }
});

test('alert metrics combine review and simulated block', () => {
  const stats = summarizeCases([
    { action: 'allow', label: 1 },
    { action: 'allow', label: 0 },
    { action: 'review', label: 1 },
    { action: 'review', label: 0 },
    { action: 'block', label: 1 },
  ]);
  assert.deepEqual(stats, {
    counts: { allow: 2, review: 2, block: 1 },
    fraud: 3,
    truePositives: 2,
    recall: 2 / 3,
    precision: 2 / 3,
    falsePositiveRate: 1 / 2,
  });
});
