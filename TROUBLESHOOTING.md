# Troubleshooting

This guide covers the deployment and container failures most likely to occur on an Ubuntu server. Run service commands with `sudo`; run repository and agent setup commands as the `agentbot` service account.

## Start with the service and delivery logs

Check that the receiver and Cloudflare Tunnel are running:

```bash
sudo systemctl status local-agent-bot --no-pager
sudo systemctl status cloudflared --no-pager
curl http://127.0.0.1:8787/health
curl https://agent.example.com/health
```

Follow receiver logs while sending a GitHub test delivery:

```bash
sudo journalctl -u local-agent-bot -f
```

View recent receiver or tunnel errors:

```bash
sudo journalctl -u local-agent-bot -n 200 --no-pager
sudo journalctl -u cloudflared -n 200 --no-pager
```

GitHub App delivery details are under **GitHub App settings → Advanced → Recent Deliveries**. A delivery accepted for asynchronous processing returns HTTP 202. The receiver log records whether a webhook was accepted or ignored and which processing step failed.

Each accepted delivery also has a directory under the configured `WEBHOOK_EVENT_DIR`, which defaults to `/srv/local-agent-bot/.webhook-events` when systemd uses that working directory. Find the latest jobs with:

```bash
sudo -u agentbot find /srv/local-agent-bot/.webhook-events -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | head
```

Useful files within a job directory include:

- `webhook.json`: received delivery and metadata.
- `github-context.json` and `github-context.md`: fetched issue or pull request context.
- `agent-routing.json`: Jev choice and confidence when `$agent` was used.
- `prompt.md`: instructions passed to the agent.
- `docker.stdout.log` and `docker.stderr.log`: container output and errors.
- `job.json` and `agent-result.json`: final state and worker result.
- `agent-output.md`: reply posted to GitHub.
- `github-response.json`: comment and reaction attempts, including GitHub API errors.

Do not publish these files without reviewing them because webhook payloads and logs can contain private repository data.

## `local-agent-bot.service` is not found

The command `sudo systemctl restart local-agent-bot` only works after the unit in [DEPLOYMENT.md](DEPLOYMENT.md) has been created at `/etc/systemd/system/local-agent-bot.service` and systemd has reloaded its units.

```bash
sudo test -f /etc/systemd/system/local-agent-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now local-agent-bot
```

If the first command fails, create the unit by following the deployment guide, then run the remaining commands. Inspect a rejected unit with:

```bash
sudo systemd-analyze verify /etc/systemd/system/local-agent-bot.service
```

## GitHub webhook does not reach the receiver

Verify each hop in order:

1. `curl http://127.0.0.1:8787/health` checks the receiver.
2. `curl https://agent.example.com/health` checks the Cloudflare route.
3. GitHub App **Recent Deliveries** shows the HTTP status and response body.
4. `journalctl -u local-agent-bot -f` shows parsing and processing.

Confirm that the GitHub App webhook URL ends in the configured path, normally `/webhooks/github`, and that the App webhook secret exactly matches `GITHUB_WEBHOOK_SECRET`. Do not put an interactive Cloudflare Access policy in front of the webhook hostname.

If the delivery arrives but no task starts, make sure the App subscribes to the relevant event, is installed for the repository, and the new issue, pull request, or comment contains a tag listed in `AGENT_TAGS`.

## `gh api` reports `unknown flag: --slurp`

The installed GitHub CLI is too old for that flag. Current project code does not require `gh api --slurp`, so update the checkout and rebuild before restarting:

```bash
sudo -iu agentbot
cd /srv/local-agent-bot
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
exit
sudo systemctl restart local-agent-bot
```

Use `gh --version` to record the installed version if the error remains. Do not patch generated files under `dist/`; rebuild them from the current source.

## pnpm reports `ERR_PNPM_IGNORED_BUILDS` for `node`

The standalone pnpm distribution installs its bundled Node.js runtime through the `node` package. This repository permits that package's install script in `pnpm-workspace.yaml`. If installation says the `node` build was ignored, the server likely has an older checkout that does not contain the allowlist.

```bash
sudo -iu agentbot
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
cd /srv/local-agent-bot
git pull --ff-only
pnpm install --frozen-lockfile
exit
```

Confirm that `pnpm-workspace.yaml` includes `node` under `onlyBuiltDependencies`. There is no need to run the interactive `pnpm approve-builds` command when using the current repository configuration.

## Claude refuses `--dangerously-skip-permissions` as root

Claude refuses that option when its process runs with root privileges. Current containers start as root only long enough to prepare the mounted authentication directory, then use `gosu` to launch the agent with the receiver's UID and GID.

Update and rebuild the project image, ensure the systemd unit runs as `User=agentbot`, and restart the receiver. Do not run the receiver itself with `sudo node ...`.

## Cannot create `/workspace/source`

An error such as `could not create work tree dir '/workspace/source': Permission denied` means the container user cannot write to the workspace. The current runner mounts `/workspace` as a writable temporary filesystem with mode `1777`.

Update and rebuild the image, then verify the effective Docker arguments in the job's `job.json` include:

```text
--tmpfs /workspace:rw,exec,mode=1777
```

Also confirm that the systemd account can access Docker:

```bash
sudo -u agentbot docker version
```

If group membership was just added, restart the systemd service or begin a new login session for `agentbot`.

## Codex cannot initialize its app server

Errors such as `failed to initialize in-process app-server client: Permission denied` or `could not create PATH aliases: Operation not permitted` usually indicate that the process home or mounted Codex directory belongs to a different UID.

Rerun setup as the same account used by systemd. The setup script repairs ownership of the named volume and verifies an authenticated request:

```bash
sudo -iu agentbot
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
cd /srv/local-agent-bot
pnpm setup:codex
exit
sudo systemctl restart local-agent-bot
```

The current runner pins `HOME=/home/agent` and `CODEX_HOME=/home/agent/.codex` before and after dropping privileges. Rebuild the Docker image after updating the repository so this behavior is present.

## Codex returns HTTP 401 or missing authentication

Messages such as `401 Unauthorized`, `Missing bearer or basic authentication in header`, or `Codex authentication is missing from /home/agent/.codex/auth.json` mean the job container cannot use a valid subscription login. An OpenAI API key is not required for this setup.

Run the setup command as `agentbot`, complete device authentication, and require its final authenticated request to succeed:

```bash
sudo -iu agentbot
export PATH="$HOME/.local/share/pnpm/bin:$PATH"
cd /srv/local-agent-bot
pnpm setup:codex
exit
```

Confirm that `.env` uses the same `CODEX_AUTH_VOLUME` name as the setup command and that the volume contains the file without printing its contents:

```bash
docker volume inspect local-agent-codex-auth
docker run --rm --volume local-agent-codex-auth:/auth alpine test -s /auth/auth.json
```

If setup succeeds but jobs still report missing auth, check the effective `CODEX_AUTH_VOLUME` in `/srv/local-agent-bot/.env`, restart the receiver after changing it, and inspect the newest job's Docker arguments in `job.json`.

## The wrong agent is selected by `$agent`

Jev only receives choices for agents listed in `AGENT_TAGS`. If only Codex is authenticated, configure:

```dotenv
AGENT_TAGS=codex
AGENT_DEFAULT=codex
```

Restart the receiver after changing `.env`. Inspect `agent-routing.json` in the job directory to see the options, winner, and confidence. Direct `$claude` or `$codex` tags must also name an agent included in `AGENT_TAGS`.

## Status reaction or final comment is missing

The expected lifecycle is 👀 after acceptance, then 👍 on success or 👎 after a failed, timed out, or blocked task. Inspect the job's `github-response.json` for every attempted reaction and comment and its GitHub API error.

Confirm that `GH_TOKEN` can read the repository and create issue or pull request comments and reactions. The GitHub App receives webhooks; `GH_TOKEN` performs these write operations. Restart the receiver after changing the token in `.env`.

If the container fails before producing a reply, `docker.stderr.log` contains the underlying error and `job.json` records the terminal state. The receiver should still attempt 👎.

## Changes cannot be pushed or a pull request cannot be created

Check `docker.stderr.log` for the failed `git push` or `gh pr create` command. Verify that `GH_TOKEN` can clone and push to the target repository and create pull requests. For an event with a supplied branch, changes are pushed to that branch. Without a supplied branch, the worker creates an `agent/<job-id>` branch and pull request only when files changed. Question-only tasks intentionally create neither.

Test token access as the service account without printing the token:

```bash
sudo -iu agentbot
cd /srv/local-agent-bot
set -a
. ./.env
set +a
gh auth status
gh repo view OWNER/REPOSITORY
exit
```

## Changes do not appear after updating the repository

The service runs compiled JavaScript and jobs use a built Docker image. After pulling source changes, update dependencies, rebuild both artifacts, and restart:

```bash
sudo -iu agentbot
cd /srv/local-agent-bot
pnpm install --frozen-lockfile
pnpm build
docker build --tag local-agent-bot-agent:latest --file docker/Dockerfile .
exit
sudo systemctl restart local-agent-bot
```

If `AGENT_DOCKER_IMAGE` names another image or tag, build that value instead.
