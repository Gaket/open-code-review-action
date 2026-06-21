'use strict';
// Minimizes (collapses as OUTDATED) this action's prior review content on a PR:
// the review summary, its inline comments, and any issue comments we posted.
// Non-destructive — preserves history. Identifies our own content by a hidden
// marker plus bot authorship. Best-effort: never throws out of the per-item loop.

const MARKER = '<!-- open-code-review -->';

// Collapses up to ~100 items per source (per_page cap); realistic PRs stay well
// under that. github.graphql is used for the mutation; REST list endpoints give us
// each item's GraphQL node_id.
const MINIMIZE_MUTATION = `
mutation($id: ID!) {
  minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) {
    minimizedComment { isMinimized }
  }
}`;

function isOurs(node) {
  const body = (node && node.body) || '';
  const login = (node && node.user && node.user.login) || '';
  return body.includes(MARKER) && login.endsWith('[bot]');
}

async function collect(listFn, core, label) {
  try {
    const { data } = await listFn();
    return (data || []).filter(isOurs).map((n) => n.node_id);
  } catch (e) {
    core.warning(`open-code-review: ${label} lookup failed: ${e.message}`);
    return [];
  }
}

async function minimizePriorReview({ github, context, core }) {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const number = context.issue.number;

  const ids = [
    ...(await collect(
      () => github.rest.issues.listComments({ owner, repo, issue_number: number, per_page: 100 }),
      core,
      'issue comments',
    )),
    ...(await collect(
      () => github.rest.pulls.listReviews({ owner, repo, pull_number: number, per_page: 100 }),
      core,
      'reviews',
    )),
    ...(await collect(
      () => github.rest.pulls.listReviewComments({ owner, repo, pull_number: number, per_page: 100 }),
      core,
      'review comments',
    )),
  ];

  let minimized = 0;
  for (const id of ids) {
    try {
      await github.graphql(MINIMIZE_MUTATION, { id });
      minimized += 1;
    } catch (e) {
      core.warning(`open-code-review: minimize failed for ${id}: ${e.message}`);
    }
  }
  if (minimized) core.info(`open-code-review: minimized ${minimized} prior item(s).`);
  return minimized;
}

module.exports = minimizePriorReview;
module.exports.MARKER = MARKER;
module.exports.helpers = { isOurs };
