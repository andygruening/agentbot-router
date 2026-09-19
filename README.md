# local-agent-bot

A Node.js TypeScript webhook receiver that saves accepted deliveries, gathers GitHub issue or pull request context with `gh`, and launches Codex CLI or Claude CLI in a disposable Docker container. Subscription authentication persists in dedicated Docker volumes. The receiver handles GitHub reactions and result comments after the container finishes.

## Setup

Install the pinned pnpm version and GitHub CLI, then clone this public repository:

```bash
curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=11.20.0 sh -
sudo apt update
sudo apt install gh
git clone https://github.com/andygruening/local-agent-bot.git
cd local-agent-bot
```

Then run the [quickstart script](scripts/quickstart.sh):

```bash
pnpm setup
```

The quickstart securely collects the GitHub token used to clone target repositories, push branches, create pull requests, and post comments and reactions. It installs and builds the application, configures the receiver, and authenticates at least one agent CLI.

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
