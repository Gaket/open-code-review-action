'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const decideSkip = require('../skip-gate.js');

function prCtx(pr) {
  return { eventName: 'pull_request', payload: { pull_request: pr } };
}
const noInputs = { skipDraft: 'false', skipLabels: '', skipTitleKeywords: '' };

test('issue_comment always reviews (override)', () => {
  const r = decideSkip({
    context: { eventName: 'issue_comment', payload: {} },
    inputs: { skipDraft: 'true', skipLabels: 'x', skipTitleKeywords: 'y' },
  });
  assert.strictEqual(r.skip, false);
});

test('skips draft when skip_draft=true', () => {
  const r = decideSkip({
    context: prCtx({ draft: true, labels: [], title: 'x' }),
    inputs: { ...noInputs, skipDraft: 'true' },
  });
  assert.strictEqual(r.skip, true);
  assert.match(r.reason, /draft/);
});

test('does not skip draft when skip_draft=false', () => {
  const r = decideSkip({
    context: prCtx({ draft: true, labels: [], title: 'x' }),
    inputs: { ...noInputs, skipDraft: 'false' },
  });
  assert.strictEqual(r.skip, false);
});

test('skips on matching label, case-insensitive', () => {
  const r = decideSkip({
    context: prCtx({ draft: false, labels: [{ name: 'No-AI-Review' }], title: 'x' }),
    inputs: { ...noInputs, skipLabels: 'no-ai-review, wip' },
  });
  assert.strictEqual(r.skip, true);
  assert.match(r.reason, /label/);
});

test('does not skip when no label matches', () => {
  const r = decideSkip({
    context: prCtx({ draft: false, labels: [{ name: 'bug' }], title: 'x' }),
    inputs: { ...noInputs, skipLabels: 'no-ai-review' },
  });
  assert.strictEqual(r.skip, false);
});

test('skips on matching title keyword, case-insensitive', () => {
  const r = decideSkip({
    context: prCtx({ draft: false, labels: [], title: 'WIP: refactor [Skip Review]' }),
    inputs: { ...noInputs, skipTitleKeywords: '[skip review]' },
  });
  assert.strictEqual(r.skip, true);
  assert.match(r.reason, /keyword/);
});

test('fails open when pull_request payload missing', () => {
  const r = decideSkip({
    context: { eventName: 'pull_request', payload: {} },
    inputs: { ...noInputs, skipDraft: 'true' },
  });
  assert.strictEqual(r.skip, false);
});

test('reviews normally with empty inputs', () => {
  const r = decideSkip({
    context: prCtx({ draft: false, labels: [{ name: 'bug' }], title: 'normal' }),
    inputs: noInputs,
  });
  assert.strictEqual(r.skip, false);
});
