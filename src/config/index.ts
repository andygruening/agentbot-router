import path from "node:path";
import type {
  AppConfig,
  GitHubReactionContent
} from "./types.ts";

export type {
  AgentConfig,
  AgentSelectionConfig,
  AppConfig,
  CoreConfig,
  GitHubIntegrationConfig,
  GitHubReactionContent,
  IntegrationConfig,
  DockerAgentRunnerConfig,
  JevAgentRouterConfig
} from "./types.ts";

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const defaultAgent = readCliName(env.AGENT_DEFAULT, "AGENT_DEFAULT", "codex");
  const agentTags = readStringList(env.AGENT_TAGS, "codex")
    .map((tag) => readCliName(tag, "AGENT_TAGS", "codex"));

  return {
    core: {
      host: readString(env.HOST, "127.0.0.1"),
      port: readPositiveInt(env.PORT, 8787, "PORT"),
      eventDir: path.resolve(readString(env.WEBHOOK_EVENT_DIR, ".webhook-events")),
      maxBodyBytes: readPositiveInt(env.MAX_BODY_BYTES, 25_000_000, "MAX_BODY_BYTES"),
      allowedEvents: readAllowedEvents(env.ALLOWED_EVENTS),
      dryRun: readBoolean(env.DRY_RUN, false),
      promptPrefix: readOptionalString(env.AGENT_PROMPT_PREFIX)
    },
    agents: {
      jev: {
        apiKey: readOptionalString(env.TYPESAFE_API_KEY),
        choicesPath: path.resolve(readString(env.JEV_CHOICES_PATH, "jev-choices.json"))
      },
      selection: {
        triggerTag: readString(env.AGENT_TRIGGER_TAG, "agent"),
        defaultAgent,
        tags: agentTags
      },
      docker: {
        command: readString(env.DOCKER_COMMAND, "docker"),
        image: readString(env.AGENT_DOCKER_IMAGE, "agentbot-router-agent:latest"),
        repositoryImage: readString(
          env.REPOSITORY_DOCKER_IMAGE,
          "agentbot-router-repository:latest"
        ),
        pull: readBoolean(env.AGENT_DOCKER_PULL, false),
        codexAuthVolume: readString(env.CODEX_AUTH_VOLUME, "agentbot-router-codex-auth"),
        claudeAuthVolume: readString(env.CLAUDE_AUTH_VOLUME, "agentbot-router-claude-auth"),
        execTimeoutMs: readPositiveInt(env.AGENT_EXEC_TIMEOUT_MS, 3_600_000, "AGENT_EXEC_TIMEOUT_MS")
      }
    },
    integrations: {
      github: {
        webhookPath: normalizePath(readString(env.GITHUB_WEBHOOK_PATH, "/webhooks/github")),
        webhookSecret: readOptionalString(env.GITHUB_WEBHOOK_SECRET),
        responseEnabled: readBoolean(env.GITHUB_RESPONSE_ENABLED, true),
        contextEnabled: readBoolean(env.GITHUB_CONTEXT_ENABLED, true),
        contextInlineMaxBytes: readPositiveInt(
          env.GITHUB_CONTEXT_INLINE_MAX_BYTES,
          120_000,
          "GITHUB_CONTEXT_INLINE_MAX_BYTES"
        ),
        command: readString(env.GITHUB_COMMAND, "gh"),
        completionReaction: readGitHubCompletionReaction(
          env.GITHUB_COMPLETION_REACTION,
          "+1"
        ),
        envPassthrough: readStringArray(
          env.GITHUB_ENV_PASSTHROUGH_JSON,
          "GITHUB_ENV_PASSTHROUGH_JSON",
          ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST"]
        )
      }
    }
  };
}

function readCliName(value: string | undefined, name: string, fallback: string): string {
  const nameValue = readString(value, fallback).toLowerCase();
  if (nameValue !== "codex" && nameValue !== "claude") {
    throw new Error(`${name} must be codex or claude`);
  }
  return nameValue;
}

function normalizePath(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function readString(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function readOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  const raw = readOptionalString(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const raw = value?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  throw new Error(`Expected a boolean value but received "${value}"`);
}

function readGitHubCompletionReaction(
  value: string | undefined,
  fallback: Exclude<GitHubReactionContent, "eyes">
): Exclude<GitHubReactionContent, "eyes"> {
  const raw = readOptionalString(value);
  if (!raw) {
    return fallback;
  }

  const allowed = ["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket"] as const;
  if (allowed.includes(raw as (typeof allowed)[number])) {
    return raw as (typeof allowed)[number];
  }

  throw new Error(
    `GITHUB_COMPLETION_REACTION must be one of ${allowed.join(", ")}`
  );
}

function readAllowedEvents(value: string | undefined): ReadonlySet<string> | undefined {
  const raw = readOptionalString(value);
  if (!raw) {
    return undefined;
  }

  const events = raw
    .split(",")
    .map((eventName) => eventName.trim())
    .filter(Boolean);

  return events.length > 0 ? new Set(events) : undefined;
}

function readStringList(value: string | undefined, fallback: string): string[] {
  return readString(value, fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readStringArray(
  value: string | undefined,
  name: string,
  fallback: string[] = []
): string[] {
  const raw = readOptionalString(value);
  if (!raw) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be a JSON array of strings`, { cause: error });
  }

  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${name} must be a JSON array of strings`);
  }

  return parsed;
}
