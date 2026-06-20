# Open Code Review Action (LiteLLM)

A reusable GitHub Action that runs Alibaba's [`open-code-review`](https://github.com/alibaba/open-code-review) (OCR) CLI on your pull requests against a **custom OpenAI-compatible LiteLLM endpoint**, and posts the findings as inline PR review comments.

OCR is a hybrid code-review tool: a deterministic pipeline (built-in ruleset for NPE, thread-safety, XSS, SQL injection, plus precise line positioning) combined with an LLM agent. This action wraps the CLI and handles posting results to GitHub — including inline range comments, one-click suggestions, and a summary fallback for findings that can't be anchored to the diff.

## Usage

Add this workflow to your repo (`.github/workflows/open-code-review.yml`):

```yaml
# SECURITY: pull_request_target gives fork PRs access to secrets. This job does
# NOT build/test/run PR or workspace code. NOTE: OCR is an agent — it may read
# the changed files and repository context and send them to the configured LLM
# endpoint. Only point it at an endpoint you trust with repository contents, and
# never add build/test steps to this job.
name: Open Code Review

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.event.issue.number || github.ref }}
  cancel-in-progress: true

on:
  pull_request_target:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    if: >
      github.event_name == 'pull_request_target' ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request &&
       startsWith(github.event.comment.body, '/review') &&
       contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association))
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # MANDATORY — see note below
          ref: ${{ github.event.pull_request.head.sha || github.sha }}
      - uses: Gaket/open-code-review-action@v1
        with:
          # url/model may be a secret OR a variable; the token must always be a secret.
          llm_url: ${{ secrets.OCR_LLM_URL || vars.OCR_LLM_URL }}
          llm_token: ${{ secrets.OCR_LLM_TOKEN }}
          llm_model: ${{ secrets.OCR_LLM_MODEL || vars.OCR_LLM_MODEL }}
          use_anthropic: 'false'
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

A ready-to-copy version lives in [`examples/pr-review.yml`](examples/pr-review.yml).

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `llm_url` | yes | — | OpenAI-compatible **chat-completions** endpoint, e.g. `https://litellm.example.com/v1/chat/completions` |
| `llm_token` | yes | — | API key / LiteLLM virtual key (Bearer auth) |
| `llm_model` | yes | — | Model name / LiteLLM alias (e.g. `kimi-code`, `gpt-4o`) |
| `use_anthropic` | no | `false` | `true` **only** for an Anthropic-protocol endpoint. Keep `false` for OpenAI-compatible LiteLLM |
| `extra_body` | no | `''` | Optional JSON merged into the request body, e.g. `{"enable_thinking": false}` |
| `language` | no | `''` | Optional review language (`ocr config set language`), e.g. `English`. Empty = OCR default |
| `github_token` | no | `${{ github.token }}` | Token with `pull-requests: write` to post comments |
| `ocr_version` | no | `1.3.19` | npm version of `@alibaba-group/open-code-review` (pinned by default) |

## LiteLLM (OpenAI-compatible) setup

This is the part most people get wrong:

- **`llm_url` must be the full chat-completions URL** — `https://<litellm-host>/v1/chat/completions` (not just the `/v1` base). If `ocr llm test` returns a 404, re-check the path/suffix.
- **`use_anthropic` must be `false`.** OCR defaults it to `true`; for an OpenAI-compatible endpoint it must be set to `false` explicitly (the action does this) so OCR uses standard Bearer API-key auth.
- **`llm_model`** is the LiteLLM **alias** as configured in your proxy (e.g. `kimi-code`).
- Store `OCR_LLM_TOKEN` as a **secret** (it's sensitive and must be masked). `OCR_LLM_URL` and `OCR_LLM_MODEL` may be stored as **secrets _or_ variables** — the workflow above reads `secrets.X || vars.X` for those, so either works (repo- or org-level). **Never store the token as a plaintext variable** — variables are not masked in logs.
- Optional: set `language` (e.g. `English`) and a model-specific `extra_body` (e.g. `{"enable_thinking": false}` to disable thinking output on models that support it).

Verify connectivity locally before wiring CI:

```bash
npm install -g @alibaba-group/open-code-review@1.3.19
ocr config set llm.url "https://<litellm-host>/v1/chat/completions"
ocr config set llm.auth_token "<key>"
ocr config set llm.model "<alias>"
ocr config set llm.use_anthropic false
ocr llm test
```

## Requirements & guardrails

- **Permissions:** the job needs `pull-requests: write` and `contents: read`.
- **`fetch-depth: 0` is mandatory** in `actions/checkout` — without full history, `origin/<base>` won't resolve and `ocr review` fails.
- **`issue_comment` guard is mandatory:** the job's `if:` must include `github.event.issue.pull_request` (so comments on plain issues don't trigger a failing `pulls.get`) **and** an `author_association` allowlist (`OWNER`/`MEMBER`/`COLLABORATOR`) so arbitrary commenters can't trigger reviews and spend LLM budget.
- **Trigger by comment:** comment `/review` on a PR (subject to the allowlist above).

## Security

`pull_request_target` runs with your secrets available, even for fork PRs. This is acceptable here because the action installs OCR by name (`npm i -g`, never from the checked-out workspace) and **never builds, tests, or runs PR/workspace code**.

However, **OCR is an agent**: it may read the changed files and surrounding repository context and send them to the configured LLM endpoint. Only point this action at an endpoint you trust with your repository's contents, and never add build/test steps to this job.

`ocr_version` is pinned by default (`1.3.19`) for reproducibility and supply-chain safety, since this job carries secrets and a write token. Override it deliberately and pin to a known-good release.

## Attribution

Built on [alibaba/open-code-review](https://github.com/alibaba/open-code-review) (Apache-2.0). The PR-comment posting logic in [`post-review.js`](post-review.js) is adapted from that project's `examples/github_actions/ocr-review.yml`. See [`NOTICE`](NOTICE). Licensed under [Apache-2.0](LICENSE).
