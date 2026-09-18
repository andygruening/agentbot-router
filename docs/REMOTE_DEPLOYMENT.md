# Remote deployment over SSH

This example uses a Linux VPS such as Hetzner with a domain, Caddy for HTTPS, and systemd for the receiver. SSH is used to administer the server; GitHub sends webhook requests to the public HTTPS endpoint, and the CLIs execute on the VPS.

## Requirements

- A Linux VPS and a DNS `A` or `AAAA` record pointing a domain such as `bot.example.com` at it.
- SSH access with `sudo`, Node.js 22.6+, Git, `gh`, `pnpm` 11.20.0, and at least one authenticated agent CLI. Install pnpm through Corepack after installing Node: `corepack enable` and `corepack prepare pnpm@11.20.0 --activate`.
- TCP ports 80 and 443 reachable for Caddy and port 22 for SSH. Keep receiver port 8787 private.
- Git credentials for the repositories the agent may change, GitHub CLI permissions to read context and add reactions/comments, and a GitHub webhook secret. Use a dedicated non-root account for this service.

Follow the [Codex CLI installation](https://developers.openai.com/docs/codex/cli), [Claude Code installation](https://github.com/anthropics/claude-code#installation), [GitHub CLI installation](https://github.com/cli/cli/blob/trunk/docs/install_linux.md), and [Caddy installation](https://caddyserver.com/docs/install) instructions for your distribution. Native CLI installers put binaries under the account's home directory; confirm their paths with `command -v codex` and `command -v claude`.

After creating the service account below, install the agent CLIs **as that account** if they are not already present:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
curl -fsSL https://claude.ai/install.sh | bash
```

Install only the CLI or CLIs you intend to use. Review the linked vendor instructions before running installers on your VPS.

## Install the application

From your administrator SSH session, create a dedicated service account and its application directory:

```bash
sudo useradd --create-home --shell /bin/bash agentbot
sudo install -d -o agentbot -g agentbot -m 700 /srv/local-agent-bot
sudo -iu agentbot
git clone YOUR_REPOSITORY_URL /srv/local-agent-bot
```

If the account already exists, skip `useradd`. Run the following as `agentbot`:

```bash
cd /srv/local-agent-bot
pnpm install --frozen-lockfile && pnpm build
cp .env.example .env
chmod 600 .env
mkdir -p .webhook-events
chmod 700 .webhook-events
```

Clone each target repository into a directory writable by `agentbot`. Set absolute `CODEX_WORKING_DIRECTORY` and `CLAUDE_WORKING_DIRECTORY` values in `.env` to that checkout. Set `GITHUB_WEBHOOK_SECRET` to a long random value, `HOST=127.0.0.1`, `PORT=8787`, and `WEBHOOK_EVENT_DIR=/srv/local-agent-bot/.webhook-events`. Keep `GITHUB_RESPONSE_ENABLED=true` and `GITHUB_CONTEXT_ENABLED=true` if you want issue/PR context and result comments.

Authenticate `gh`, Codex, and Claude while signed in as `agentbot`. Run `gh auth login`, then launch each installed agent CLI once and complete its login flow. Verify `gh auth status`, `codex --version`, and `claude --version` for the installed CLIs. Ensure Git can fetch and push the target repository. A stored CLI login under a different user, including root, is not visible to this service account. Keep API keys out of the global service environment when possible; agents can run commands from the target repository.

Set `AGENT_DEFAULT` to the CLI used by `$agent`. Both `$codex` and `$claude` can be used when listed in `AGENT_TAGS`; remove a CLI from that list if it is not installed. Set `DRY_RUN=true` for the first signed delivery test, then change it to `false` and restart the service for active runs.

## Run as a systemd service

Use the actual paths returned by `command -v node`, `command -v codex`, `command -v claude`, and `command -v gh` on your server. The following unit assumes Node is `/usr/bin/node` and the CLI binaries are in the service user's `~/.local/bin`:

```ini
# /etc/systemd/system/local-agent-bot.service
[Unit]
Description=Local agent webhook receiver
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agentbot
Group=agentbot
WorkingDirectory=/srv/local-agent-bot
Environment=PATH=/home/agentbot/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node --env-file-if-exists=.env dist/src/index.js
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now local-agent-bot
sudo systemctl status local-agent-bot
curl http://127.0.0.1:8787/health
journalctl -u local-agent-bot -f
```

If `node` or a CLI has a different installed path, update the unit or the matching command setting in `.env`. Restart after configuration changes with `sudo systemctl restart local-agent-bot`.

## Publish HTTPS with Caddy

After installing Caddy, add a site to its Caddyfile:

```caddyfile
bot.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Reload Caddy with `sudo systemctl reload caddy`, then check `https://bot.example.com/health`. Caddy obtains the TLS certificate when DNS and ports 80/443 are configured. The Node process continues listening only on `127.0.0.1`; do not expose port 8787 in the VPS firewall.

In the GitHub repository's webhook settings, use `https://bot.example.com/webhooks/github` as the payload URL, `application/json` as content type, and the same secret as `.env`. Enable only the event types you need, matching `ALLOWED_EVENTS`. Leave SSL verification enabled. Send a tagged test issue comment, inspect GitHub's delivery status, the service journal, and the new job directory under `.webhook-events/`.

## Operations

The receiver saves webhook bodies and context that may contain private repository data. Keep the event directory private, monitor its disk use, and set your own retention or backup policy. Use `systemctl` and `journalctl` to inspect or restart the service. To update, pull a reviewed revision, run `pnpm install --frozen-lockfile && pnpm build`, then restart the service. A running agent is tied to the receiver process; restarting during a run can interrupt result handling.

The receiver verifies and saves a tagged delivery before returning HTTP 202, then fetches GitHub context and starts the CLI in the background. A repeated delivery ID is acknowledged as `duplicate_delivery` and does not launch another job. Check `processing-error.json` in a job directory when preparation or launch fails. A receiver restart can interrupt an active job; the receiver does not yet resume unfinished jobs automatically. Review the saved job before manually retrying it.
