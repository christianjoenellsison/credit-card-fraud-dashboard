export const actions = {
  allow: 'Allow',
  review: 'Escalate for review',
  block: 'Block (simulated)',
};

export function classify(score, thresholds) {
  if (score >= thresholds.block) return 'block';
  if (score >= thresholds.review) return 'review';
  return 'allow';
}

export function summarizeCases(cases) {
  const counts = { allow: 0, review: 0, block: 0 };
  let fraud = 0;
  let truePositives = 0;
  let falsePositives = 0;

  for (const item of cases) {
    counts[item.action] += 1;
    fraud += item.label;
    if (item.action !== 'allow') {
      truePositives += item.label;
      falsePositives += 1 - item.label;
    }
  }

  return {
    counts,
    fraud,
    truePositives,
    recall: truePositives / (fraud || 1),
    precision: truePositives / (truePositives + falsePositives || 1),
    falsePositiveRate: falsePositives / (cases.length - fraud || 1),
  };
}
