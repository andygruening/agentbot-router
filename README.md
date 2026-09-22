# local-agent-bot

A Node.js TypeScript webhook receiver that saves accepted deliveries, gathers GitHub issue or pull request context with `gh`, and launches Codex CLI or Claude CLI in a disposable Docker container. Subscription authentication persists in dedicated Docker volumes. The receiver handles GitHub reactions and result comments after the container finishes.

## Setup

Follow the [Ubuntu server deployment guide](DEPLOYMENT.md) to install the required tools, configure the receiver and agent subscriptions, expose it through Cloudflare Tunnel, and register the GitHub App.

## Agent selection

A delivery launches an agent only when the new comment, issue or pull request body, or label contains a configured tag. `$agent` asks TypeSafe Jev to select an agent, model, and reasoning level from [jev-choices.json](jev-choices.json). Set `TYPESAFE_API_KEY` in `.env` to enable this routing. Without that key, `$agent` uses `AGENT_DEFAULT` and its configured model.

`$codex` and `$claude` select those CLIs directly. Add a model and optional reasoning level with `$codex:gpt-5.6-sol`, `$codex:gpt-5.6-sol:low`, `$claude:fable-5.1`, or `$claude:fable-5.1:low`. Omitting either override uses that CLI's configured default. Codex accepts `minimal`, `low`, `medium`, `high`, and `xhigh`; Claude accepts `low`, `medium`, `high`, `xhigh`, and `max`, subject to support by the selected model.

Each Jev option has a stable ID, an agent, a model, a reasoning level, and a description of when to use it. Options for agents absent from `AGENT_TAGS` are removed before the request is sent to Jev. Jev receives the triggering user message and the remaining descriptions; its winning choice is used for the job. The choice, confidence, probability distribution, and Jev model are saved in `agent-routing.json` and the job metadata. Routing failures fall back to the configured default. See the [TypeSafe JavaScript SDK documentation](https://docs.typesafe.ai/sdk/javascript) for API details.

On `issue_comment` events, only the new comment is scanned. Configure supported direct agents with `AGENT_TAGS`. Conflicting agent or model tags are rejected as ambiguous. Set `JEV_CHOICES_PATH` to use a different choices file.

Each accepted job writes its webhook payload, GitHub context, prompt, process logs, output, and result under `WEBHOOK_EVENT_DIR`. The agent writes the public reply to `agent-output.md` and ends with an `AGENT_WORKER_DONE` or `AGENT_WORKER_BLOCKED` envelope. The receiver posts the output file through `gh`; the agent must not post its own GitHub response.

## Development

```bash
pnpm check
pnpm build
```

Source is under `src/core`, `src/integrations`, and `src/agents`. Tests use Node's built-in test runner under `tests/`. Keep secrets in local environment files and delivery artifacts out of git.
