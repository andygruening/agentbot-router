# Local deployment

## Requirements

- Node.js 22.6 or newer, pnpm 11.20.0, Git, GitHub CLI, and Docker Engine or Docker Desktop.
- A GitHub token in `GH_TOKEN` with permission to clone the target repositories, push branches, open pull requests, and post issue comments and reactions.
- A Codex subscription and/or Claude subscription. LLM API keys are not used.

## Install

```bash
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
```

Set `GITHUB_WEBHOOK_SECRET` in `.env`. Export the GitHub token in the shell that starts the receiver:

```bash
export GH_TOKEN=github_pat_REPLACE_ME
```

Do not put the token in the repository. The receiver uses it for GitHub context and replies and passes it into each short-lived agent container for clone, push, and pull request operations.

## Authenticate Codex

This required one-time step builds the agent image, creates the `local-agent-codex-auth` Docker volume, and starts Codex device authentication:

```bash
pnpm setup:codex
```

Open the displayed URL, enter the device code, and sign in with the ChatGPT account that owns your Codex subscription. The login remains in the Docker volume and is mounted into future Codex job containers. No OpenAI API key is required.

## Authenticate Claude

This required one-time step builds the same image, creates the `local-agent-claude-auth` Docker volume, and starts Claude login:

```bash
pnpm setup:claude
```

Choose the Claude App login and sign in with the account that owns the Claude subscription. The volume mounts the container's root home because Claude stores subscription state in both `/root/.claude/` and `/root/.claude.json`. No Anthropic API key is required.

Run only the setup commands for CLIs you enable in `AGENT_TAGS`. Re-run a setup command if that CLI reports that its login has expired. Treat both Docker volumes like passwords and do not export or share them.

## Run

```bash
pnpm start
curl http://127.0.0.1:8787/health
```

For a smoke test, set `DRY_RUN=true`, restart, and send a signed webhook. Change it to `false` for active jobs. Expose the local endpoint through an HTTPS tunnel and configure the GitHub webhook URL as `<public-url>/webhooks/github`.

`$codex` and `$claude` select the corresponding containerized CLI. `$agent` uses `AGENT_DEFAULT`. Each job container clones the webhook repository. Pull request and branch events check out the branch supplied by GitHub. If the agent changes files, the wrapper commits and pushes to that branch; without a supplied branch it uses a disposable Git worktree and creates a task branch and pull request only when files changed. If the checkout is unchanged, it creates no branch, commit, or pull request. The receiver posts `agent-output.md` after the container exits and removes the container automatically.
