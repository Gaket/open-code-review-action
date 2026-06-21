'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const minimizePriorReview = require('../minimize-review.js');
const { MARKER } = minimizePriorReview;

function makeGithub({ issueComments = [], reviews = [], reviewComments = [], graphqlImpl } = {}) {
  const graphqlCalls = [];
  return {
    graphqlCalls,
    rest: {
      issues: { listComments: async () => ({ data: issueComments }) },
      pulls: {
        listReviews: async () => ({ data: reviews }),
        listReviewComments: async () => ({ data: reviewComments }),
      },
    },
    graphql: async (_query, vars) => {
      graphqlCalls.push(vars.id);
      if (graphqlImpl) return graphqlImpl(vars);
      return { minimizeComment: { minimizedComment: { isMinimized: true } } };
    },
  };
}

const ctx = { repo: { owner: 'o', repo: 'r' }, issue: { number: 7 } };
const core = { info() {}, warning() {} };

test('minimizes only marked + bot-authored items across all three sources', async () => {
  const github = makeGithub({
    issueComments: [
      { node_id: 'IC_ours', body: `hi ${MARKER}`, user: { login: 'github-actions[bot]' } },
      { node_id: 'IC_human', body: `hi ${MARKER}`, user: { login: 'alice' } },
      { node_id: 'IC_unmarked', body: 'hi', user: { login: 'github-actions[bot]' } },
    ],
    reviews: [
      { node_id: 'PR_ours', body: `summary ${MARKER}`, user: { login: 'github-actions[bot]' } },
    ],
    reviewComments: [
      { node_id: 'RC_ours', body: `inline ${MARKER}`, user: { login: 'github-actions[bot]' } },
    ],
  });
  const n = await minimizePriorReview({ github, context: ctx, core });
  assert.strictEqual(n, 3);
  assert.deepStrictEqual(
    github.graphqlCalls.slice().sort(),
    ['IC_ours', 'PR_ours', 'RC_ours'].sort(),
  );
});

test('tolerates a graphql failure and continues', async () => {
  const github = makeGithub({
    issueComments: [
      { node_id: 'A', body: MARKER, user: { login: 'x[bot]' } },
      { node_id: 'B', body: MARKER, user: { login: 'x[bot]' } },
    ],
    graphqlImpl: (vars) => {
      if (vars.id === 'A') throw new Error('boom');
      return {};
    },
  });
  const n = await minimizePriorReview({ github, context: ctx, core });
  assert.strictEqual(n, 1); // B succeeded, A failed but did not throw
});

test('returns 0 gracefully when list endpoints are missing', async () => {
  const warnings = [];
  const spyCore = { info() {}, warning: (m) => warnings.push(m) };
  const github = { rest: { issues: {}, pulls: {} }, graphql: async () => ({}) };
  const n = await minimizePriorReview({ github, context: ctx, core: spyCore });
  assert.strictEqual(n, 0);
  assert.strictEqual(warnings.length, 3);
});
