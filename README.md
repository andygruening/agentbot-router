# agentbot-router

A Node.js TypeScript webhook receiver that saves accepted deliveries, gathers GitHub issue or pull request context with `gh`, and launches Codex CLI or Claude CLI in an isolated Docker workflow. A credentialed repository container prepares a job-scoped workspace, the agent container edits it without `git`, `gh`, or GitHub credentials, and a repository finalizer delivers any changes. Subscription authentication persists in dedicated Docker volumes. The receiver handles GitHub reactions and result comments after the workflow finishes.

## Setup

Follow the [Ubuntu server deployment guide](DEPLOYMENT.md) to install the required tools, configure the receiver and agent subscriptions, expose it through Cloudflare Tunnel, and register the GitHub App.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for webhook diagnostics, service and job logs, container permissions, Codex authentication, GitHub reactions, and repository push failures.

## Agent selection

A delivery launches an agent only when the new comment, issue or pull request body, or label contains a configured tag. TypeSafe Jev fills every part omitted from the tag using [jev-choices.json](jev-choices.json). `TYPESAFE_API_KEY` is required in `.env` for incomplete tags.

See [EXAMPLES.md](EXAMPLES.md) for every bundled model and reasoning combination with ready-to-use GitHub prompt examples.

`$agent` lets Jev select the agent, model, and reasoning. `$codex` or `$claude` constrains the agent while Jev selects its model and reasoning. A model tag such as `$codex:gpt-6-astra` constrains both agent and model while Jev selects reasoning. A complete tag such as `$codex:gpt-5.6-sol:low` runs that exact choice without a Jev decision. Codex accepts `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; Claude accepts `low`, `medium`, `high`, `xhigh`, `max`, and `ultracode`, subject to support by the selected model.

Each Jev option has a stable ID, an agent, a model, an optional reasoning level, and a description of when to use it. The bundled choices cover current Codex models and valid reasoning levels plus current Claude Code model aliases and supported effort levels. Options are filtered by `AGENT_TAGS` and every agent or model constraint supplied in the tag. Jev receives the triggering user message and the remaining descriptions; its highest-confidence choice is used for the job. The choice, confidence, probability distribution, and Jev model are saved in `agent-routing.json` and the job metadata. Missing Jev configuration, routing failures, and tags with no matching choice stop the task instead of silently using CLI defaults. See the [TypeSafe JavaScript SDK documentation](https://docs.typesafe.ai/sdk/javascript) for API details.

On `issue_comment` events, only the new comment is scanned. Configure supported direct agents with `AGENT_TAGS`. Conflicting agent or model tags are rejected as ambiguous. Set `JEV_CHOICES_PATH` to use a different choices file.

Accepted tasks use GitHub reactions as status: 👀 while processing, the configured completion reaction (👍 by default) after success, and 👎 after any failed, timed out, or blocked result. The receiver keeps 👀 in place if GitHub cannot record the terminal reaction.

Each accepted job writes its webhook payload, GitHub context, prompt, process logs, output, and result under `WEBHOOK_EVENT_DIR`. The agent writes the public reply to `agent-output.md` and ends with an `AGENT_WORKER_DONE` or `AGENT_WORKER_BLOCKED` envelope. The receiver posts the output file through `gh`; the agent container has no GitHub credentials or Git tooling and cannot post its own response.

## Development

```bash
pnpm check
pnpm build
```

Source is under `src/core`, `src/integrations`, and `src/agents`. Tests use Node's built-in test runner under `tests/`. Keep secrets in local environment files and delivery artifacts out of git.
