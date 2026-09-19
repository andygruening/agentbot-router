# local-agent-bot

A Node.js TypeScript webhook receiver that saves accepted deliveries, gathers GitHub issue or pull request context with `gh`, and launches Codex CLI or Claude CLI in a disposable Docker container. Subscription authentication persists in dedicated Docker volumes. The receiver handles GitHub reactions and result comments after the container finishes.

## Setup

- [Quickstart script](scripts/quickstart.sh): clone the repository, then run `pnpm setup` for an interactive installation and configuration walkthrough.
- [Deployment guide](DEPLOYMENT.md): requirements, manual setup, Cloudflare Tunnel, GitHub App configuration, and local or remote deployment.

## Agent selection

A delivery launches an agent only when the new comment, issue or pull request body, or label contains a configured tag. `$agent` selects `AGENT_DEFAULT`; `$codex` and `$claude` select those CLIs directly. On `issue_comment` events, only the new comment is scanned. Configure supported direct tags with `AGENT_TAGS`. The selected CLI uses its own model setting, `CODEX_DEFAULT_MODEL` or `CLAUDE_MODEL`.

Each accepted job writes its webhook payload, GitHub context, prompt, process logs, output, and result under `WEBHOOK_EVENT_DIR`. The agent writes the public reply to `agent-output.md` and ends with an `AGENT_WORKER_DONE` or `AGENT_WORKER_BLOCKED` envelope. The receiver posts the output file through `gh`; the agent must not post its own GitHub response.

## Development

```bash
pnpm check
pnpm build
```

Source is under `src/core`, `src/integrations`, and `src/agents`. Tests use Node's built-in test runner under `tests/`. Keep secrets in local environment files and delivery artifacts out of git.
