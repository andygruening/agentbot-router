# Local deployment

## Requirements

- Node.js 22.6 or newer, `pnpm` 11.20.0 (the version pinned in `package.json`), and Git.
- GitHub CLI (`gh`) installed and authenticated for the target repository. Check with `gh auth status`.
- At least one of Codex CLI or Claude CLI installed and authenticated under the same operating-system account that runs this server. See [Codex installation](https://developers.openai.com/docs/codex/cli) and [Claude installation](https://github.com/anthropics/claude-code#installation).
- A GitHub webhook secret. For local testing, use a public HTTPS tunnel to receive GitHub deliveries.

## Install and configure

From this repository:

```bash
pnpm install --frozen-lockfile && pnpm build
cp .env.example .env
```

Edit `.env` and set `GITHUB_WEBHOOK_SECRET` to a long random value. Set `AGENT_DEFAULT=codex` or `claude`; both direct tags remain available with `AGENT_TAGS=codex,claude`. Set `CODEX_WORKING_DIRECTORY` and `CLAUDE_WORKING_DIRECTORY` to the checkout where agents should work. The working account must have Git access to that checkout and permission to push or open pull requests if you want code changes delivered back to GitHub.

The example config binds to `127.0.0.1:8787`. Run the compiled application:

```bash
pnpm start
curl http://127.0.0.1:8787/health
```

For a webhook smoke test without launching a CLI, set `DRY_RUN=true` in `.env` and restart. For active runs, use `DRY_RUN=false`. Configure your GitHub repository webhook with an HTTPS tunnel URL ending in `/webhooks/github`, content type `application/json`, and the same secret as `.env`. Subscribe to only the events you need, such as `issues`, `issue_comment`, and `pull_request`.

Send `$codex`, `$claude`, or `$agent` in a new issue comment to launch a job. Inspect `.webhook-events/` and the server log for its status. The CLI commands and `gh` must be available on the `PATH` of the server process; use `CODEX_COMMAND`, `CLAUDE_COMMAND`, or `GITHUB_COMMAND` for absolute paths if needed.

## Credentials and permissions

Run `gh auth status` and a small CLI prompt as the same account that starts the receiver before testing webhooks. The child processes inherit only a small environment. `CODEX_ENV_PASSTHROUGH_JSON`, `CLAUDE_ENV_PASSTHROUGH_JSON`, and `GITHUB_ENV_PASSTHROUGH_JSON` control additional variable names passed to each command. Prefer each CLI's stored login over putting agent API keys in a server-wide `.env`, because agents can execute repository-controlled code. Keep `.env` and webhook artifacts private to the account running the receiver.

Claude runs in noninteractive print mode. The example `CLAUDE_EXTRA_ARGS_JSON` uses `acceptEdits`; tool requests that still need approval can stop an unattended run. Review Claude's permission options for the repository and the level of automation you intend to allow.
