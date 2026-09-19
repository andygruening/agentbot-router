# Deployment

This guide configures `local-agent-bot` as a webhook receiver, exposes it through Cloudflare Tunnel, and registers one GitHub App whose installation covers every repository in a personal account or organization. Each accepted task runs in a disposable Docker container. Codex and Claude subscription logins persist in separate Docker volumes.

## Requirements

- Node.js 22.6 or newer, pnpm 11.20.0, Git, GitHub CLI, Docker Engine or Docker Desktop, and `cloudflared`.
- A domain managed in Cloudflare.
- A GitHub account or organization where you can create and install a GitHub App.
- A GitHub token for unattended repository and response operations.
- A Codex subscription and/or Claude subscription. LLM API keys are not used.

On Ubuntu or Debian, install GitHub CLI with:

```bash
sudo apt update
sudo apt install gh
```

Install `cloudflared` using the [official Cloudflare packages or downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). Confirm the required commands are available:

```bash
node --version
pnpm --version
git --version
gh --version
docker version
cloudflared version
```

## Quickstart

Install pnpm and GitHub CLI, authenticate GitHub CLI, and clone this public repository:

```bash
npm install --global pnpm@11.20.0
sudo apt update
sudo apt install gh
gh auth login --with-token
git clone https://github.com/andygruening/local-agent-bot.git
cd local-agent-bot
```

Then run the interactive setup:

```bash
pnpm setup
```

GitHub CLI reads the token from standard input. The quickstart checks local requirements, installs dependencies, builds the application, creates or updates a private `.env`, securely collects the runtime GitHub token, generates a webhook secret, and authenticates Codex, Claude, or both. You may skip either agent, but setup requires at least one. Codex and Claude use subscription device or browser login; the script does not request LLM API keys.

The quickstart ends with the local start command and the remaining Cloudflare Tunnel and GitHub App steps. Use the sections below when setting up those services or when you prefer manual setup.

## Install the application

Clone this repository and run the pinned install and build:

```bash
git clone YOUR_REPOSITORY_URL local-agent-bot
cd local-agent-bot
pnpm install --frozen-lockfile
pnpm build
cp .env.example .env
```

Create a long random webhook secret:

```bash
openssl rand -hex 32
```

Set that value in `.env`:

```env
GITHUB_WEBHOOK_SECRET=replace-with-the-generated-secret
HOST=127.0.0.1
PORT=8787
AGENT_DEFAULT=codex
AGENT_TAGS=codex,claude
```

Binding the receiver to `127.0.0.1` keeps port 8787 off the public network. Cloudflare Tunnel connects to that local listener.

## Authenticate Codex

Run this required one-time setup for Codex:

```bash
pnpm setup:codex
```

The command builds the agent image, creates the `local-agent-codex-auth` Docker volume, and starts `codex login --device-auth`. Open the displayed URL on any computer, enter the device code, and sign in with the ChatGPT account that owns the Codex subscription. Future Codex jobs mount this volume at `/root/.codex` so refreshed subscription credentials survive disposable containers.

## Authenticate Claude

Run this required one-time setup for Claude:

```bash
pnpm setup:claude
```

The command builds the same image, creates the `local-agent-claude-auth` Docker volume, and starts `claude auth login`. Choose Claude App login and complete the browser flow with the account that owns the Claude subscription. Future Claude jobs mount this volume as the container's root home because Claude stores subscription state in `/root/.claude/` and `/root/.claude.json`.

Run only the setup commands for CLIs enabled in `AGENT_TAGS`. Re-run a setup command if its CLI reports an expired login. Treat both Docker volumes like passwords: they contain renewable subscription credentials.

## Configure GitHub access for jobs and replies

The GitHub App configured later delivers webhooks. Runtime GitHub operations currently use `GH_TOKEN` separately. The token must be able to:

- Clone every repository on which the app is installed.
- Push task branches and branches supplied by pull request webhooks.
- Create pull requests.
- Read issues, pull requests, comments, reviews, and repository activity.
- Create and remove reactions and post issue or pull request comments.

Export the token in the environment that starts the receiver:

```bash
export GH_TOKEN=github_pat_REPLACE_ME
```

Do not commit it or place it in a Docker image. The receiver passes it to a job container only while that container is running. Verify access before continuing:

```bash
gh auth status
gh repo view OWNER/REPOSITORY
```

## Start and verify the receiver

```bash
pnpm start
```

In another terminal:

```bash
curl http://127.0.0.1:8787/health
```

For the first signed webhook test, set `DRY_RUN=true` in `.env` and restart the receiver. Change it to `false` after webhook delivery and signature verification work.

## Create the Cloudflare Tunnel

A named Cloudflare Tunnel provides a stable HTTPS hostname without exposing an inbound application port. The tunnel connector makes an outbound connection to Cloudflare.

Authenticate `cloudflared` and create the tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create local-agent-bot
cloudflared tunnel list
```

The create command prints a tunnel UUID and writes a credentials JSON file under `~/.cloudflared/`. Create `~/.cloudflared/config.yml`, replacing both UUID values and the hostname:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /absolute/path/to/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  - hostname: agent.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Create the Cloudflare DNS route and validate the ingress configuration:

```bash
cloudflared tunnel route dns local-agent-bot agent.example.com
cloudflared tunnel ingress validate
cloudflared tunnel run local-agent-bot
```

With both the receiver and tunnel running, verify:

```bash
curl https://agent.example.com/health
```

Do not place an interactive Cloudflare Access login policy in front of this webhook hostname; GitHub cannot complete that browser flow. The webhook secret and receiver signature validation authenticate deliveries.

Keep the account-wide `cert.pem` and tunnel credentials JSON private. The credentials JSON is sufficient to run this tunnel; `cert.pem` can manage tunnels in the Cloudflare account. See Cloudflare's [locally managed tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/) and [tunnel credential scopes](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-permissions/).

## Create the GitHub App

Create one GitHub App under the personal account or organization that owns the repositories:

1. Open **Settings → Developer settings → GitHub Apps → New GitHub App**. For an organization, open the organization's settings first.
2. Enter a unique app name and use this repository's URL as the homepage URL.
3. Leave user authorization and callback URLs disabled; this receiver does not use a user OAuth flow.
4. Enable **Webhooks**.
5. Set **Webhook URL** to `https://agent.example.com/webhooks/github`.
6. Set **Webhook secret** to the exact `GITHUB_WEBHOOK_SECRET` value in `.env`.
7. Leave SSL verification enabled.
8. Under **Repository permissions**, grant:
   - **Issues: Read-only** to make issue and issue-comment webhook subscriptions available.
   - **Pull requests: Read-only** to make pull request and review webhook subscriptions available.
   - **Metadata: Read-only**, which GitHub grants to installed apps.
9. Under **Subscribe to events**, enable:
   - **Issues**
   - **Issue comment**
   - **Pull request**
   - **Pull request review**
   - **Pull request review comment**
10. Select **Only on this account** unless other GitHub accounts must also install the app, then create it.

GitHub only offers webhook subscriptions allowed by the selected permissions. The GitHub documentation explains the relationship between [GitHub App permissions and webhook events](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps).

## Install the GitHub App on all repositories

From the new app's settings:

1. Select **Install App**.
2. Select the personal account or organization.
3. Choose **All repositories**.
4. Confirm the installation.

“All repositories” applies to that installation account and includes repositories subsequently created there. It is not one global installation across unrelated GitHub accounts. Install the same app separately on each personal account or organization that should send events. GitHub documents the account-level installation flow in [Installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).

The app now sends the selected events from every accessible repository to the single Cloudflare hostname. Set `ALLOWED_EVENTS` in `.env` to the same event set if you want an additional receiver-side allowlist:

```env
ALLOWED_EVENTS=issues,issue_comment,pull_request,pull_request_review,pull_request_review_comment
```

These read-only GitHub App permissions are sufficient because `GH_TOKEN`, rather than a GitHub App installation token, performs cloning, pushes, pull request creation, comments, and reactions in the current implementation.

## Test the end-to-end flow

1. Confirm the receiver health endpoint through Cloudflare.
2. In GitHub App settings, open **Advanced** and inspect **Recent Deliveries**.
3. Create an issue in an installed repository and add a comment containing `$codex`, `$claude`, or `$agent`.
4. Confirm GitHub receives HTTP 202.
5. Inspect the receiver logs and `.webhook-events/<job-id>/`.
6. With `DRY_RUN=false`, confirm Docker creates a temporary job container and removes it after completion.

Each job clones the repository inside its container. If GitHub supplies a pull request or branch head, the job checks it out and pushes actual changes to that branch. Without a supplied branch, the job uses a disposable Git worktree and creates a task branch and pull request only when files changed. A question-only job writes its answer without creating a branch, commit, or pull request. The host receiver posts `agent-output.md` after the container exits.

Repeated GitHub delivery IDs do not launch a second job. Check `processing-error.json`, `job.json`, Docker logs, and the receiver log when a task fails. Restarting the receiver can interrupt result handling for active jobs; unfinished jobs are not resumed automatically.

## Local vs Remote Deployment

The application, agent authentication, Cloudflare Tunnel, and GitHub App steps above are the same in both environments. The difference is how the long-running receiver and tunnel processes are supervised.

### Local

- Use Docker Desktop or a local Docker Engine.
- Run `pnpm start` in one terminal and `cloudflared tunnel run local-agent-bot` in another.
- Keep the computer awake and connected while receiving webhooks.
- Store `GH_TOKEN` in the shell environment or a private local secret manager.
- Local deployment is suitable for development and attended use.

### Remote

- Use a dedicated non-root service account such as `agentbot` on a Linux VPS.
- Grant that account Docker access only on a host dedicated to trusted agent workloads; Docker daemon access is effectively root-level access.
- Store the repository and `.webhook-events` in a directory owned by the service account, with `.env` mode `0600`.
- Store `GH_TOKEN` in `/etc/local-agent-bot.env` with root ownership and mode `0600`:

  ```bash
  sudo install -m 600 -o root -g root /dev/null /etc/local-agent-bot.env
  sudoedit /etc/local-agent-bot.env
  ```

  Add a single `GH_TOKEN=github_pat_REPLACE_ME` line to that file.

- Run the receiver using a unit such as:

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

  Enable it with `sudo systemctl daemon-reload && sudo systemctl enable --now local-agent-bot`.

- Install the tunnel as a service with the explicit user configuration path:

  ```bash
  sudo cloudflared --config /home/agentbot/.cloudflared/config.yml service install
  sudo systemctl enable --now cloudflared
  ```

- Keep `HOST=127.0.0.1`; open only SSH and any unrelated services required by the VPS. Cloudflare Tunnel does not require inbound port 8787.
- Follow Cloudflare's [Linux service instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/) when the config or service account paths differ.
