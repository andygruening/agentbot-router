# Ubuntu Server Deployment

This guide installs `agentbot-router` on an Ubuntu server, runs each Codex or Claude task in isolated Docker containers, exposes the receiver with a remotely managed Cloudflare Tunnel, and delivers GitHub issue and pull request webhooks through a GitHub App.

Use a dedicated server and service account for trusted agent workloads. Docker access is effectively root access. Run the administrative commands from a sudo-enabled account.

## 1. Install all required tools

The server needs Node.js 22.6 or newer, pnpm 11.20.0, Git, GitHub CLI, Docker Engine, OpenSSL, curl, and `cloudflared`.

Install the base packages and Docker from Ubuntu's repositories:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git gh openssl docker.io
sudo systemctl enable --now docker
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Create a dedicated service account and grant it Docker access:

```bash
sudo adduser --disabled-password --gecos "" agentbot
sudo usermod --append --groups docker agentbot
```

Install the pinned pnpm version for that account without requiring npm:

```bash
sudo -iu agentbot bash -lc 'curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=11.20.0 SHELL=/bin/bash sh -'
```

Add Cloudflare's signing key and stable package repository, then install `cloudflared`:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
```

Verify every command before continuing:

```bash
node --version
sudo -iu agentbot bash -lc 'export PATH="$HOME/.local/share/pnpm/bin:$PATH"; pnpm --version'
git --version
gh --version
docker --version
cloudflared --version
```

Node must report 22.6 or newer and pnpm must report 11.20.0. If `agentbot` cannot run `docker version`, sign out of that account and start a new login session so its new group membership takes effect.

References: [pnpm standalone installation](https://pnpm.io/installation) and [Cloudflare's Debian package repository](https://pkg.cloudflare.com/).

## 2. Pull the repository onto the server

Create the application directory, clone the public repository as `agentbot`, install the locked dependencies, and build it:

```bash
sudo install -d -o agentbot -g agentbot /srv/agentbot-router
sudo -iu agentbot bash
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
git clone https://github.com/andygruening/agentbot-router.git /srv/agentbot-router
cd /srv/agentbot-router
pnpm install --frozen-lockfile
pnpm build
exit
```

Future updates use the same account:

```bash
sudo -iu agentbot bash
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
cd /srv/agentbot-router
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm docker:build
exit
sudo systemctl restart agentbot-router
```

## 3. Configure the application and agent authentication

Create the private environment file:

```bash
sudo -u agentbot cp /srv/agentbot-router/.env.example /srv/agentbot-router/.env
sudo chmod 600 /srv/agentbot-router/.env
openssl rand -hex 32
sudoedit /srv/agentbot-router/.env
```

Use the generated random value for `GITHUB_WEBHOOK_SECRET`. Configure at least these values:

```env
HOST=127.0.0.1
PORT=8787
GITHUB_WEBHOOK_PATH=/webhooks/github
GITHUB_WEBHOOK_SECRET=replace-with-the-generated-secret
ALLOWED_EVENTS=issues,issue_comment,pull_request,pull_request_review,pull_request_review_comment

AGENT_TAGS=codex
GH_TOKEN=github_pat_REPLACE_ME
AGENT_DOCKER_IMAGE=agentbot-router-agent:latest
REPOSITORY_DOCKER_IMAGE=agentbot-router-repository:latest

# Required: TypeSafe Jev completes underspecified agent tags.
TYPESAFE_API_KEY=replace-with-your-typesafe-api-key
JEV_CHOICES_PATH=jev-choices.json
```

`GH_TOKEN` must be able to clone every target repository, push task branches, create pull requests, read issues and pull requests, and post comments and reactions. The receiver passes it only to the short-lived repository preparation and finalization containers. The model container never receives the token. It is separate from the read-only GitHub App used to deliver webhooks.

`TYPESAFE_API_KEY` is required for any tag that omits the agent, model, or reasoning. `$agent` lets Jev choose all three values. `$codex` and `$claude` constrain the agent, and tags such as `$codex:gpt-6-astra` also constrain the model. Jev receives only matching options from `jev-choices.json`, and its highest-confidence choice is used. Fully specified tags run directly. The TypeSafe key remains in the receiver process and is never passed to job containers.

Authenticate at least one agent CLI with its subscription account. These commands build the isolated agent and repository images and save renewable login credentials in private Docker volumes:

```bash
sudo -iu agentbot bash
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
cd /srv/agentbot-router
pnpm setup:codex
pnpm setup:claude
exit
```

You may run only one of those commands, but remove the other CLI from `AGENT_TAGS`. Codex uses device authentication with the ChatGPT account that owns the subscription. Claude uses Claude App browser authentication. No Codex or Claude API key is required.

The Codex setup forces file-backed credential storage, verifies that `auth.json` exists in the Docker volume, runs `codex login status`, and makes a small authenticated request before reporting success. If it fails, rerun `pnpm setup:codex` and complete the displayed device flow; do not continue until the request verification succeeds.

Run these setup commands as `agentbot`. At job startup, the agent container assigns the selected authentication volume to the service account and then drops root before launching Codex or Claude. This automatically migrates volumes created by older root based versions. The agent process uses the same UID and GID as the receiver, which Claude requires and which preserves ownership of job artifacts.

Each task receives a fresh named Docker volume mounted at `/workspace`. A credentialed repository container clones into it, the agent container edits it without `git`, `gh`, or GitHub credentials, and a credentialed finalization container commits and pushes any changes. The workspace volume is removed after the workflow, while the job record and agent output remain under `WEBHOOK_EVENT_DIR` on the host.

Create the receiver's systemd unit:

```bash
sudo tee /etc/systemd/system/agentbot-router.service >/dev/null <<'UNIT'
[Unit]
Description=Agentbot Router GitHub webhook receiver
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=agentbot
Group=agentbot
SupplementaryGroups=docker
WorkingDirectory=/srv/agentbot-router
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node --env-file=.env dist/src/index.js
Restart=on-failure
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now agentbot-router
sudo systemctl status agentbot-router
curl http://127.0.0.1:8787/health
```

Keep `HOST=127.0.0.1`. The receiver port does not need to be open in the server firewall because `cloudflared` connects to it locally.

## 4. Configure Cloudflare Tunnel in the dashboard and on the server

Your domain must already use Cloudflare DNS. Create a remotely managed tunnel in the Cloudflare dashboard:

1. Open **Networking → Tunnels**.
2. Select **Create a tunnel**.
3. Name it `agentbot-router` and select **Create Tunnel**.
4. Choose **Debian** and the server's architecture.
5. Copy the installation command shown by Cloudflare. It contains the tunnel token.

Because `cloudflared` is already installed, the server-side part of that command is:

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Treat the tunnel token as a secret. Anyone with it can run a connector for this tunnel. Return to the dashboard and wait until the connector is **Healthy**.

Add the public webhook hostname in the dashboard:

1. Open the `agentbot-router` tunnel.
2. On **Routes**, select **Add route → Published application**.
3. Choose a hostname such as `agent.example.com` on your Cloudflare-managed domain.
4. Set **Service URL** to `http://127.0.0.1:8787`.
5. Save the route.

Do not put an interactive Cloudflare Access policy in front of this hostname. GitHub cannot complete an interactive login. GitHub's webhook signature and `GITHUB_WEBHOOK_SECRET` authenticate deliveries.

Verify the complete route:

```bash
curl https://agent.example.com/health
```

The endpoint must return successfully before configuring GitHub. The tunnel uses outbound connections, so port 8787 remains closed to the Internet. See Cloudflare's [dashboard-managed tunnel guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/).

## 5. Configure the GitHub App and webhook

Create one GitHub App under the personal account or organization that owns the repositories:

1. Open **Settings → Developer settings → GitHub Apps → New GitHub App**. For an organization, begin in the organization's settings.
2. Enter a unique app name and use `https://github.com/andygruening/agentbot-router` as the homepage URL.
3. Leave user authorization and callback URLs disabled.
4. Enable **Webhooks**.
5. Set **Webhook URL** to `https://agent.example.com/webhooks/github`, replacing the hostname with the Cloudflare route created above.
6. Copy the exact `GITHUB_WEBHOOK_SECRET` from `/srv/agentbot-router/.env` into **Webhook secret**.
7. Leave SSL verification enabled.
8. Grant these **Repository permissions**:
   - **Issues: Read-only**
   - **Pull requests: Read-only**
   - **Metadata: Read-only**
9. Subscribe to these events:
   - **Issues**
   - **Issue comment**
   - **Pull request**
   - **Pull request review**
   - **Pull request review comment**
10. Select **Only on this account** unless unrelated GitHub accounts also need to install the app, then create it.

Install the app:

1. Open the app's **Install App** page.
2. Select the personal account or organization.
3. Choose **All repositories**.
4. Confirm the installation.

“All repositories” applies to that account or organization and automatically covers repositories subsequently created there. Install the app separately for every other account or organization that should send webhooks.

Test the full flow:

1. Temporarily set `DRY_RUN=true` in `/srv/agentbot-router/.env` and restart the service with `sudo systemctl restart agentbot-router`.
2. Create an issue in an installed repository and add a comment containing `$codex`, `$claude`, or `$agent`.
3. In the GitHub App's **Advanced** page, confirm the delivery received HTTP 202.
4. Inspect `journalctl -u agentbot-router` and `/srv/agentbot-router/.webhook-events/`.
5. Set `DRY_RUN=false`, restart the service, and submit a real task.

For a supplied pull request branch, changed files are committed and pushed back to that branch. Without a supplied branch, the worker creates a task branch and pull request only when files changed. A question-only task posts its response without creating a branch or pull request.

The GitHub App only delivers read-only webhooks. `GH_TOKEN` performs repository cloning, pushes, pull request creation, comments, and reactions. See GitHub's documentation for [webhook permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/using-webhooks-with-github-apps) and [installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app).

For accepted tasks, 👀 indicates active processing, 👍 indicates successful completion, and 👎 indicates a failed, timed out, or blocked task. Reaction attempts and any GitHub API errors are recorded in each job's `github-response.json`.
