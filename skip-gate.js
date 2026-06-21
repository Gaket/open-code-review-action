'use strict';
// Decides whether to skip auto-review for a PR based on draft status, labels, and
// title keywords. An explicit `/review` (issue_comment event) always overrides and
// never skips. Pure function — no network calls, no side effects.

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function decideSkip({ context, inputs }) {
  // `/review` comment is an explicit human request → always review.
  if (context && context.eventName === 'issue_comment') return { skip: false, reason: '' };

  const pr = context && context.payload && context.payload.pull_request;
  if (!pr) return { skip: false, reason: '' }; // fail open — review rather than silently drop

  const opts = inputs || {};

  if (String(opts.skipDraft || '').toLowerCase() === 'true' && pr.draft === true) {
    return { skip: true, reason: 'draft PR' };
  }

  const skipLabels = parseList(opts.skipLabels);
  if (skipLabels.length) {
    for (const label of pr.labels || []) {
      const name = String((label && label.name) || '');
      if (skipLabels.includes(name.trim().toLowerCase())) {
        return { skip: true, reason: `label: ${name}` };
      }
    }
  }

  const skipKeywords = parseList(opts.skipTitleKeywords);
  if (skipKeywords.length) {
    const title = String(pr.title || '').toLowerCase();
    const hit = skipKeywords.find((kw) => title.includes(kw));
    if (hit) return { skip: true, reason: `title keyword: ${hit}` };
  }

  return { skip: false, reason: '' };
}

module.exports = decideSkip;
module.exports.helpers = { parseList };
