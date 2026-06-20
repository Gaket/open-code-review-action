'use strict';
// Posts open-code-review JSON results to a GitHub PR as a single review.
// Adapted from alibaba/open-code-review (Apache-2.0):
//   examples/github_actions/ocr-review.yml  — see NOTICE.

const fs = require('node:fs');

function resultPath() { return process.env.OCR_RESULT_PATH || '/tmp/ocr-result.json'; }
function stderrPath() { return process.env.OCR_STDERR_PATH || '/tmp/ocr-stderr.log'; }

function safeFence(content) {
  const matches = String(content || '').match(/`+/g) || [];
  const maxTicks = matches.reduce((max, t) => Math.max(max, t.length), 0);
  return '`'.repeat(Math.max(3, maxTicks + 1));
}

function fencedBlock(content, language = '') {
  const text = String(content || '');
  const fence = safeFence(text);
  let block = fence + language + '\n' + text;
  if (!text.endsWith('\n')) block += '\n';
  return block + fence;
}

function formatComment(comment) {
  let body = comment.content || '';
  if (comment.suggestion_code && comment.existing_code) {
    body += '\n\n**Suggestion:**\n';
    body += fencedBlock(comment.suggestion_code, 'suggestion');
  }
  return body;
}

function formatCommentMarkdown(comment, error) {
  let md = '### 📄 `' + comment.path + '`';
  if (comment.start_line && comment.end_line) md += ` (L${comment.start_line}-L${comment.end_line})`;
  md += '\n\n';
  if (error) md += `⚠️ GitHub could not post this as an inline comment: ${error}\n\n`;
  md += comment.content || '';
  if (comment.suggestion_code && comment.existing_code) {
    md += '\n\n<details><summary>💡 Suggested Change</summary>\n\n';
    md += '**Before:**\n' + fencedBlock(comment.existing_code) + '\n\n';
    md += '**After:**\n' + fencedBlock(comment.suggestion_code) + '\n\n';
    md += '</details>';
  }
  return md;
}

function buildSummaryBody(totalCount, inlineCount, summaryCount, warnings) {
  let body = `🔍 **OpenCodeReview** found **${totalCount}** issue(s) in this PR.`;
  if (totalCount > 0) {
    body += `\n- ✅ ${inlineCount} posted as inline comment(s)`;
    body += `\n- 📝 ${summaryCount} posted as summary`;
  }
  if (warnings && warnings.length > 0) body += `\n\n⚠️ ${warnings.length} warning(s) occurred during review.`;
  return body;
}

function formatSummaryComments(summaryComments) {
  let body = '';
  for (const { comment } of summaryComments) body += '\n\n---\n\n' + formatCommentMarkdown(comment);
  return body;
}

function buildReviewComment(comment) {
  const rc = { path: comment.path, body: formatComment(comment) };
  if (comment.start_line >= 1 && comment.end_line >= 1 && comment.start_line !== comment.end_line) {
    rc.start_line = comment.start_line;
    rc.line = comment.end_line;
    rc.start_side = 'RIGHT';
    rc.side = 'RIGHT';
  } else if (comment.end_line >= 1) {
    rc.line = comment.end_line;
    rc.side = 'RIGHT';
  } else if (comment.start_line >= 1) {
    rc.line = comment.start_line;
    rc.side = 'RIGHT';
  }
  return rc;
}

async function postReview({ github, context, core }) {
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath(), 'utf8'));
  } catch (e) {
    core.warning(`Failed to parse OCR output: ${e.message}`);
    let stderr = '';
    try { stderr = fs.readFileSync(stderrPath(), 'utf8').trim(); } catch (_) { /* ignore */ }
    if (stderr) {
      await github.rest.issues.createComment({
        owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number,
        body: `⚠️ **OpenCodeReview** encountered an error:\n${fencedBlock(stderr)}`,
      });
    }
    return;
  }

  const comments = result.comments || [];
  const warnings = result.warnings || [];

  if (comments.length === 0) {
    const message = result.message || 'No comments generated. Looks good to me.';
    await github.rest.issues.createComment({
      owner: context.repo.owner, repo: context.repo.repo, issue_number: context.issue.number,
      body: `✅ **OpenCodeReview**: ${message}`,
    });
    return;
  }

  const prNumber = context.issue.number;
  let commitSha;
  if (context.eventName === 'pull_request_target' || context.eventName === 'pull_request') {
    commitSha = context.payload.pull_request.head.sha;
  } else {
    const { data: pr } = await github.rest.pulls.get({
      owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber,
    });
    commitSha = pr.head.sha;
  }

  const reviewComments = [];
  const commentsWithoutLine = [];
  for (const comment of comments) {
    const hasValidLine = comment.start_line >= 1 || comment.end_line >= 1;
    if (!hasValidLine) { commentsWithoutLine.push({ comment, body: formatComment(comment) }); continue; }
    reviewComments.push({ comment, reviewComment: buildReviewComment(comment) });
  }

  const totalCount = comments.length;
  let summaryBody = buildSummaryBody(totalCount, reviewComments.length, commentsWithoutLine.length, warnings);
  summaryBody += formatSummaryComments(commentsWithoutLine);

  try {
    await github.rest.pulls.createReview({
      owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber,
      commit_id: commitSha, body: summaryBody, event: 'COMMENT',
      comments: reviewComments.map(({ reviewComment }) => reviewComment),
    });
    core.info(`Posted review: ${reviewComments.length} inline, ${commentsWithoutLine.length} in summary.`);
  } catch (e) {
    core.warning(`Batch review failed: ${e.message}. Falling back to per-comment posting.`);
    let successCount = 0;
    const failedComments = [];
    for (const { comment, reviewComment } of reviewComments) {
      try {
        await github.rest.pulls.createReview({
          owner: context.repo.owner, repo: context.repo.repo, pull_number: prNumber,
          commit_id: commitSha, body: '', event: 'COMMENT', comments: [reviewComment],
        });
        successCount++;
      } catch (innerE) {
        failedComments.push({ comment, error: innerE.message });
      }
    }
    let finalBody = buildSummaryBody(totalCount, successCount, commentsWithoutLine.length + failedComments.length, warnings);
    finalBody += formatSummaryComments(commentsWithoutLine);
    finalBody += `\n\n---\n\n📊 **Posting Statistics:**\n- ✅ Successfully posted: ${successCount} comment(s)`;
    if (failedComments.length > 0) {
      finalBody += `\n- ❌ Failed to post: ${failedComments.length} comment(s)`;
      finalBody += '\n\n---\n\n### ⚠️ Inline comments shown in summary';
      for (const { comment, error } of failedComments) finalBody += '\n\n---\n\n' + formatCommentMarkdown(comment, error);
    }
    await github.rest.issues.createComment({
      owner: context.repo.owner, repo: context.repo.repo, issue_number: prNumber, body: finalBody,
    });
  }
}

module.exports = postReview;
module.exports.helpers = {
  safeFence, fencedBlock, formatComment, formatCommentMarkdown, buildSummaryBody, buildReviewComment,
};
