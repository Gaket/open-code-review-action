'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const postReview = require('../post-review.js');
const { safeFence, fencedBlock, formatComment, buildReviewComment, buildSummaryBody } =
  postReview.helpers;

test('safeFence escalates past inner backticks', () => {
  assert.strictEqual(safeFence('no ticks'), '```');
  assert.strictEqual(safeFence('has ```` four'), '`````');
});

test('fencedBlock wraps content with a language tag', () => {
  const out = fencedBlock('x = 1', 'suggestion');
  assert.ok(out.startsWith('```suggestion\n'));
  assert.ok(out.trimEnd().endsWith('```'));
});

test('formatComment appends a suggestion block when both code fields present', () => {
  const body = formatComment({
    content: 'Use const',
    existing_code: 'let a = 1',
    suggestion_code: 'const a = 1',
  });
  assert.ok(body.includes('**Suggestion:**'));
  assert.ok(body.includes('const a = 1'));
});

test('buildReviewComment maps a single line', () => {
  const rc = buildReviewComment({ path: 'a.js', content: 'x', start_line: 0, end_line: 5 });
  assert.strictEqual(rc.line, 5);
  assert.strictEqual(rc.side, 'RIGHT');
  assert.strictEqual(rc.start_line, undefined);
});

test('buildReviewComment maps a multi-line range', () => {
  const rc = buildReviewComment({ path: 'a.js', content: 'x', start_line: 3, end_line: 7 });
  assert.strictEqual(rc.start_line, 3);
  assert.strictEqual(rc.line, 7);
  assert.strictEqual(rc.start_side, 'RIGHT');
  assert.strictEqual(rc.side, 'RIGHT');
});

test('buildSummaryBody reports counts', () => {
  const body = buildSummaryBody(3, 2, 1, []);
  assert.ok(body.includes('**3**'));
  assert.ok(body.includes('2 posted as inline'));
});

test('postReview posts a clean-PR comment when there are no comments', async () => {
  process.env.OCR_RESULT_PATH = '/tmp/ocr-empty.json';
  require('node:fs').writeFileSync('/tmp/ocr-empty.json', JSON.stringify({ comments: [] }));
  const calls = [];
  const github = {
    rest: {
      issues: { createComment: async (a) => { calls.push(['issue', a]); } },
      pulls: { createReview: async (a) => { calls.push(['review', a]); } },
    },
  };
  const context = { repo: { owner: 'o', repo: 'r' }, issue: { number: 5 }, eventName: 'pull_request' };
  const core = { info() {}, warning() {} };
  await postReview({ github, context, core });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'issue');
  assert.ok(calls[0][1].body.includes('✅'));
});

test('postReview posts one inline review for a commented PR', async () => {
  process.env.OCR_RESULT_PATH = '/tmp/ocr-one.json';
  require('node:fs').writeFileSync('/tmp/ocr-one.json', JSON.stringify({
    comments: [{ path: 'a.js', content: 'bug', start_line: 0, end_line: 4 }],
  }));
  const calls = [];
  const github = {
    rest: {
      issues: { createComment: async (a) => { calls.push(['issue', a]); } },
      pulls: { createReview: async (a) => { calls.push(['review', a]); } },
    },
  };
  const context = {
    repo: { owner: 'o', repo: 'r' }, issue: { number: 5 }, eventName: 'pull_request',
    payload: { pull_request: { head: { sha: 'deadbeef' } } },
  };
  const core = { info() {}, warning() {} };
  await postReview({ github, context, core });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'review');
  assert.strictEqual(calls[0][1].commit_id, 'deadbeef');
  assert.strictEqual(calls[0][1].comments.length, 1);
  assert.strictEqual(calls[0][1].comments[0].line, 4);
});

const { MARKER } = require('../minimize-review.js');

function fullFakeGithub(calls) {
  return {
    rest: {
      issues: {
        createComment: async (a) => { calls.push(['issue', a]); },
        listComments: async () => ({ data: [] }),
      },
      pulls: {
        createReview: async (a) => { calls.push(['review', a]); },
        listReviews: async () => ({ data: [] }),
        listReviewComments: async () => ({ data: [] }),
      },
    },
    graphql: async () => ({}),
  };
}

test('postReview appends the marker to a clean-PR comment', async () => {
  process.env.OCR_RESULT_PATH = '/tmp/ocr-empty-marker.json';
  require('node:fs').writeFileSync('/tmp/ocr-empty-marker.json', JSON.stringify({ comments: [] }));
  const calls = [];
  const github = fullFakeGithub(calls);
  const context = {
    repo: { owner: 'o', repo: 'r' }, issue: { number: 5 },
    eventName: 'pull_request', payload: { pull_request: {} },
  };
  await postReview({ github, context, core: { info() {}, warning() {} } });
  assert.strictEqual(calls[0][0], 'issue');
  assert.ok(calls[0][1].body.includes(MARKER));
});

test('postReview appends the marker to inline review comment bodies', async () => {
  process.env.OCR_RESULT_PATH = '/tmp/ocr-one-marker.json';
  require('node:fs').writeFileSync('/tmp/ocr-one-marker.json', JSON.stringify({
    comments: [{ path: 'a.js', content: 'bug', start_line: 0, end_line: 4 }],
  }));
  const calls = [];
  const github = fullFakeGithub(calls);
  const context = {
    repo: { owner: 'o', repo: 'r' }, issue: { number: 5 }, eventName: 'pull_request',
    payload: { pull_request: { head: { sha: 'deadbeef' } } },
  };
  await postReview({ github, context, core: { info() {}, warning() {} } });
  assert.strictEqual(calls[0][0], 'review');
  assert.ok(calls[0][1].body.includes(MARKER));
  assert.ok(calls[0][1].comments[0].body.includes(MARKER));
});
