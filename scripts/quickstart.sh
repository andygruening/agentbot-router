#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

say() {
  printf '\n%s\n' "$1"
}

fail() {
  printf '\nSetup stopped: %s\n' "$1" >&2
  exit 1
}

prompt() {
  local message=$1
  local default=${2:-}
  local answer
  if [[ -n "$default" ]]; then
    read -r -p "$message [$default]: " answer
    printf '%s' "${answer:-$default}"
  else
    read -r -p "$message: " answer
    printf '%s' "$answer"
  fi
}

confirm() {
  local message=$1
  local default=${2:-y}
  local suffix='[Y/n]'
  [[ "$default" == n ]] && suffix='[y/N]'
  local answer
  read -r -p "$message $suffix " answer
  answer=${answer:-$default}
  [[ "$answer" =~ ^[Yy]$ ]]
}

set_env() {
  local key=$1
  local value=$2
  local temporary
  temporary=$(mktemp)
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      if (!found) print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' .env > "$temporary"
  chmod --reference=.env "$temporary" 2>/dev/null || chmod 600 "$temporary"
  mv "$temporary" .env
}

say 'local-agent-bot quickstart'
printf '%s\n' 'This configures the receiver and at least one subscription-authenticated agent CLI.'
printf '%s\n' 'No Codex or Claude API key is required.'

missing=()
for command in node pnpm git gh docker openssl; do
  command -v "$command" >/dev/null 2>&1 || missing+=("$command")
done
if ((${#missing[@]})); then
  fail "install these requirements first: ${missing[*]}. See DEPLOYMENT.md."
fi

docker info >/dev/null 2>&1 || fail 'Docker is installed but its daemon is unavailable. Start Docker and retry.'

say '1/5 Install and build'
pnpm install --frozen-lockfile
pnpm build

say '2/5 Receiver configuration'
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  printf '%s\n' 'Created private .env from .env.example.'
else
  chmod 600 .env
  printf '%s\n' 'Using the existing .env file.'
fi

host=$(prompt 'Receiver bind address' '127.0.0.1')
port=$(prompt 'Receiver port' '8787')
[[ "$port" =~ ^[0-9]+$ ]] && ((port >= 1 && port <= 65535)) || fail 'the receiver port must be between 1 and 65535.'
set_env HOST "$host"
set_env PORT "$port"

current_secret=$(awk -F= '$1 == "GITHUB_WEBHOOK_SECRET" { sub(/^[^=]*=/, ""); print; exit }' .env)
if [[ -z "$current_secret" || "$current_secret" == replace-with-* ]]; then
  current_secret=$(openssl rand -hex 32)
  set_env GITHUB_WEBHOOK_SECRET "$current_secret"
  printf '%s\n' 'Generated GITHUB_WEBHOOK_SECRET.'
else
  printf '%s\n' 'Kept the existing GITHUB_WEBHOOK_SECRET.'
fi

printf '%s' 'GitHub token (input hidden; leave blank to use .env or the authenticated gh session): '
read -r -s github_token
printf '\n'
if [[ -n "$github_token" ]]; then
  set_env GH_TOKEN "$github_token"
elif ! grep -qE '^(GH_TOKEN|GITHUB_TOKEN)=.+$' .env && [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]]; then
  github_token=$(gh auth token 2>/dev/null || true)
  if [[ -n "$github_token" ]]; then
    set_env GH_TOKEN "$github_token"
    printf '%s\n' 'Saved the authenticated GitHub CLI token in .env for job containers.'
  else
    fail 'authenticate first with gh auth login --with-token or enter a GitHub token.'
  fi
fi

say '3/5 Agent subscription authentication'
printf '%s\n' 'Choose at least one CLI. Each login opens a device or browser authentication flow.'
printf '%s\n' '  1) Codex'
printf '%s\n' '  2) Claude'
printf '%s\n' '  3) Both'
agent_choice=$(prompt 'Agent setup' '1')
case "$agent_choice" in
  1)
    pnpm setup:codex
    set_env AGENT_DEFAULT codex
    set_env AGENT_TAGS codex
    ;;
  2)
    pnpm setup:claude
    set_env AGENT_DEFAULT claude
    set_env AGENT_TAGS claude
    ;;
  3)
    pnpm setup:codex
    pnpm setup:claude
    default_agent=$(prompt 'Default agent (codex or claude)' 'codex')
    [[ "$default_agent" == codex || "$default_agent" == claude ]] || fail 'the default agent must be codex or claude.'
    set_env AGENT_DEFAULT "$default_agent"
    set_env AGENT_TAGS codex,claude
    ;;
  *) fail 'choose 1, 2, or 3; at least one agent CLI must be configured.' ;;
esac

say '4/5 GitHub App and public webhook'
printf '%s\n' 'Create and install the GitHub App using the permissions and events in DEPLOYMENT.md.'
printf '%s\n' 'When GitHub asks for the webhook secret, copy GITHUB_WEBHOOK_SECRET from .env.'
public_url=$(prompt 'Public HTTPS base URL, if already configured (optional)')
if [[ -n "$public_url" ]]; then
  public_url=${public_url%/}
  printf 'GitHub App webhook URL: %s/webhooks/github\n' "$public_url"
else
  printf '%s\n' 'Next, create a Cloudflare Tunnel and use https://YOUR_HOSTNAME/webhooks/github as the GitHub App webhook URL.'
fi

say '5/5 Setup complete'
printf '%s\n' 'Start the receiver:'
printf '%s\n' '  pnpm start'
printf 'Then verify it locally: curl http://%s:%s/health\n' "$host" "$port"
printf '%s\n' 'For Cloudflare Tunnel, GitHub App, systemd, remote deployment, and end-to-end testing, continue with DEPLOYMENT.md.'
