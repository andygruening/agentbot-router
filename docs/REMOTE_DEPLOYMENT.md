# Remote deployment over SSH

This deployment uses a Linux VPS, Docker for isolated agent jobs, systemd for the receiver, and Caddy for HTTPS. SSH is used for setup and maintenance. GitHub calls the public HTTPS endpoint; each accepted task runs in a disposable Docker container.

## Requirements

- A Linux VPS with a domain pointing to it and ports 80/443 open. Keep port 8787 private.
- Node.js 22.6+, pnpm 11.20.0, Git, GitHub CLI, Docker Engine, and the Docker Compose plugin if your distribution bundles it.
- A dedicated non-root `agentbot` account permitted to use Docker. Docker access is effectively root-level access; dedicate this host to trusted agent workloads.
- A GitHub token with access to clone target repositories, push branches, create pull requests, and post comments and reactions.
- A Codex subscription and/or Claude subscription. No LLM API keys are required.

Install Node, Docker Engine, GitHub CLI, and Caddy from their official distribution instructions. Create the service account and application directory:

```bash
sudo useradd --create-home --shell /bin/bash agentbot
sudo usermod --append --groups docker agentbot
sudo install -d -o agentbot -g agentbot -m 700 /srv/local-agent-bot
sudo -iu agentbot
git clone YOUR_REPOSITORY_URL /srv/local-agent-bot
cd /srv/local-agent-bot
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
chmod 600 .env
```

Log out and reconnect after adding the Docker group, then verify `docker run --rm hello-world` as `agentbot`.

## Authenticate the agent CLIs before starting the service

As `agentbot`, authenticate Codex with its device flow:

```bash
cd /srv/local-agent-bot
pnpm setup:codex
```

Open the URL on your own computer, enter the displayed device code, and sign in with the ChatGPT subscription account. Authentication is stored in the `local-agent-codex-auth` Docker volume.

Authenticate Claude separately:

```bash
pnpm setup:claude
```

Choose Claude App login and finish the browser flow using the Claude subscription account. Authentication is stored in `local-agent-claude-auth`. Run only the setup commands for CLIs enabled in `AGENT_TAGS`. Back up neither volume to an untrusted location; each contains renewable subscription credentials.

## Configure the receiver

Edit `/srv/local-agent-bot/.env` and set:

```env
HOST=127.0.0.1
PORT=8787
GITHUB_WEBHOOK_SECRET=replace-with-a-long-random-secret
WEBHOOK_EVENT_DIR=/srv/local-agent-bot/.webhook-events
AGENT_DEFAULT=codex
AGENT_TAGS=codex,claude
```

Store `GH_TOKEN` in a root-readable systemd environment file rather than the repository:

```bash
sudo install -m 600 -o root -g root /dev/null /etc/local-agent-bot.env
sudoedit /etc/local-agent-bot.env
```

Add one line: `GH_TOKEN=github_pat_REPLACE_ME`.

## systemd

```ini
# /etc/systemd/system/local-agent-bot.service
[Unit]
Description=Local agent webhook receiver
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=agentbot
Group=agentbot
SupplementaryGroups=docker
WorkingDirectory=/srv/local-agent-bot
EnvironmentFile=/etc/local-agent-bot.env
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node --env-file-if-exists=.env dist/src/index.js
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
```

Use the actual `node` and `docker` paths returned on the server if they differ.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now local-agent-bot
sudo systemctl status local-agent-bot
curl http://127.0.0.1:8787/health
journalctl -u local-agent-bot -f
```

## HTTPS and GitHub webhook

Configure Caddy:

```caddyfile
bot.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Run `sudo systemctl reload caddy`, then verify `https://bot.example.com/health`. Configure the GitHub webhook payload URL as `https://bot.example.com/webhooks/github`, content type `application/json`, and the same secret as `.env`. Subscribe only to required events.

## Job behavior and operations

The receiver verifies and persists a delivery, returns HTTP 202, and starts a container in the background. The job mounts its selected subscription-auth volume and job directory, receives `GH_TOKEN`, clones the repository, and checks out a branch when GitHub supplies one. Actual file changes are committed and pushed to that branch. Without a supplied branch, the job uses a disposable Git worktree; actual changes cause a new task branch and pull request. An unchanged checkout produces only the answer and no Git branch or pull request. The receiver posts that answer to GitHub, and Docker removes the container.

Repeated GitHub delivery IDs do not launch a second job. Inspect `.webhook-events/<job>/`, `processing-error.json`, and the system journal when a job fails. Restarting the receiver can interrupt result handling for an active container, and unfinished jobs are not resumed automatically.

To update, pull a reviewed revision, run `pnpm install --frozen-lockfile && pnpm build`, rebuild the image by running either setup command (or `docker build -t local-agent-bot-agent:latest -f docker/Dockerfile .` without logging in again), and restart the service. Existing authentication volumes survive image rebuilds.
